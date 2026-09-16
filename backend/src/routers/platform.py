from fastapi import APIRouter, HTTPException

from core.platform_resources import get_platform_resource_profile

router = APIRouter(prefix="/api/platform", tags=["platform"])


@router.get("/resources")
def platform_resources() -> dict[str, object]:
    try:
        profile = get_platform_resource_profile()
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {
        "provisioningMode": "existing-resources",
        **profile.model_dump(by_alias=True, mode="json"),
        "createNewResourcesAvailable": False,
    }
