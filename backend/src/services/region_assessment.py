from core.platform_resources import get_platform_resource_profile
from models.schemas import RegionAssessmentRequest


def assess_regions(request: RegionAssessmentRequest) -> dict[str, object]:
    profile = get_platform_resource_profile()
    if request.subscription_id != profile.subscription_id:
        raise ValueError("Region assessment must use the configured platform subscription.")

    checks = [
        {
            "name": "Platform resource profile",
            "status": "pass",
            "detail": "Foundry, Storage, Cosmos DB, and Azure AI Search are preconfigured.",
        },
        {
            "name": request.chat_model.name,
            "status": "warn",
            "detail": "Model availability and quota are confirmed by Azure what-if before deployment.",
        },
    ]
    if request.embedding_model:
        checks.append(
            {
                "name": request.embedding_model.name,
                "status": "warn",
                "detail": "Model availability and quota are confirmed by Azure what-if before deployment.",
            }
        )
    return {
        "recommendedRegion": profile.location,
        "regions": [
            {
                "region": profile.location,
                "label": profile.location,
                "preferred": True,
                "status": "conditional",
                "score": 95,
                "checks": checks,
                "models": [],
            }
        ],
        "disclaimer": (
            "The platform resource location is configured by the backend. "
            "Azure what-if remains the authoritative pre-deployment validation."
        ),
    }
