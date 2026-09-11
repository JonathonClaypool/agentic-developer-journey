from fastapi import APIRouter

from domain.recommendations import get_catalog, recommend_model
from models.schemas import ModelRecommendationRequest

router = APIRouter(prefix="/api", tags=["catalog"])


@router.get("/catalog")
def catalog() -> dict[str, object]:
    return get_catalog()


@router.post("/recommendations/model")
def model_recommendation(request: ModelRecommendationRequest) -> dict[str, object]:
    return recommend_model(request)
