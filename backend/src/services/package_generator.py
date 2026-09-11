import hashlib
import json
import re
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from core.config import GENERATED_PACKAGES_ROOT, INFRASTRUCTURE_ROOT
from domain.resource_catalog import describe_resources, resolve_resources, to_bicep_parameters
from models.schemas import ArchitecturePackageRequest, DeploymentManifest
from models.schemas import ArchitecturePlanRequest
from services.architecture_planner import create_architecture_plan

CATALOG_ROOT = INFRASTRUCTURE_ROOT
GENERATED_ROOT = GENERATED_PACKAGES_ROOT
PACKAGE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9._-]+$")


class PackageError(RuntimeError):
    pass


def _bicep_value(value: Any, indent: int = 0) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    if isinstance(value, dict):
        spacing = " " * indent
        entries = "\n".join(
            f"{' ' * (indent + 2)}{key}: {_bicep_value(item, indent + 2)}"
            for key, item in value.items()
        )
        return f"{{\n{entries}\n{spacing}}}"
    raise PackageError(f"Unsupported Bicep parameter value: {type(value).__name__}")


def _as_manifest(
    request: ArchitecturePackageRequest,
    subscription_id: str,
) -> DeploymentManifest:
    return DeploymentManifest(
        subscriptionId=subscription_id,
        location=request.location,
        resourceGroupName=request.resource_group_name,
        workloadName=request.workload_name,
        resources=request.resources,
        chatModel=request.chat_model,
        embeddingModel=request.embedding_model,
        operationalRequirements=request.operational_requirements,
        tags=request.tags,
    )


def _package_directory(package_id: str) -> Path:
    if not PACKAGE_ID_PATTERN.fullmatch(package_id):
        raise PackageError("Invalid package ID.")
    directory = (GENERATED_ROOT / package_id).resolve()
    if GENERATED_ROOT.resolve() not in directory.parents:
        raise PackageError("Invalid package path.")
    return directory


def _compile_bicep(directory: Path) -> None:
    try:
        subprocess.run(
            [
                "az",
                "bicep",
                "build",
                "--file",
                str(directory / "main.bicep"),
                "--outfile",
                str(directory / "main.json"),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as error:
        raise PackageError("Azure CLI with Bicep is required to generate packages.") from error
    except subprocess.CalledProcessError as error:
        detail = error.stderr.strip() or error.stdout.strip() or "Bicep compilation failed."
        raise PackageError(detail) from error


def _resource_types(value: Any) -> list[str]:
    resource_types: list[str] = []
    if isinstance(value, dict):
        resource_type = value.get("type")
        if isinstance(resource_type, str):
            resource_types.append(resource_type.lower())
        for child in value.values():
            resource_types.extend(_resource_types(child))
    elif isinstance(value, list):
        for child in value:
            resource_types.extend(_resource_types(child))
    return resource_types


def _enforce_foundry_topology(directory: Path) -> None:
    compiled = json.loads((directory / "main.json").read_text(encoding="utf-8"))
    resource_types = _resource_types(compiled)
    account_type = "microsoft.cognitiveservices/accounts"
    project_type = "microsoft.cognitiveservices/accounts/projects"
    if account_type not in resource_types:
        raise PackageError(
            "Safety check failed: the package does not contain a Microsoft Foundry account."
        )
    if project_type not in resource_types:
        raise PackageError(
            "Safety check failed: the package does not contain a Microsoft Foundry project."
        )


def _hash_files(directory: Path, names: list[str]) -> str:
    digest = hashlib.sha256()
    for name in sorted(names):
        digest.update(name.encode())
        digest.update((directory / name).read_bytes())
    return digest.hexdigest()


def create_package(request: ArchitecturePackageRequest) -> dict[str, object]:
    missing_templates = [
        path.name
        for path in (CATALOG_ROOT / "main.bicep", CATALOG_ROOT / "resources.bicep")
        if not path.is_file()
    ]
    if missing_templates:
        raise PackageError(
            "Canonical Bicep template missing: " + ", ".join(missing_templates)
        )

    package_id = f"{request.application_id}-g-{str(uuid4())[:8]}"
    directory = _package_directory(package_id)
    placeholder_subscription = "00000000-0000-0000-0000-000000000000"
    manifest = _as_manifest(
        request,
        placeholder_subscription,
    )
    architecture_plan = create_architecture_plan(
        ArchitecturePlanRequest(
            resources=request.resources,
            primaryRegion=request.location,
            operationalRequirements=request.operational_requirements,
        )
    )
    if not architecture_plan["deployable"]:
        raise PackageError(
            "Architecture plan is not deployable: "
            + "; ".join(architecture_plan["blockers"])
        )
    directory.mkdir(parents=True, exist_ok=False)
    shutil.copy2(CATALOG_ROOT / "main.bicep", directory / "main.bicep")
    shutil.copy2(CATALOG_ROOT / "resources.bicep", directory / "resources.bicep")
    parameters = to_bicep_parameters(manifest)
    parameters["resourceGroupName"] = request.resource_group_name
    # The stamp is immutable within this package (safe retries) but changes for
    # every newly approved package, avoiding Cognitive Services soft-delete
    # name collisions after a prior POC resource group has been removed.
    parameters["deploymentStamp"] = package_id.rsplit("-", 1)[-1][:6]
    parameter_text = "using 'main.bicep'\n\n" + "\n".join(
        f"param {key} = {_bicep_value(value)}" for key, value in parameters.items()
    ) + "\n"
    (directory / "main.bicepparam").write_text(parameter_text, encoding="utf-8")
    (directory / "deployment-manifest.json").write_text(
        request.model_dump_json(by_alias=True, exclude_none=True, indent=2) + "\n",
        encoding="utf-8",
    )
    (directory / "architecture-plan.json").write_text(
        json.dumps(architecture_plan, indent=2) + "\n", encoding="utf-8"
    )

    _compile_bicep(directory)
    _enforce_foundry_topology(directory)
    source_files = [
        "main.bicep",
        "resources.bicep",
        "main.bicepparam",
        "deployment-manifest.json",
        "architecture-plan.json",
    ]
    package_hash = _hash_files(directory, source_files)
    metadata = {
        "packageId": package_id,
        "applicationId": request.application_id,
        "createdAt": datetime.now(UTC).isoformat(),
        "sha256": package_hash,
        "resources": resolve_resources(request.resources),
        "compiledTemplate": "main.json",
    }
    (directory / "package-metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    return get_package(package_id)


def get_package(package_id: str) -> dict[str, object]:
    directory = _package_directory(package_id)
    if not directory.is_dir():
        raise PackageError("Generated Bicep package was not found.")
    metadata = json.loads((directory / "package-metadata.json").read_text(encoding="utf-8"))
    manifest = ArchitecturePackageRequest.model_validate_json(
        (directory / "deployment-manifest.json").read_text(encoding="utf-8")
    )
    file_names = [
        "main.bicep",
        "resources.bicep",
        "main.bicepparam",
        "deployment-manifest.json",
        "package-metadata.json",
    ]
    if (directory / "architecture-plan.json").is_file():
        file_names.insert(4, "architecture-plan.json")
    return {
        **metadata,
        "files": [
            {"path": name, "content": (directory / name).read_text(encoding="utf-8")}
            for name in file_names
        ],
        "resourceDetails": describe_resources(resolve_resources(manifest.resources)),
    }


def save_deployment_outputs(
    package_id: str,
    subscription_id: str,
    deployment: dict[str, object],
) -> dict[str, object]:
    directory = _package_directory(package_id)
    if not directory.is_dir():
        raise PackageError("Generated Bicep package was not found.")
    if deployment.get("state") != "Succeeded":
        raise PackageError("Only successful Azure deployment outputs can be recorded.")
    artifact = {
        "packageId": package_id,
        "deploymentName": deployment.get("deploymentName"),
        "subscriptionId": subscription_id,
        "capturedAt": datetime.now(UTC).isoformat(),
        "outputs": deployment.get("outputs") or {},
        "resources": deployment.get("resources") or [],
    }
    (directory / "deployment-outputs.json").write_text(
        json.dumps(artifact, indent=2) + "\n", encoding="utf-8"
    )
    return artifact


def get_deployment_outputs(package_id: str) -> dict[str, object] | None:
    directory = _package_directory(package_id)
    path = directory / "deployment-outputs.json"
    if not path.is_file():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    return value if isinstance(value, dict) else None


def package_manifest(
    package_id: str,
    subscription_id: str,
) -> tuple[DeploymentManifest, Path, str]:
    directory = _package_directory(package_id)
    if not directory.is_dir():
        raise PackageError("Generated Bicep package was not found.")
    request = ArchitecturePackageRequest.model_validate_json(
        (directory / "deployment-manifest.json").read_text(encoding="utf-8")
    )
    metadata = json.loads((directory / "package-metadata.json").read_text(encoding="utf-8"))
    source_files = [
        "main.bicep",
        "resources.bicep",
        "main.bicepparam",
        "deployment-manifest.json",
    ]
    if (directory / "architecture-plan.json").is_file():
        source_files.append("architecture-plan.json")
    current_hash = _hash_files(directory, source_files)
    if current_hash != metadata["sha256"]:
        raise PackageError("Generated package integrity check failed; approve a new package.")
    return (
        _as_manifest(
            request,
            subscription_id,
        ),
        directory / "main.bicep",
        metadata["sha256"],
    )
