from fastapi import APIRouter

from connectors.azure_cli import check_azure_session
from core.settings import DEPLOYMENTS_ENABLED

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health() -> dict[str, object]:
    return {
        "service": "deployment-api",
        "runtime": "python-fastapi",
        "azure": check_azure_session(),
        "deploymentsEnabled": DEPLOYMENTS_ENABLED,
    }
