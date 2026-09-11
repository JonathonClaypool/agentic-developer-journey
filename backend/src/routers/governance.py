from fastapi import APIRouter

from domain.governance import assess_risk
from models.schemas import RiskAssessmentRequest

router = APIRouter(prefix="/api/governance", tags=["governance"])


@router.post("/risk-assessment")
def risk_assessment(request: RiskAssessmentRequest) -> dict[str, object]:
    return assess_risk(request)
