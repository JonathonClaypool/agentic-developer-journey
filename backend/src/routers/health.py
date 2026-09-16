import logging

from azure.core.exceptions import AzureError
from fastapi import APIRouter, HTTPException

from connectors.azure_cli import check_azure_session
from core.settings import DEPLOYMENTS_ENABLED
from services.artifact_repository import get_artifact_repository

router = APIRouter(prefix="/api", tags=["health"])
logger = logging.getLogger("launchpad.api")


@router.get("/health/live")
def liveness() -> dict[str, str]:
    return {"status": "live"}


@router.get("/health/ready")
def readiness() -> dict[str, str]:
    try:
        get_artifact_repository().check()
    except (AzureError, OSError, RuntimeError) as error:
        logger.error(
            "artifact_store.readiness.failed",
            extra={"errorType": type(error).__name__},
        )
        raise HTTPException(
            status_code=503, detail="The deployment artifact store is unavailable."
        ) from error
    return {"status": "ready", "artifactStore": "available"}


@router.get("/health")
def health() -> dict[str, object]:
    return {
        "service": "deployment-api",
        "runtime": "python-fastapi",
        "azure": check_azure_session(),
        "deploymentsEnabled": DEPLOYMENTS_ENABLED,
    }
