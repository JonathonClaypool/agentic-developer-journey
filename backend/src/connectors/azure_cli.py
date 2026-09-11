import json
import logging
import os
import signal
import subprocess
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from core.config import INFRASTRUCTURE_ROOT
from domain.resource_catalog import to_bicep_parameters
from models.schemas import DeploymentManifest

TEMPLATE_PATH = INFRASTRUCTURE_ROOT / "main.bicep"
logger = logging.getLogger("launchpad.azure")


class AzureCommandError(RuntimeError):
    pass


def _parameter_arguments(manifest: DeploymentManifest) -> list[str]:
    parameters = to_bicep_parameters(manifest)
    return [
        f"{key}={json.dumps(value, separators=(',', ':')) if isinstance(value, dict) else str(value).lower() if isinstance(value, bool) else value}"
        for key, value in parameters.items()
    ]


def _run_azure(args: list[str], *, expect_json: bool = True) -> Any:
    environment = {**os.environ, "AZURE_CORE_ONLY_SHOW_ERRORS": "true"}
    timeout_seconds = max(30, int(os.getenv("AZURE_COMMAND_TIMEOUT_SECONDS", "600")))
    heartbeat_seconds = max(5, int(os.getenv("AZURE_COMMAND_HEARTBEAT_SECONDS", "30")))
    operation = " ".join(args[:3])
    started = time.perf_counter()
    try:
        process = subprocess.Popen(
            ["az", *args],
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
    template_path: Path = TEMPLATE_PATH,
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
            "resourceGroup": manifest.resource_group_name,
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
            f"resourceGroupName={manifest.resource_group_name}",
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
    template_path: Path = TEMPLATE_PATH,
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
            f"resourceGroupName={manifest.resource_group_name}",
            f"deploymentStamp={deployment_stamp}",
            *_parameter_arguments(manifest),
            "--no-wait",
        ],
        expect_json=False,
    )
    return {"deploymentName": deployment_name, "state": "Submitted"}


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
    nested_name = f"deploy-{manifest.workload_name}-resources"
    try:
        operations = _run_azure(
            [
                "deployment",
                "operation",
                "group",
                "list",
                "--subscription",
                str(manifest.subscription_id),
                "--resource-group",
                manifest.resource_group_name,
                "--name",
                nested_name,
                "--output",
                "json",
            ]
        )
        for operation in operations:
            operation_properties = operation.get("properties", {})
            target = operation_properties.get("targetResource") or {}
            if not isinstance(target, dict):
                continue
            resource_id = target.get("id")
            if not resource_id:
                continue
            status_message = operation_properties.get("statusMessage") or {}
            error = status_message.get("error") if isinstance(status_message, dict) else None
            resources.append(
                {
                    "resourceId": resource_id,
                    "name": target.get("resourceName"),
                    "type": target.get("resourceType"),
                    "state": operation_properties.get("provisioningState", "Running"),
                    "error": error,
                }
            )
    except AzureCommandError:
        # The nested deployment may not exist during the first few ARM polling cycles.
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


def delete_resource_group(subscription_id: str, resource_group_name: str) -> dict[str, str]:
    _run_azure(
        [
            "group",
            "delete",
            "--subscription",
            subscription_id,
            "--name",
            resource_group_name,
            "--yes",
            "--no-wait",
        ],
        expect_json=False,
    )
    return {"status": "deletion-started"}
