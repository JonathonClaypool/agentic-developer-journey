import json
import logging
import time
from dataclasses import dataclass
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status

from connectors.azure_cli import AzureCommandError, delete_resource_group, deploy, deployment_status, run_what_if
from core.settings import DEPLOYMENTS_ENABLED
from models.schemas import CleanupRequest, ConfirmedPackageDeployment, PackageTarget
from services.package_generator import PackageError, package_manifest, save_deployment_outputs

router = APIRouter(prefix="/api", tags=["deployments"])
logger = logging.getLogger("launchpad.api")


@dataclass
class WhatIfApproval:
    package_hash: str
    subscription_id: str
    expires_at: float


approved_what_ifs: dict[UUID, WhatIfApproval] = {}


@router.post("/packages/{package_id}/what-if")
def what_if(package_id: str, target: PackageTarget) -> dict[str, object]:
    started = time.perf_counter()
    logger.info("what_if.started", extra={"packageId": package_id, "subscriptionSuffix": str(target.subscription_id)[-4:]})
    try:
        manifest, template_path, package_hash = package_manifest(package_id, str(target.subscription_id))
        result = run_what_if(manifest, package_id.rsplit("-", 1)[-1][:6], template_path)
    except PackageError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (AzureCommandError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

    confirmation_token = uuid4()
    approved_what_ifs[confirmation_token] = WhatIfApproval(package_hash, str(target.subscription_id), time.time() + 600)
    logger.info("what_if.completed", extra={"packageId": package_id, "elapsedSeconds": round(time.perf_counter() - started, 3)})
    return {**result, "confirmationToken": str(confirmation_token), "expiresInSeconds": 600}


@router.post("/packages/{package_id}/deploy", status_code=status.HTTP_202_ACCEPTED)
def create_deployment(package_id: str, request: ConfirmedPackageDeployment) -> dict[str, object]:
    if not DEPLOYMENTS_ENABLED:
        raise HTTPException(status_code=503, detail="Azure creation is disabled. Set ENABLE_AZURE_DEPLOYMENTS=true on the backend only after deployment readiness approval.")
    try:
        manifest, template_path, package_hash = package_manifest(package_id, str(request.subscription_id))
    except PackageError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    approval = approved_what_ifs.pop(request.confirmation_token, None)
    if approval is None or approval.expires_at < time.time() or approval.package_hash != package_hash or approval.subscription_id != str(request.subscription_id):
        raise HTTPException(status_code=409, detail="A current successful what-if is required before deployment.")
    try:
        return deploy(manifest, package_id.rsplit("-", 1)[-1][:6], template_path)
    except (AzureCommandError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.post("/packages/{package_id}/deployments/{deployment_name}/status")
def read_deployment_status(package_id: str, deployment_name: str, target: PackageTarget) -> dict[str, object]:
    try:
        manifest, _, _ = package_manifest(package_id, str(target.subscription_id))
        result = deployment_status(manifest, deployment_name)
        if result.get("state") == "Succeeded":
            save_deployment_outputs(package_id, str(target.subscription_id), result)
        return result
    except PackageError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (AzureCommandError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.delete("/deployments/resource-group", status_code=status.HTTP_202_ACCEPTED)
def cleanup(request: CleanupRequest) -> dict[str, str]:
    if "poc" not in request.resource_group_name.lower():
        raise HTTPException(status_code=400, detail="POC cleanup is restricted to resource groups containing poc.")
    if not DEPLOYMENTS_ENABLED:
        raise HTTPException(status_code=503, detail="Azure creation and cleanup are disabled.")
    try:
        return delete_resource_group(str(request.subscription_id), request.resource_group_name)
    except AzureCommandError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
