import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

from core.config import INFRASTRUCTURE_ROOT
from core.platform_resources import get_platform_resource_profile
from domain.resource_catalog import describe_resources, resolve_resources, to_bicep_parameters
from models.schemas import (
    ArchitecturePackageRequest,
    ArchitecturePlanRequest,
    DeploymentManifest,
    PlatformResourceReferences,
)
from services.architecture_planner import create_architecture_plan
from services.artifact_repository import (
    ArtifactNotFoundError,
    get_artifact_repository,
    package_path,
)

CATALOG_ROOT = INFRASTRUCTURE_ROOT
PACKAGE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9._-]+$")


class PackageError(RuntimeError):
    pass


def _validate_package_id(package_id: str) -> None:
    if not PACKAGE_ID_PATTERN.fullmatch(package_id):
        raise PackageError("Invalid package ID.")


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


def _as_manifest(request: ArchitecturePackageRequest) -> DeploymentManifest:
    profile = get_platform_resource_profile()
    if request.location != profile.location:
        raise PackageError(
            f"Packages must use the configured platform location {profile.location}."
        )
    return DeploymentManifest(
        **request.model_dump(by_alias=True),
        subscriptionId=profile.subscription_id,
        platformResources=PlatformResourceReferences.model_validate(
            profile.model_dump(by_alias=True)
        ),
    )


def _compile_bicep(directory: Path) -> None:
    azure_cli = shutil.which("az")
    if not azure_cli:
        raise PackageError("Azure CLI with Bicep is required to generate packages.")
    try:
        subprocess.run(
            [
                azure_cli,
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


def _enforce_existing_resource_topology(directory: Path) -> None:
    compiled = json.loads((directory / "main.json").read_text(encoding="utf-8"))
    resource_types = set(_resource_types(compiled))
    forbidden = {
        "microsoft.resources/resourcegroups",
        "microsoft.cognitiveservices/accounts",
        "microsoft.storage/storageaccounts",
        "microsoft.documentdb/databaseaccounts",
        "microsoft.search/searchservices",
        "microsoft.managedidentity/userassignedidentities",
        "microsoft.network/virtualnetworks",
    }
    created_forbidden = sorted(forbidden & resource_types)
    if created_forbidden:
        raise PackageError(
            "Safety check failed: package creates platform parent resources: "
            + ", ".join(created_forbidden)
        )
    if "microsoft.cognitiveservices/accounts/projects" not in resource_types:
        raise PackageError("Safety check failed: package does not create a Foundry project.")


def _hash_files(directory: Path, names: list[str]) -> str:
    digest = hashlib.sha256()
    for name in sorted(names):
        digest.update(name.encode("utf-8"))
        digest.update((directory / name).read_bytes())
    return digest.hexdigest()


def _source_files(directory: Path) -> list[str]:
    return sorted(
        path.relative_to(directory).as_posix()
        for path in directory.rglob("*")
        if path.is_file() and path.name != "main.json"
    )


def _write_package_artifacts(
    package_id: str, directory: Path, names: list[str], metadata: dict[str, object]
) -> None:
    repository = get_artifact_repository()
    for name in [*names, "main.json"]:
        repository.write(
            package_path(package_id, name),
            (directory / name).read_bytes(),
        )
    repository.write(
        package_path(package_id, "package-metadata.json"),
        (json.dumps(metadata, indent=2) + "\n").encode(),
    )


def create_package(request: ArchitecturePackageRequest) -> dict[str, object]:
    required_templates = [
        CATALOG_ROOT / "main.bicep",
        CATALOG_ROOT / "modules" / "foundry.bicep",
        CATALOG_ROOT / "modules" / "storage-container.bicep",
        CATALOG_ROOT / "modules" / "cosmos-container.bicep",
    ]
    missing_templates = [str(path.relative_to(CATALOG_ROOT)) for path in required_templates if not path.is_file()]
    if missing_templates:
        raise PackageError("Canonical Bicep template missing: " + ", ".join(missing_templates))

    package_id = f"{request.application_id}-g-{str(uuid4())[:8]}"
    manifest = _as_manifest(request)
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

    with tempfile.TemporaryDirectory(prefix="launchpad-package-") as temporary:
        directory = Path(temporary)
        shutil.copytree(CATALOG_ROOT, directory, dirs_exist_ok=True)
        parameters = to_bicep_parameters(manifest)
        parameters["deploymentStamp"] = package_id.rsplit("-", 1)[-1][:6]
        parameter_text = "using 'main.bicep'\n\n" + "\n".join(
            f"param {key} = {_bicep_value(value)}" for key, value in parameters.items()
        ) + "\n"
        (directory / "main.bicepparam").write_text(parameter_text, encoding="utf-8")
        (directory / "deployment-manifest.json").write_text(
            manifest.model_dump_json(by_alias=True, exclude_none=True, indent=2) + "\n",
            encoding="utf-8",
        )
        (directory / "architecture-plan.json").write_text(
            json.dumps(architecture_plan, indent=2) + "\n", encoding="utf-8"
        )
        _compile_bicep(directory)
        _enforce_existing_resource_topology(directory)
        source_files = _source_files(directory)
        package_hash = _hash_files(directory, source_files)
        metadata = {
            "packageId": package_id,
            "applicationId": request.application_id,
            "createdAt": datetime.now(UTC).isoformat(),
            "sha256": package_hash,
            "resources": resolve_resources(request.resources),
            "compiledTemplate": "main.json",
            "files": source_files,
        }
        _write_package_artifacts(package_id, directory, source_files, metadata)
    return get_package(package_id)


def read_package_file(package_id: str, name: str) -> bytes:
    _validate_package_id(package_id)
    if name.startswith("/") or ".." in Path(name).parts:
        raise PackageError("Invalid package file path.")
    try:
        return get_artifact_repository().read(package_path(package_id, name))
    except ArtifactNotFoundError as error:
        raise PackageError("Generated Bicep package was not found.") from error


def get_package(package_id: str) -> dict[str, object]:
    try:
        metadata = json.loads(read_package_file(package_id, "package-metadata.json"))
        manifest = DeploymentManifest.model_validate_json(
            read_package_file(package_id, "deployment-manifest.json")
        )
    except (json.JSONDecodeError, KeyError, ValueError) as error:
        raise PackageError("Generated package metadata is invalid.") from error
    file_names = [str(name) for name in metadata.get("files", [])]
    return {
        **metadata,
        **manifest.model_dump(by_alias=True, mode="json"),
        "files": [
            {"path": name, "content": read_package_file(package_id, name).decode()}
            for name in file_names
        ],
        "resourceDetails": describe_resources(resolve_resources(manifest.resources)),
    }


def save_deployment_outputs(
    package_id: str,
    subscription_id: str,
    deployment: dict[str, object],
) -> dict[str, object]:
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
    get_artifact_repository().write(
        package_path(package_id, "deployment-outputs.json"),
        (json.dumps(artifact, indent=2) + "\n").encode(),
        overwrite=True,
    )
    return artifact


def get_deployment_outputs(package_id: str) -> dict[str, object] | None:
    try:
        value = json.loads(read_package_file(package_id, "deployment-outputs.json"))
    except PackageError:
        return None
    return value if isinstance(value, dict) else None


def package_manifest(
    package_id: str,
    subscription_id: str,
) -> tuple[DeploymentManifest, str]:
    manifest = DeploymentManifest.model_validate_json(
        read_package_file(package_id, "deployment-manifest.json")
    )
    if str(manifest.subscription_id) != subscription_id:
        raise PackageError("Package subscription does not match the configured platform subscription.")
    metadata = json.loads(read_package_file(package_id, "package-metadata.json"))
    source_files = [str(name) for name in metadata.get("files", [])]
    digest = hashlib.sha256()
    for name in sorted(source_files):
        digest.update(name.encode("utf-8"))
        digest.update(read_package_file(package_id, name))
    current_hash = digest.hexdigest()
    if current_hash != metadata["sha256"]:
        raise PackageError("Generated package integrity check failed; approve a new package.")
    return manifest, current_hash


@contextmanager
def materialize_package(package_id: str) -> Iterator[Path]:
    metadata = json.loads(read_package_file(package_id, "package-metadata.json"))
    with tempfile.TemporaryDirectory(prefix="launchpad-deploy-") as temporary:
        directory = Path(temporary)
        for name in metadata.get("files", []):
            if not str(name).endswith((".bicep", ".bicepparam")):
                continue
            target = directory / str(name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(read_package_file(package_id, str(name)))
        yield directory / "main.bicep"
