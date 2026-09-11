from fastapi.testclient import TestClient
import connectors.azure_cli as azure_deployment
import routers.deployments as deployments_router
import services.region_assessment as region_assessment

from main import app
from models.schemas import DeploymentManifest

client = TestClient(app)

PACKAGE_REQUEST = {
    "applicationId": "AI-2026-0118",
    "location": "eastus2",
    "resourceGroupName": "rg-quality-rag-poc-eus2",
    "workloadName": "quality-rag-poc",
    "resources": ["ai-search", "storage", "embedding-model", "chat-model"],
    "chatModel": {
        "name": "gpt-5-mini",
        "version": "2025-08-07",
        "sku": "GlobalStandard",
        "capacity": 10,
    },
    "embeddingModel": {
        "name": "text-embedding-3-small",
        "version": "1",
        "sku": "GlobalStandard",
        "capacity": 10,
    },
    "tags": {"environment": "poc"},
}


def test_api_response_has_correlation_id() -> None:
    response = client.get("/api/health", headers={"X-Correlation-ID": "test-request-123"})
    assert response.status_code == 200
    assert response.headers["X-Correlation-ID"] == "test-request-123"


def test_governance_risk_is_calculated_by_api() -> None:
    response = client.post(
        "/api/governance/risk-assessment",
        json={
            "personal": "yes",
            "health": "yes",
            "regulated": "yes",
            "identifiable": "yes",
            "capabilities": ["Execute actions"],
            "autonomy": 4,
            "safety": "yes",
            "humanReview": "no",
            "audit": "no",
        },
    )
    assert response.status_code == 200
    assessment = response.json()
    assert assessment["level"] == "Restricted"
    assert assessment["score"] >= 75
    assert "Privacy" in assessment["reviewers"]
    assert "Enable prompt, output, and action audit logging" in assessment["controls"]


def test_model_recommendation_and_catalog_are_api_owned() -> None:
    response = client.post(
        "/api/recommendations/model",
        json={
            "capabilities": ["grounding", "agents", "actions"],
            "dataTypes": ["documents", "analytics", "operational"],
            "dataUses": ["metrics"],
            "connectors": ["sharepoint", "mcp"],
            "memory": ["Workflow checkpoints"],
            "regulated": True,
            "scale": "large",
        },
    )
    assert response.status_code == 200
    recommendation = response.json()
    assert recommendation["model"]["id"] == "o3"
    assert recommendation["level"] == "Advanced"
    assert recommendation["capacity"] == "80K TPM"

    catalog = client.get("/api/catalog")
    assert catalog.status_code == 200
    assert {model["id"] for model in catalog.json()["models"]} == {"gpt-5-mini", "gpt-5", "o3"}


def test_architecture_planner_derives_standard_production_controls() -> None:
    response = client.post(
        "/api/architecture/plan",
        json={
            "resources": ["storage", "ai-search", "observability"],
            "primaryRegion": "eastus2",
            "operationalRequirements": {
                "environments": "dev-test-prod",
                "scale": "medium",
                "serviceHours": "24x7",
                "businessImpact": "material",
                "rtoMinutes": 240,
                "rpoMinutes": 60,
                "regulatedRecords": True,
                "retentionDays": 365,
                "immutableAudit": True,
                "dataResidency": ["US"],
                "customerManagedKeys": False,
            },
        },
    )
    assert response.status_code == 200
    plan = response.json()
    assert plan["profile"] == "standard-production"
    assert plan["deployable"] is True
    assert plan["derivedParameters"]["storageSku"] == "Standard_GZRS"
    assert plan["derivedParameters"]["searchReplicaCount"] == 2
    assert plan["derivedParameters"]["logRetentionDays"] == 365
    assert {control["id"] for control in plan["controls"]} >= {"audit-retention", "immutable-audit"}
    changes = plan["infrastructureChanges"]
    assert changes["additionalInfrastructure"] == []
    assert changes["summary"] == "No additional Azure services are required; 3 existing components will be production-hardened."
    change_by_resource = {change["resource"]: change for change in changes["existingInfrastructure"]}
    assert change_by_resource["storage"]["status"] == "upgraded"
    assert change_by_resource["storage"]["target"].startswith("Standard_GZRS")
    assert change_by_resource["ai-search"]["status"] == "scaled"
    assert change_by_resource["observability"]["status"] == "reconfigured"


def test_warm_standby_is_honest_about_unimplemented_topology() -> None:
    response = client.post(
        "/api/architecture/plan",
        json={
            "resources": ["storage", "ai-search"],
            "primaryRegion": "eastus2",
            "operationalRequirements": {
                "environments": "dev-test-prod",
                "serviceHours": "24x7",
                "businessImpact": "critical",
                "rtoMinutes": 60,
                "rpoMinutes": 15,
                "secondaryRegion": "centralus",
            },
        },
    )
    assert response.status_code == 200
    plan = response.json()
    assert plan["profile"] == "business-critical-warm-standby"
    assert plan["deployable"] is False
    assert any("not yet implemented" in blocker for blocker in plan["blockers"])
    additions = plan["infrastructureChanges"]["additionalInfrastructure"]
    assert {addition["resource"] for addition in additions} == {"secondary-regional-stamp", "global-routing"}
    assert all(addition["implementationStatus"] == "blocked" for addition in additions)


def test_approval_generates_compiled_bicep_package() -> None:
    response = client.post("/api/packages", json=PACKAGE_REQUEST)
    assert response.status_code == 201
    package = response.json()
    keys = [resource["key"] for resource in package["resourceDetails"]]
    assert keys == [
        "managed-identity",
        "ai-search",
        "storage",
        "foundry",
        "embedding-model",
        "chat-model",
    ]
    assert len(package["sha256"]) == 64
    files = {item["path"]: item["content"] for item in package["files"]}
    assert {"main.bicep", "resources.bicep", "main.bicepparam"} <= files.keys()
    assert "param resourceGroupName = 'rg-quality-rag-poc-eus2'" in files["main.bicepparam"]
    assert "param deploymentStamp = '" in files["main.bicepparam"]
    assert "Microsoft.CognitiveServices/accounts/projects" in files["resources.bicep"]
    assert "resource foundryAccount 'Microsoft.CognitiveServices/accounts@" in files["resources.bicep"]
    assert "resource foundryProject 'Microsoft.CognitiveServices/accounts/projects@" in files["resources.bicep"]
    assert "location: location" in files["resources.bicep"]
    assert "dependsOn: [\n    foundryProject\n  ]" in files["resources.bicep"]
    assert "dependsOn: [\n    chatModel\n  ]" in files["resources.bicep"]
    assert "param deployPrivateNetwork = false" in files["main.bicepparam"]
    assert "publicNetworkAccess: deployPrivateNetwork ? 'Disabled' : 'Enabled'" in files["resources.bicep"]
    assert "defaultAction: deployPrivateNetwork ? 'Deny' : 'Allow'" in files["resources.bicep"]
    assert "disableLocalAuth: true" in files["resources.bicep"]
    assert "allowSharedKeyAccess: false" in files["resources.bicep"]

    retrieved = client.get(f"/api/packages/{package['packageId']}")
    assert retrieved.status_code == 200
    assert retrieved.json()["sha256"] == package["sha256"]


def test_generates_governed_source_agent_starter_and_zip() -> None:
    package = client.post("/api/packages", json=PACKAGE_REQUEST).json()
    package_hash = package["sha256"]
    response = client.post(
        f"/api/packages/{package['packageId']}/agent-starter-kits",
        json={
            "agentName": "quality-event-summarizer",
            "deploymentMode": "source",
            "mcpConnection": {
                "name": "quality-tools",
                "version": "v1",
                "apimPath": "/default/toolservers/quality/mcp",
            },
            "includeSearch": True,
        },
    )
    assert response.status_code == 201
    kit = response.json()
    assert kit["packageId"] == package["packageId"]
    assert kit["deploymentMode"] == "source"
    files = {item["path"]: item["content"] for item in kit["files"]}
    assert "codeConfiguration:" in files["azure.yaml"]
    assert "JFROG_IMAGE_REFERENCE" not in files["azure.yaml"]
    assert "from agent_framework.foundry import FoundryChatClient, ResponsesHostServer" in files["src/main.py"]
    assert 'default_options={"store": False}' in files["src/main.py"]
    assert "MCPStreamableHTTPTool" in files["src/main.py"]
    assert "get_bearer_token_provider" in files["src/main.py"]
    assert "get_azure_ai_search_tool" in files["src/main.py"]
    compile(files["src/main.py"], "src/main.py", "exec")
    assert "APIM_MCP_SCOPE" in files[".env.example"]
    assert "password" not in files[".env.example"].lower()
    assert "api_key" not in files[".env.example"].lower()
    assert package_hash == client.get(f"/api/packages/{package['packageId']}").json()["sha256"]

    archive = client.get(kit["downloadUrl"])
    assert archive.status_code == 200
    assert archive.headers["content-type"] == "application/zip"
    assert archive.content.startswith(b"PK")


def test_jfrog_mode_is_direct_and_search_requires_approved_infrastructure() -> None:
    request_without_search = {**PACKAGE_REQUEST, "resources": ["chat-model", "foundry"]}
    request_without_search["embeddingModel"] = None
    package = client.post("/api/packages", json=request_without_search).json()

    rejected = client.post(
        f"/api/packages/{package['packageId']}/agent-starter-kits",
        json={"agentName": "quality-event-summarizer", "deploymentMode": "source", "includeSearch": True},
    )
    assert rejected.status_code == 422
    assert "not part" in rejected.json()["detail"]

    response = client.post(
        f"/api/packages/{package['packageId']}/agent-starter-kits",
        json={"agentName": "quality-event-summarizer", "deploymentMode": "jfrog", "includeSearch": False},
    )
    assert response.status_code == 201
    files = {item["path"]: item["content"] for item in response.json()["files"]}
    assert "registryConnectionId: ${JFROG_REGISTRY_CONNECTION_ID}" in files["azure.yaml"]
    assert "provider: jfrog-artifactory" in files["jfrog-deployment.yaml"]
    assert "authentication: oidc-token-exchange" in files["jfrog-deployment.yaml"]
    assert "acrBridgeRequired: false" in files["jfrog-deployment.yaml"]
    assert "get_azure_ai_search_tool" not in files["src/main.py"]


def test_successful_deployment_outputs_populate_starter_connections(monkeypatch) -> None:
    request = {
        **PACKAGE_REQUEST,
        "applicationId": "AI-2026-outputs",
        "resourceGroupName": "rg-output-capture-poc-eus2",
        "workloadName": "output-capture-poc",
    }
    package = client.post("/api/packages", json=request).json()
    package_hash = package["sha256"]
    subscription_id = "cdcf2cb6-afa4-4076-abe1-ac97a899a308"

    monkeypatch.setattr(
        deployments_router,
        "deployment_status",
        lambda manifest, deployment_name: {
            "deploymentName": deployment_name,
            "state": "Succeeded",
            "timestamp": "2026-09-10T12:00:00Z",
            "duration": "PT4M",
            "error": None,
            "outputs": {
                "resourceGroupName": "rg-output-capture-poc-eus2",
                "foundryAccountName": "aif-output-capture-abc123",
                "foundryProjectName": "proj-output-capture-poc",
                "chatModelDeployment": "gpt-5-mini",
                "storageAccountName": "stoutputabc123",
                "searchServiceName": "srch-output-capture-abc123",
                "identityClientId": "11111111-2222-3333-4444-555555555555",
            },
            "resources": [
                {
                    "resourceId": f"/subscriptions/{subscription_id}/resourceGroups/rg-output-capture-poc-eus2/providers/Microsoft.CognitiveServices/accounts/aif-output-capture-abc123/projects/proj-output-capture-poc",
                    "name": "proj-output-capture-poc",
                    "type": "Microsoft.CognitiveServices/accounts/projects",
                    "state": "Succeeded",
                },
                {
                    "resourceId": f"/subscriptions/{subscription_id}/resourceGroups/rg-output-capture-poc-eus2/providers/Microsoft.Search/searchServices/srch-output-capture-abc123",
                    "name": "srch-output-capture-abc123",
                    "type": "Microsoft.Search/searchServices",
                    "state": "Succeeded",
                },
            ],
        },
    )
    status_response = client.post(
        f"/api/packages/{package['packageId']}/deployments/output-capture-poc-12345678/status",
        json={"subscriptionId": subscription_id},
    )
    assert status_response.status_code == 200

    kit_response = client.post(
        f"/api/packages/{package['packageId']}/agent-starter-kits",
        json={"agentName": "output-agent", "deploymentMode": "source", "includeSearch": True},
    )
    assert kit_response.status_code == 201
    kit = kit_response.json()
    assert kit["configurationSource"] == "verified-azure-deployment"
    files = {item["path"]: item["content"] for item in kit["files"]}
    foundry_endpoint = "https://aif-output-capture-abc123.services.ai.azure.com/api/projects/proj-output-capture-poc"
    assert f"FOUNDRY_PROJECT_ENDPOINT={foundry_endpoint}" in files[".env.example"]
    assert "AZURE_SEARCH_ENDPOINT=https://srch-output-capture-abc123.search.windows.net" in files[".env.example"]
    assert "STORAGE_BLOB_ENDPOINT=https://stoutputabc123.blob.core.windows.net" in files[".env.example"]
    assert f'FOUNDRY_PROJECT_ENDPOINT: "{foundry_endpoint}"' in files["azure.yaml"]
    assert 'source": "verified-azure-deployment"' in files["deployment-resources.json"]
    assert package_hash == client.get(f"/api/packages/{package['packageId']}").json()["sha256"]


def test_deploy_is_disabled_by_default(monkeypatch) -> None:
    monkeypatch.setattr(deployments_router, "DEPLOYMENTS_ENABLED", False)
    response = client.post(
        "/api/packages/not-created/deploy",
        json={
            "subscriptionId": "cdcf2cb6-afa4-4076-abe1-ac97a899a308",
            "confirmationToken": "27e3aebb-bb9f-43a2-a505-f843a14bfc46",
        },
    )
    assert response.status_code == 503
    assert "disabled" in response.json()["detail"].lower()


def test_what_if_requests_machine_readable_json(monkeypatch) -> None:
    captured_args: list[str] = []

    def fake_run_azure(args: list[str], *, expect_json: bool = True) -> dict[str, object]:
        captured_args.extend(args)
        return {"changes": []}

    monkeypatch.setattr(azure_deployment, "_run_azure", fake_run_azure)
    manifest = DeploymentManifest.model_validate(
        {
            **PACKAGE_REQUEST,
            "subscriptionId": "cdcf2cb6-afa4-4076-abe1-ac97a899a308",
        }
    )

    response = azure_deployment.run_what_if(manifest, "abc123")

    assert "--no-pretty-print" in captured_args
    assert captured_args[captured_args.index("--name") + 1] == "whatif-quality-rag-poc-eastus2"
    assert "deploymentStamp=abc123" in captured_args
    assert captured_args[captured_args.index("--output") + 1] == "json"
    assert response["result"] == {"changes": []}


def test_deploy_submits_without_waiting(monkeypatch) -> None:
    captured_args: list[str] = []

    def fake_run_azure(args: list[str], *, expect_json: bool = True) -> dict[str, object]:
        captured_args.extend(args)
        assert expect_json is False
        return {}

    monkeypatch.setattr(azure_deployment, "_run_azure", fake_run_azure)
    manifest = DeploymentManifest.model_validate(
        {
            **PACKAGE_REQUEST,
            "subscriptionId": "cdcf2cb6-afa4-4076-abe1-ac97a899a308",
        }
    )

    response = azure_deployment.deploy(manifest, "abc123")

    assert "--no-wait" in captured_args
    assert "deploymentStamp=abc123" in captured_args
    assert response["state"] == "Submitted"
    assert response["deploymentName"].startswith("quality-rag-poc-")


def test_region_assessment_checks_models_quota_and_capacity_caveat(monkeypatch) -> None:
    def fake_run_azure(args: list[str], *, expect_json: bool = True):
        if args[:2] == ["provider", "show"]:
            namespace = args[args.index("--namespace") + 1]
            resource_types = {
                "Microsoft.CognitiveServices": "accounts",
                "Microsoft.ManagedIdentity": "userAssignedIdentities",
                "Microsoft.Storage": "storageAccounts",
                "Microsoft.Search": "searchServices",
            }
            return {
                "resourceTypes": [
                    {
                        "resourceType": resource_types[namespace],
                        "locations": ["East US", "East US 2", "West US 3"],
                    }
                ]
            }
        if args[:3] == ["cognitiveservices", "model", "list"]:
            return [
                {
                    "model": {
                        "name": "gpt-5-mini",
                        "version": "2025-08-07",
                        "skus": [{"name": "GlobalStandard"}],
                    }
                },
                {
                    "model": {
                        "name": "text-embedding-3-small",
                        "version": "1",
                        "skus": [{"name": "GlobalStandard"}],
                    }
                },
            ]
        if args[:3] == ["cognitiveservices", "usage", "list"]:
            return [
                {"name": {"value": "OpenAI.GlobalStandard.gpt-5-mini"}, "currentValue": 0, "limit": 100},
                {"name": {"value": "OpenAI.GlobalStandard.text-embedding-3-small"}, "currentValue": 10, "limit": 100},
            ]
        raise AssertionError(args)

    monkeypatch.setattr(region_assessment, "_run_azure", fake_run_azure)
    response = client.post(
        "/api/regions/assess",
        json={
            "subscriptionId": "cdcf2cb6-afa4-4076-abe1-ac97a899a308",
            "preferredRegion": "eastus2",
            "candidateRegions": ["eastus2", "eastus", "westus3"],
            "resources": ["foundry", "managed-identity", "storage", "ai-search", "chat-model", "embedding-model"],
            "chatModel": PACKAGE_REQUEST["chatModel"],
            "embeddingModel": PACKAGE_REQUEST["embeddingModel"],
        },
    )
    assert response.status_code == 200
    result = response.json()
    assert result["recommendedRegion"] == "eastus"
    assert result["regions"][0]["region"] == "eastus"
    assert result["regions"][0]["status"] == "conditional"
    checks = {check["name"]: check for check in result["regions"][0]["checks"]}
    assert checks["gpt-5-mini"]["status"] == "pass"
    assert checks["text-embedding-3-small"]["status"] == "pass"
    assert checks["Azure AI Search live capacity"]["status"] == "warn"
    east_us_2 = next(region for region in result["regions"] if region["region"] == "eastus2")
    west_us_3 = next(region for region in result["regions"] if region["region"] == "westus3")
    assert east_us_2["status"] == "blocked"
    assert west_us_3["status"] == "blocked"
    assert any(check["name"] == "Recent POC deployment evidence" for check in east_us_2["checks"])
    assert any(check["name"] == "Recent POC deployment evidence" for check in west_us_3["checks"])
