import json
import logging
import os
import signal
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from domain.resource_catalog import to_bicep_parameters
from models.schemas import DeploymentManifest

logger = logging.getLogger("launchpad.azure")
_workload_identity_login_lock = threading.Lock()


class AzureCommandError(RuntimeError):
    pass


def _parameter_arguments(manifest: DeploymentManifest) -> list[str]:
    parameters = to_bicep_parameters(manifest)
    return [
        f"{key}={json.dumps(value, separators=(',', ':')) if isinstance(value, dict) else str(value).lower() if isinstance(value, bool) else value}"
        for key, value in parameters.items()
    ]


def _login_with_workload_identity(
    azure_cli: str, environment: dict[str, str], timeout_seconds: int
) -> None:
    client_id = environment.get("AZURE_CLIENT_ID", "").strip()
    tenant_id = environment.get("AZURE_TENANT_ID", "").strip()
    token_file = environment.get("AZURE_FEDERATED_TOKEN_FILE", "").strip()
    configured = [client_id, tenant_id, token_file]
    if not any(configured):
        return
    if not all(configured):
        raise AzureCommandError(
            "AKS workload identity is incomplete. AZURE_CLIENT_ID, AZURE_TENANT_ID, "
            "and AZURE_FEDERATED_TOKEN_FILE must all be configured."
        )

    token_path = Path(token_file)
    if not token_path.is_file():
        raise AzureCommandError("The AKS workload identity token file is unavailable.")

    with _workload_identity_login_lock:
        result = subprocess.run(
            [
                azure_cli,
                "login",
                "--service-principal",
                "--username",
                client_id,
                "--tenant",
                tenant_id,
                "--federated-token",
                token_path.read_text().strip(),
                "--allow-no-subscriptions",
                "--only-show-errors",
                "--output",
                "none",
            ],
            capture_output=True,
            text=True,
            env=environment,
            timeout=min(timeout_seconds, 60),
            check=False,
        )
    if result.returncode != 0:
        detail = result.stderr.strip() or "Azure workload identity authentication failed."
        logger.error("azure.workload_identity_login.failed", extra={"error": detail[-2000:]})
        raise AzureCommandError(detail)


def _run_azure(args: list[str], *, expect_json: bool = True) -> Any:
    environment = {**os.environ, "AZURE_CORE_ONLY_SHOW_ERRORS": "true"}
    timeout_seconds = max(30, int(os.getenv("AZURE_COMMAND_TIMEOUT_SECONDS", "600")))
    heartbeat_seconds = max(5, int(os.getenv("AZURE_COMMAND_HEARTBEAT_SECONDS", "30")))
    operation = " ".join(args[:3])
    started = time.perf_counter()
    azure_cli = shutil.which("az")
    if not azure_cli:
        logger.error("azure.command.missing", extra={"operation": operation})
        raise AzureCommandError("Azure CLI is not installed on the backend host.")
    try:
        _login_with_workload_identity(azure_cli, environment, timeout_seconds)
    except (OSError, subprocess.SubprocessError) as error:
        logger.exception("azure.workload_identity_login.failed")
        raise AzureCommandError("Azure workload identity authentication failed.") from error
    try:
        process = subprocess.Popen(
            [azure_cli, *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=environment,
            start_new_session=True,
        )
    except FileNotFoundError as error:
        logger.error("azure.command.missing", extra={"operation": operation})
        raise AzureCommandError("Azure CLI is not installed on the backend host.") from error

    logger.info(
        "azure.command.started",
        extra={"operation": operation, "processId": process.pid, "timeoutSeconds": timeout_seconds},
    )
    stdout = ""
    stderr = ""
    while True:
        elapsed = time.perf_counter() - started
        remaining = timeout_seconds - elapsed
        if remaining <= 0:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                stdout, stderr = process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                stdout, stderr = process.communicate()
            logger.error(
                "azure.command.timed_out",
                extra={
                    "operation": operation,
                    "processId": process.pid,
                    "elapsedSeconds": round(time.perf_counter() - started, 3),
                    "stderrTail": stderr.strip()[-2000:],
                },
            )
            raise AzureCommandError(
                f"Azure command '{operation}' timed out after {timeout_seconds} seconds. "
                "Retry the operation and use the response X-Correlation-ID to locate its logs."
            )
        try:
            stdout, stderr = process.communicate(timeout=min(heartbeat_seconds, remaining))
            break
        except subprocess.TimeoutExpired:
            logger.info(
                "azure.command.running",
                extra={
                    "operation": operation,
                    "processId": process.pid,
                    "elapsedSeconds": round(time.perf_counter() - started, 3),
                },
            )

    elapsed = round(time.perf_counter() - started, 3)
    if process.returncode != 0:
        detail = stderr.strip() or stdout.strip() or "Azure command failed."
        logger.error(
            "azure.command.failed",
            extra={
                "operation": operation,
                "processId": process.pid,
                "exitCode": process.returncode,
                "elapsedSeconds": elapsed,
                "error": detail[-4000:],
            },
        )
        raise AzureCommandError(detail)
    logger.info(
        "azure.command.completed",
        extra={
            "operation": operation,
            "processId": process.pid,
            "exitCode": process.returncode,
            "elapsedSeconds": elapsed,
            "responseBytes": len(stdout.encode("utf-8")),
        },
    )

    if not expect_json:
        return {}
    output = stdout.strip()
    return json.loads(output) if output else {}


def check_azure_session() -> dict[str, object]:
    try:
        account = _run_azure(["account", "show", "--output", "json"])
        return {
            "ready": True,
            "subscriptionId": account.get("id"),
            "subscriptionName": account.get("name"),
            "identity": account.get("user", {}).get("name"),
        }
    except (AzureCommandError, json.JSONDecodeError):
        return {
            "ready": False,
            "message": "Azure CLI authentication is required on the backend host.",
        }


def run_what_if(
    manifest: DeploymentManifest,
    deployment_stamp: str,
    template_path: Path,
) -> dict[str, object]:
    # Subscription deployment names are permanently associated with their first
    # location. Include the region so validation never collides with Azure CLI's
    # default "main" deployment or a prior validation in another region.
    validation_name = f"whatif-{manifest.workload_name}-{manifest.location}"
    logger.info(
        "what_if.azure_preflight.started",
        extra={
            "deploymentName": validation_name,
            "location": manifest.location,
            "resourceCount": len(manifest.resources),
            "chatModel": manifest.chat_model.name,
            "embeddingModel": manifest.embedding_model.name if manifest.embedding_model else None,
        },
    )
    result = _run_azure(
        [
            "deployment",
            "sub",
            "what-if",
            "--name",
            validation_name,
            "--subscription",
            str(manifest.subscription_id),
            "--location",
            manifest.location,
            "--template-file",
            str(template_path),
            "--parameters",
            f"deploymentStamp={deployment_stamp}",
            *_parameter_arguments(manifest),
            "--result-format",
            "ResourceIdOnly",
            "--no-pretty-print",
            "--output",
            "json",
        ]
    )
    return {
        "manifest": manifest.model_dump(by_alias=True, mode="json"),
        "parameters": to_bicep_parameters(manifest),
        "result": result,
    }


def deploy(
    manifest: DeploymentManifest,
    deployment_stamp: str,
    template_path: Path,
) -> dict[str, object]:
    deployment_name = f"{manifest.workload_name}-{str(uuid4())[:8]}"
    _run_azure(
        [
            "deployment",
            "sub",
            "create",
            "--name",
            deployment_name,
            "--subscription",
            str(manifest.subscription_id),
            "--location",
            manifest.location,
            "--template-file",
            str(template_path),
            "--parameters",
            f"deploymentStamp={deployment_stamp}",
            *_parameter_arguments(manifest),
            "--no-wait",
        ],
        expect_json=False,
    )
    return {"deploymentName": deployment_name, "state": "Submitted"}


def _operation_resource(operation: dict[str, object]) -> dict[str, object] | None:
    operation_properties = operation.get("properties", {})
    if not isinstance(operation_properties, dict):
        return None
    target = operation_properties.get("targetResource") or {}
    if not isinstance(target, dict) or not target.get("id"):
        return None
    status_message = operation_properties.get("statusMessage") or {}
    error = status_message.get("error") if isinstance(status_message, dict) else None
    return {
        "resourceId": target["id"],
        "name": target.get("resourceName"),
        "type": target.get("resourceType"),
        "state": operation_properties.get("provisioningState", "Running"),
        "error": error,
    }


def _resource_group_from_id(resource_id: str) -> str | None:
    segments = [segment for segment in resource_id.split("/") if segment]
    for index, segment in enumerate(segments[:-1]):
        if segment.lower() == "resourcegroups":
            return segments[index + 1]
    return None


def deployment_status(manifest: DeploymentManifest, deployment_name: str) -> dict[str, object]:
    deployment = _run_azure(
        [
            "deployment",
            "sub",
            "show",
            "--subscription",
            str(manifest.subscription_id),
            "--name",
            deployment_name,
            "--output",
            "json",
        ]
    )
    properties = deployment.get("properties", {})
    raw_outputs = properties.get("outputs") or {}
    deployment_output = raw_outputs.get("deployment", {}) if isinstance(raw_outputs, dict) else {}
    outputs = deployment_output.get("value", {}) if isinstance(deployment_output, dict) else {}
    if not isinstance(outputs, dict):
        outputs = {}
    resources: list[dict[str, object]] = []
    try:
        operations = _run_azure(
            [
                "deployment",
                "operation",
                "sub",
                "list",
                "--subscription",
                str(manifest.subscription_id),
                "--name",
                deployment_name,
                "--output",
                "json",
            ]
        )
        for operation in operations:
            resource = _operation_resource(operation)
            if resource is None:
                continue
            if str(resource.get("type", "")).lower() != "microsoft.resources/deployments":
                resources.append(resource)
                continue
            resource_group = _resource_group_from_id(str(resource["resourceId"]))
            nested_name = resource.get("name")
            if not resource_group or not nested_name:
                resources.append(resource)
                continue
            try:
                nested_operations = _run_azure(
                    [
                        "deployment",
                        "operation",
                        "group",
                        "list",
                        "--subscription",
                        str(manifest.subscription_id),
                        "--resource-group",
                        resource_group,
                        "--name",
                        str(nested_name),
                        "--output",
                        "json",
                    ]
                )
            except AzureCommandError:
                resources.append(resource)
                continue
            nested_resources = [
                item
                for nested_operation in nested_operations
                if (item := _operation_resource(nested_operation)) is not None
            ]
            resources.extend(nested_resources or [resource])
    except AzureCommandError:
        # Deployment operations may not be visible during the first few ARM polling cycles.
        pass

    return {
        "deploymentName": deployment_name,
        "state": properties.get("provisioningState", "Running"),
        "timestamp": properties.get("timestamp"),
        "duration": properties.get("duration"),
        "error": properties.get("error"),
        "outputs": outputs,
        "resources": resources,
    }
