from models.schemas import ModelRecommendationRequest

MODEL_CATALOG: list[dict[str, str]] = [
    {
        "id": "gpt-5-mini",
        "name": "GPT-5 mini",
        "tier": "Efficient reasoning",
        "description": "Fast, cost-efficient reasoning for grounded enterprise assistants and high-volume content work.",
        "bestFor": "Summarization, grounded Q&A, extraction, and classification",
        "latency": "Low",
        "cost": "$",
        "context": "Large context",
        "version": "2025-08-07",
    },
    {
        "id": "gpt-5",
        "name": "GPT-5",
        "tier": "Advanced reasoning",
        "description": "Higher reasoning quality for complex instructions, multi-step tools, and consequential workflows.",
        "bestFor": "Agent workflows, complex synthesis, and tool orchestration",
        "latency": "Medium",
        "cost": "$$$",
        "context": "Large context",
        "version": "2025-08-07",
    },
    {
        "id": "o3",
        "name": "o3",
        "tier": "Deep analysis",
        "description": "Deliberative reasoning for difficult analytical tasks where depth matters more than response speed.",
        "bestFor": "Complex analysis, validation, and difficult decision support",
        "latency": "Higher",
        "cost": "$$$",
        "context": "Large context",
        "version": "2025-04-16",
    },
]

EMBEDDING_MODEL_CATALOG: list[dict[str, str]] = [
    {
        "id": "text-embedding-3-small",
        "name": "Text Embedding 3 Small",
        "description": "Cost-efficient embeddings for general enterprise search and grounded Q&A.",
        "dimensions": "Up to 1,536",
        "cost": "$",
        "version": "1",
    },
    {
        "id": "text-embedding-3-large",
        "name": "Text Embedding 3 Large",
        "description": "Higher-quality multilingual and difficult semantic retrieval.",
        "dimensions": "Up to 3,072",
        "cost": "$$",
        "version": "1",
    },
]

REGIONS = {
    "East US": {"code": "eastus", "suffix": "eus"},
    "East US 2": {"code": "eastus2", "suffix": "eus2"},
    "Central US": {"code": "centralus", "suffix": "cus"},
    "West US 3": {"code": "westus3", "suffix": "wus3"},
    "West Europe": {"code": "westeurope", "suffix": "weu"},
    "North Europe": {"code": "northeurope", "suffix": "neu"},
    "Sweden Central": {"code": "swedencentral", "suffix": "swc"},
    "Switzerland North": {"code": "switzerlandnorth", "suffix": "chn"},
}


def recommend_model(request: ModelRecommendationRequest) -> dict[str, object]:
    score = 1
    reasons: list[str] = []
    if "grounding" in request.capabilities:
        score += 1
        reasons.append("Grounded answers and source-aware summarization")
    if "agents" in request.capabilities:
        score += 2
        reasons.append("Multi-agent coordination")
    if "actions" in request.capabilities:
        score += 2
        reasons.append("Tool calls and business actions")
    if len(request.data_types) >= 3:
        score += 1
        reasons.append("Multiple information types")
    if any(use in {"metrics", "trends"} for use in request.data_uses):
        score += 2
        reasons.append("Analytical reasoning")
    if len(request.connectors) >= 2:
        score += 1
        reasons.append("Multiple governed integrations")
    if "Workflow checkpoints" in request.memory:
        score += 1
        reasons.append("Resumable workflows")
    if request.regulated:
        score += 1
        reasons.append("Regulated workload controls")
    if request.scale == "large":
        score += 1
        reasons.append("Large usage profile")

    analytical = any(use in {"metrics", "trends"} for use in request.data_uses) and score >= 7
    model_id = "o3" if analytical else "gpt-5" if score >= 6 else "gpt-5-mini"
    model = next(model for model in MODEL_CATALOG if model["id"] == model_id)
    return {
        "model": model,
        "score": score,
        "level": "Advanced" if score >= 7 else "Balanced" if score >= 4 else "Focused",
        "reasons": reasons or ["Focused content-generation workload"],
        "capacity": "80K TPM" if request.scale == "large" else "30K TPM" if request.scale == "medium" else "10K TPM",
    }


def get_catalog() -> dict[str, object]:
    return {
        "models": MODEL_CATALOG,
        "embeddingModels": EMBEDDING_MODEL_CATALOG,
        "regions": [
            {"label": label, "code": details["code"], "suffix": details["suffix"]}
            for label, details in REGIONS.items()
        ],
    }
