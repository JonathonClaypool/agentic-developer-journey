from fastapi import APIRouter, HTTPException

from connectors.azure_cli import AzureCommandError
from models.schemas import RegionAssessmentRequest
from services.region_assessment import assess_regions

router = APIRouter(prefix="/api/regions", tags=["regions"])


@router.post("/assess")
def region_readiness(request: RegionAssessmentRequest) -> dict[str, object]:
    try:
        return assess_regions(request)
    except AzureCommandError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
