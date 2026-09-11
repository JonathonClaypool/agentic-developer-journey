from fastapi import APIRouter

from models.schemas import ArchitecturePlanRequest
from services.architecture_planner import create_architecture_plan

router = APIRouter(prefix="/api/architecture", tags=["architecture"])


@router.post("/plan")
def plan_architecture(request: ArchitecturePlanRequest) -> dict[str, object]:
    return create_architecture_plan(request)
