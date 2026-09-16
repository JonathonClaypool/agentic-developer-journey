import hashlib
import json
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from models.schemas import AgentStarterKitRequest, DeploymentManifest
from services.artifact_repository import get_artifact_repository, package_path
from .package_generator import (
    PackageError,
    get_deployment_outputs,
    read_package_file,
)

KIT_DIRECTORY = "agent-starter-kits"


def _yaml_string(value: str) -> str:
    return json.dumps(value)


def _write(directory: Path, path: str, content: str) -> None:
    target = directory / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def _hash_files(directory: Path, names: list[str]) -> str:
    digest = hashlib.sha256()
    for name in sorted(names):
        digest.update(name.encode("utf-8"))
        digest.update((directory / name).read_bytes())
    return digest.hexdigest()


def _main_py(include_mcp: bool, include_search: bool) -> str:
    imports = [
        "import asyncio",
        "import os",
        "",
        "from agent_framework import Agent",
        "from agent_framework.foundry import FoundryChatClient, ResponsesHostServer",
        "from azure.identity import DefaultAzureCredential",
    ]
    auth_helper = ""
    tool_lines: list[str] = []
    if include_mcp:
        imports.extend(["from typing import Any, Callable", "", "from agent_framework import MCPStreamableHTTPTool", "from azure.identity import get_bearer_token_provider"])
        auth_helper = '''\n\ndef apim_headers(credential: DefaultAzureCredential) -> Callable[[dict[str, Any]], dict[str, str]]:\n    get_token = get_bearer_token_provider(credential, os.environ["APIM_MCP_SCOPE"])\n\n    def provide(_kwargs: dict[str, Any]) -> dict[str, str]:\n        return {"Authorization": f"Bearer {get_token()}"}\n\n    return provide\n'''
        tool_lines.extend(["    tools.append(", "        MCPStreamableHTTPTool(", '            name="governed_apim_mcp",', '            description="Approved enterprise tools exposed through API Management",', '            url=os.environ["APIM_MCP_ENDPOINT"],', "            header_provider=apim_headers(credential),", "            load_prompts=False,", "        )", "    )"])
    if include_search:
        tool_lines.extend(["    tools.append(", "        FoundryChatClient.get_azure_ai_search_tool(", '            index_connection_id=os.environ["AI_SEARCH_CONNECTION_ID"],', '            index_name=os.environ["AI_SEARCH_INDEX_NAME"],', "        )", "    )"])
    tools = "\n".join(tool_lines) if tool_lines else "    # Add only approved tools here."
    return "\n".join(imports) + auth_helper + f'''\n\n\ndef build_agent() -> Agent:\n    credential = DefaultAzureCredential()\n    client = FoundryChatClient(\n        project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],\n        model=os.environ["MODEL_DEPLOYMENT_NAME"],\n        credential=credential,\n    )\n    tools = []\n{tools}\n    return Agent(\n        client=client,\n        name=os.getenv("FOUNDRY_AGENT_NAME", "quality-event-summarizer"),\n        description="Summarizes quality events using approved enterprise evidence.",\n        instructions=(\n            "You are a governed quality-event summarization assistant. "\n            "Use only approved connected sources, cite evidence when available, "\n            "state uncertainty, and never claim that your output replaces required human review."\n        ),\n        tools=tools,\n        default_options={{"store": False}},\n    )\n\n\nasync def main() -> None:\n    await ResponsesHostServer(build_agent()).run_async()\n\n\nif __name__ == "__main__":\n    asyncio.run(main())\n'''


def _azure_yaml(
    request: AgentStarterKitRequest, model_name: str, resource_values: dict[str, str]
) -> str:
    environment_lines = [f"      MODEL_DEPLOYMENT_NAME: {_yaml_string(model_name)}"]
    for name in (
        "FOUNDRY_PROJECT_ENDPOINT",
        "AZURE_SEARCH_ENDPOINT",
        "STORAGE_BLOB_ENDPOINT",
    ):
        if resource_values.get(name):
            environment_lines.append(f"      {name}: {_yaml_string(resource_values[name])}")
    common = f'''name: {request.agent_name}\nmetadata:\n  template: governed-hosted-agent@1.0\nservices:\n  {request.agent_name}:\n    name: {request.agent_name}\n    project: .\n    host: azure.ai.agent\n    protocols:\n      - responses\n    environmentVariables:\n      MODEL_DEPLOYMENT_NAME: {_yaml_string(model_name)}\n'''
    common = common.replace(
        f"      MODEL_DEPLOYMENT_NAME: {_yaml_string(model_name)}",
        "\n".join(environment_lines),
    )
    if request.deployment_mode == "source":
        return common + '''    codeConfiguration:\n      runtime: python_3_13\n      entryPoint: src/main.py\n      dependencyResolution: remote_build\n'''
    return common + '''    language: docker\n    image: ${JFROG_IMAGE_REFERENCE}\n    registryConnectionId: ${JFROG_REGISTRY_CONNECTION_ID}\n'''


def _connections_yaml(
    request: AgentStarterKitRequest, resource_values: dict[str, str]
) -> str:
    lines = [
        "version: 1",
        "authentication: managed-identity",
        "connections:",
        "  foundry:",
        "    kind: project",
        "    endpointEnv: FOUNDRY_PROJECT_ENDPOINT",
        f"    endpoint: {_yaml_string(resource_values.get('FOUNDRY_PROJECT_ENDPOINT', 'not-captured'))}",
        f"    resourceId: {_yaml_string(resource_values.get('FOUNDRY_PROJECT_RESOURCE_ID', 'not-captured'))}",
        "    provision: false",
    ]
    if request.mcp_connection:
        lines.extend(
            [
                "  governedMcp:",
                "    kind: mcp",
                "    gateway: azure-api-management",
                f"    catalogName: {_yaml_string(request.mcp_connection.name)}",
                f"    version: {_yaml_string(request.mcp_connection.version or 'approved')}",
                f"    path: {_yaml_string(request.mcp_connection.apim_path)}",
                "    endpointEnv: APIM_MCP_ENDPOINT",
                "    authentication: managed-identity",
                "    provision: false",
            ]
        )
    if request.include_search:
        lines.extend(
            [
                "  knowledgeSearch:",
                "    kind: azure-ai-search",
                "    connectionIdEnv: AI_SEARCH_CONNECTION_ID",
                "    indexNameEnv: AI_SEARCH_INDEX_NAME",
                "    endpointEnv: AZURE_SEARCH_ENDPOINT",
                f"    endpoint: {_yaml_string(resource_values.get('AZURE_SEARCH_ENDPOINT', 'not-captured'))}",
                f"    resourceId: {_yaml_string(resource_values.get('AZURE_SEARCH_RESOURCE_ID', 'not-captured'))}",
                "    authentication: managed-identity",
                "    provision: false",
            ]
        )
    if resource_values.get("STORAGE_BLOB_ENDPOINT"):
        lines.extend(
            [
                "  storage:",
                "    kind: azure-storage",
                "    endpointEnv: STORAGE_BLOB_ENDPOINT",
                f"    endpoint: {_yaml_string(resource_values['STORAGE_BLOB_ENDPOINT'])}",
                f"    resourceId: {_yaml_string(resource_values.get('AZURE_STORAGE_RESOURCE_ID', 'not-captured'))}",
                "    authentication: managed-identity",
                "    provision: false",
            ]
        )
    return "\n".join(lines)


def _resource_values(
    manifest: DeploymentManifest,
    deployment: dict[str, object] | None,
    package_id: str,
) -> dict[str, str]:
    outputs = deployment.get("outputs", {}) if deployment else {}
    values = outputs if isinstance(outputs, dict) else {}
    resources = deployment.get("resources", []) if deployment else []
    resource_ids = {
        str(item.get("type")): str(item.get("resourceId"))
        for item in resources
        if isinstance(item, dict) and item.get("type") and item.get("resourceId")
    }

    def value(name: str) -> str:
        raw = values.get(name)
        return str(raw) if raw else ""

    account_name = value("foundryAccountName")
    project_name = value("foundryProjectName")
    search_name = value("searchServiceName")
    storage_name = value("storageAccountName")
    foundry_endpoint = value("foundryProjectEndpoint")
    if not foundry_endpoint and account_name and project_name:
        foundry_endpoint = f"https://{account_name}.services.ai.azure.com/api/projects/{project_name}"
    suffix = package_id.rsplit("-", 1)[-1][:6].lower()
    storage_selected = "storage" in manifest.resources
    search_selected = "ai-search" in manifest.resources
    return {
        "AZURE_SUBSCRIPTION_ID": str(deployment.get("subscriptionId", "")) if deployment else "",
        "AZURE_RESOURCE_GROUP": manifest.platform_resources.foundry_resource_group,
        "FOUNDRY_PROJECT_ENDPOINT": foundry_endpoint,
        "FOUNDRY_PROJECT_RESOURCE_ID": value("foundryProjectResourceId")
        or resource_ids.get("Microsoft.CognitiveServices/accounts/projects", ""),
        "FOUNDRY_ACCOUNT_RESOURCE_ID": value("foundryAccountResourceId")
        or resource_ids.get("Microsoft.CognitiveServices/accounts", ""),
        "MODEL_DEPLOYMENT_NAME": value("chatModelDeployment")
        or f"{manifest.chat_model.name}-{suffix}",
        "AZURE_SEARCH_ENDPOINT": (
            value("searchEndpoint")
            or (f"https://{search_name}.search.windows.net" if search_name else "")
        )
        if search_selected
        else "",
        "AZURE_SEARCH_RESOURCE_ID": (
            value("searchResourceId")
            or resource_ids.get("Microsoft.Search/searchServices", "")
        )
        if search_selected
        else "",
        "STORAGE_BLOB_ENDPOINT": (
            value("storageBlobEndpoint")
            or (f"https://{storage_name}.blob.core.windows.net" if storage_name else "")
        )
        if storage_selected
        else "",
        "STORAGE_CONTAINER_NAME": value("storageContainerName")
        if storage_selected
        else "",
        "AZURE_STORAGE_RESOURCE_ID": (
            value("storageResourceId")
            or resource_ids.get("Microsoft.Storage/storageAccounts", "")
        )
        if storage_selected
        else "",
        "COSMOS_ACCOUNT_NAME": value("cosmosAccountName")
        or manifest.platform_resources.cosmos_account_name,
        "COSMOS_DATABASE_NAME": value("cosmosDatabaseName")
        or manifest.platform_resources.cosmos_database_name,
        "COSMOS_CONTAINER_NAME": value("cosmosContainerName"),
        "AZURE_SEARCH_INDEX_NAME": value("searchIndexName")
        or manifest.platform_resources.search_index_name,
        "PLATFORM_IDENTITY_RESOURCE_ID": manifest.platform_resources.managed_identity_resource_id,
        "PLATFORM_IDENTITY_CLIENT_ID": value("identityClientId"),
    }


def create_agent_starter_kit(
    package_id: str, request: AgentStarterKitRequest
) -> dict[str, object]:
    manifest = DeploymentManifest.model_validate_json(
        read_package_file(package_id, "deployment-manifest.json")
    )
    deployment = get_deployment_outputs(package_id)
    resource_values = _resource_values(manifest, deployment, package_id)
    if request.include_search and "ai-search" not in manifest.resources:
        raise PackageError("Azure AI Search is not part of the approved infrastructure package.")

    kit_id = f"{request.agent_name}-{request.deployment_mode}"
    env_lines = [
        "# Resource identifiers only. Authenticate locally with Azure CLI; hosted runtime uses its agent identity.",
        f"AZURE_SUBSCRIPTION_ID={resource_values['AZURE_SUBSCRIPTION_ID'] or '<subscription-id>'}",
        f"AZURE_RESOURCE_GROUP={resource_values['AZURE_RESOURCE_GROUP']}",
        f"FOUNDRY_PROJECT_ENDPOINT={resource_values['FOUNDRY_PROJECT_ENDPOINT'] or 'https://<foundry-account>.services.ai.azure.com/api/projects/<project-name>'}",
        f"MODEL_DEPLOYMENT_NAME={resource_values['MODEL_DEPLOYMENT_NAME']}",
    ]
    if resource_values["AZURE_SEARCH_ENDPOINT"]:
        env_lines.append(f"AZURE_SEARCH_ENDPOINT={resource_values['AZURE_SEARCH_ENDPOINT']}")
    if resource_values["STORAGE_BLOB_ENDPOINT"]:
        env_lines.append(f"STORAGE_BLOB_ENDPOINT={resource_values['STORAGE_BLOB_ENDPOINT']}")
    if resource_values["STORAGE_CONTAINER_NAME"]:
        env_lines.append(f"STORAGE_CONTAINER_NAME={resource_values['STORAGE_CONTAINER_NAME']}")
    if resource_values["COSMOS_CONTAINER_NAME"]:
        env_lines.extend(
            [
                f"COSMOS_ACCOUNT_NAME={resource_values['COSMOS_ACCOUNT_NAME']}",
                f"COSMOS_DATABASE_NAME={resource_values['COSMOS_DATABASE_NAME']}",
                f"COSMOS_CONTAINER_NAME={resource_values['COSMOS_CONTAINER_NAME']}",
            ]
        )
    if request.mcp_connection:
        env_lines.extend(
            [
                f"APIM_MCP_ENDPOINT=https://<apim-gateway-host>{request.mcp_connection.apim_path}",
                "APIM_MCP_SCOPE=api://<apim-application-id>/.default",
            ]
        )
    if request.include_search:
        env_lines.extend(
            [
                "AI_SEARCH_CONNECTION_ID=<foundry-project-search-connection-id>",
                f"AI_SEARCH_INDEX_NAME={resource_values['AZURE_SEARCH_INDEX_NAME']}",
            ]
        )
    if request.deployment_mode == "jfrog":
        env_lines.extend(
            [
                "JFROG_IMAGE_REFERENCE=<tenant>.jfrog.io/<repository>/<image>:<immutable-tag>",
                "JFROG_REGISTRY_CONNECTION_ID=/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.CognitiveServices/accounts/<account>/projects/<project>/connections/<jfrog-connection>",
            ]
        )

    files: dict[str, str] = {
        "README.md": f'''# {request.agent_name} governed starter\n\nThis starter is linked to immutable infrastructure package `{package_id}`. It creates no Azure resources and contains no credentials. Non-secret identifiers for resources deployed by this package are populated from the verified Azure deployment output. Developers own the agent instructions, tools, tests, and business behavior.\n\n## Workflow\n\n1. Copy `.env.example` to `.env`; replace only placeholders for external resources that this package did not create.\n2. Sign in locally with Azure CLI; do not add tokens, passwords, or keys to files.\n3. Install the pinned dependencies and run `src/main.py`.\n4. Test the Responses endpoint at `http://localhost:8088/responses`.\n5. Complete `access-request.yaml`; the platform grants the created agent identity only after agent creation.\n6. Run the evaluation gates in `evaluation-plan.yaml`.\n7. Deploy with `azd deploy` after review. Each deployment creates an immutable agent version.\n\n## Deployment mode\n\nSelected mode: **{request.deployment_mode}**. Source mode uses Foundry remote build. JFrog mode references a prebuilt linux/amd64 image and a Foundry `CustomKeys` registry connection that performs OIDC token exchange; no ACR bridge is required.\n''',
        "AGENTS.md": "# Agent development instructions\n\nThis project was built with the microsoft-foundry skill. Before working on or answering questions about foundry agents, read the microsoft-foundry skill first.\n\nKeep credentials out of source. Preserve the Responses protocol, managed identity, APIM boundary, immutable image tags, and evaluation gates.\n",
        "solution-manifest.yaml": f'''version: 1\napplicationId: {_yaml_string(manifest.application_id)}\ninfrastructurePackageId: {_yaml_string(package_id)}\nworkload: {_yaml_string(manifest.workload_name)}\nregion: {_yaml_string(manifest.location)}\nagent:\n  name: {_yaml_string(request.agent_name)}\n  language: python\n  framework: microsoft-agent-framework\n  protocol: responses\n  hosting: microsoft-foundry-hosted-agent\n  deploymentMode: {request.deployment_mode}\n  existingFoundryProject: true\n            modelDeployment: {_yaml_string(resource_values["MODEL_DEPLOYMENT_NAME"])}\n  azureAiSearch: {str(request.include_search).lower()}\n''',
        "connections.yaml": _connections_yaml(request, resource_values),
        "deployment-resources.json": json.dumps(
            {
                "source": "verified-azure-deployment" if deployment else "immutable-package-plan",
                "deployment": deployment or {},
                "resolvedConfiguration": resource_values,
            },
            indent=2,
        ),
        "access-request.yaml": '''version: 1\nprincipal:\n  kind: hosted-agent-instance-identity\n  objectId: <populate-after-agent-creation>\nrequestedGrants:\n  - scope: foundry-account\n    role: Cognitive Services OpenAI User\n    reason: Invoke the approved model deployment\n  - scope: api-management-api\n    role: <approved-apim-application-role>\n    reason: Invoke only the selected governed MCP capability\ncontrols:\n  leastPrivilege: required\n  humanApproval: required\n  reapplyAfterPublicationIdentityChange: required\n''',
        "evaluation-plan.yaml": '''version: 1\nsuite: quality-event-summarizer\ndataset: evaluations/quality-events.jsonl\ngates:\n  - name: groundedness\n    evaluator: groundedness\n    threshold: 4\n  - name: relevance\n    evaluator: relevance\n    threshold: 4\n  - name: tool-boundary\n    evaluator: task-adherence\n    threshold: 4\n  - name: human-review-language\n    evaluator: custom\n    threshold: 1\nreleasePolicy:\n  requireAllGates: true\n  requireHumanApproval: true\n''',
        ".env.example": "\n".join(env_lines),
        "src/main.py": _main_py(bool(request.mcp_connection), request.include_search),
        "requirements.txt": "\n".join(
            [
                "agent-framework-core==1.18.0",
                "agent-framework-foundry==1.13.0",
                "agent-framework-foundry-hosting==1.0.0b260910",
                "azure-identity==1.25.1",
                "mcp==1.27.1",
            ]
        ),
        "azure.yaml": _azure_yaml(
            request, resource_values["MODEL_DEPLOYMENT_NAME"], resource_values
        ),
        ".agentignore": ".env\n.venv/\n__pycache__/\n.pytest_cache/\n*.pyc\n.git/\nevaluations/results/\n",
        "evaluations/quality-events.jsonl": '{"query":"Summarize the approved quality event evidence and identify uncertainties.","expected":"A concise evidence-grounded summary with citations, uncertainty, and human-review language."}',
    }
    if request.deployment_mode == "jfrog":
        files["Dockerfile"] = '''FROM python:3.13-slim@sha256:<approved-base-image-digest>\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY src ./src\nUSER 10001\nEXPOSE 8088\nCMD ["python", "src/main.py"]\n'''
        files["jfrog-deployment.yaml"] = '''version: 1\nregistry:\n  provider: jfrog-artifactory\n  authentication: oidc-token-exchange\n  foundryConnection:\n    category: CustomKeys\n    idEnv: JFROG_REGISTRY_CONNECTION_ID\nimage:\n  referenceEnv: JFROG_IMAGE_REFERENCE\n  requiredPlatform: linux/amd64\n  immutableTagRequired: true\n  acrBridgeRequired: false\n'''

    with tempfile.TemporaryDirectory(prefix="launchpad-starter-") as temporary:
        directory = Path(temporary) / kit_id
        directory.mkdir(parents=True)
        for path, content in files.items():
            _write(directory, path, content)
        file_names = sorted(files)
        kit_hash = _hash_files(directory, file_names)
        metadata = {
            "kitId": kit_id,
            "packageId": package_id,
            "createdAt": datetime.now(UTC).isoformat(),
            "sha256": kit_hash,
            "deploymentMode": request.deployment_mode,
            "includesSearch": request.include_search,
            "connectionCount": int(request.mcp_connection is not None),
            "configurationSource": "verified-azure-deployment" if deployment else "immutable-package-plan",
        }
        _write(directory, "starter-kit-metadata.json", json.dumps(metadata, indent=2))
        file_names.append("starter-kit-metadata.json")
        archive = Path(shutil.make_archive(str(directory), "zip", directory))
        repository = get_artifact_repository()
        prefix = f"{KIT_DIRECTORY}/{kit_id}"
        for name in file_names:
            repository.write(
                package_path(package_id, f"{prefix}/{name}"),
                (directory / name).read_bytes(),
                overwrite=True,
            )
        repository.write(
            package_path(package_id, f"{KIT_DIRECTORY}/{kit_id}.zip"),
            archive.read_bytes(),
            overwrite=True,
        )
        response_files = [
            {"path": name, "content": (directory / name).read_text(encoding="utf-8")}
            for name in file_names
        ]
    return {
        **metadata,
        "downloadUrl": f"/api/packages/{package_id}/agent-starter-kits/{kit_id}/download",
        "files": response_files,
        "archive": f"{kit_id}.zip",
    }


def get_agent_starter_archive(package_id: str, kit_id: str) -> tuple[bytes, str]:
    if not kit_id or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in kit_id):
        raise PackageError("Invalid starter kit ID.")
    try:
        content = get_artifact_repository().read(
            package_path(package_id, f"{KIT_DIRECTORY}/{kit_id}.zip")
        )
    except FileNotFoundError as error:
        raise PackageError("Agent starter kit was not found.") from error
    return content, f"{kit_id}.zip"
