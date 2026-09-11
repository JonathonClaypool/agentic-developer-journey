from dataclasses import asdict, dataclass

from models.schemas import DeploymentManifest, ResourceKey


@dataclass(frozen=True)
class CatalogEntry:
    label: str
    module: str
    dependencies: tuple[ResourceKey, ...] = ()


RESOURCE_CATALOG: dict[ResourceKey, CatalogEntry] = {
    "foundry": CatalogEntry(
        "New Microsoft Foundry account and project", "core-ai.bicep", ("managed-identity",)
    ),
    "chat-model": CatalogEntry(
        "Foundry chat model deployment", "core-ai.bicep", ("foundry",)
    ),
    "embedding-model": CatalogEntry(
        "Foundry embedding model deployment", "core-ai.bicep", ("foundry",)
    ),
    "managed-identity": CatalogEntry(
        "User-assigned managed identity", "identity.bicep"
    ),
    "storage": CatalogEntry(
        "Storage account", "data.bicep", ("managed-identity",)
    ),
    "ai-search": CatalogEntry(
        "Azure AI Search", "data.bicep", ("managed-identity",)
    ),
    "observability": CatalogEntry(
        "Application Insights and Log Analytics", "observability.bicep"
    ),
    "private-network": CatalogEntry(
        "Virtual network and private connectivity", "networking.bicep"
    ),
}


def resolve_resources(requested: list[ResourceKey]) -> list[ResourceKey]:
    resolved: list[ResourceKey] = []

    def visit(key: ResourceKey) -> None:
        if key in resolved:
            return
        for dependency in RESOURCE_CATALOG[key].dependencies:
            visit(dependency)
        resolved.append(key)

    for key in requested:
        visit(key)
    return resolved


def describe_resources(keys: list[ResourceKey]) -> list[dict[str, object]]:
    return [{"key": key, **asdict(RESOURCE_CATALOG[key])} for key in keys]


def to_bicep_parameters(manifest: DeploymentManifest) -> dict[str, object]:
    resources = resolve_resources(manifest.resources)
    has = resources.__contains__
    embedding = manifest.embedding_model
    requirements = manifest.operational_requirements
    production = (
        requirements.environments == "dev-test-prod"
        or requirements.service_hours == "24x7"
        or requirements.business_impact == "material"
        or requirements.rto_minutes <= 240
    )
    return {
        "workloadName": manifest.workload_name,
        "location": manifest.location,
        "deployFoundry": has("foundry"),
        "deployChatModel": has("chat-model"),
        "deployEmbeddingModel": has("embedding-model"),
        "deployIdentity": has("managed-identity"),
        "deployStorage": has("storage"),
        "deploySearch": has("ai-search"),
        "deployObservability": has("observability"),
        "deployPrivateNetwork": has("private-network"),
        "storageSku": "Standard_GZRS" if production else "Standard_LRS",
        "searchSku": "standard" if production else "basic",
        "searchReplicaCount": 2 if production else 1,
        "logRetentionDays": max(requirements.retention_days, 90 if production else 30),
        "chatModelName": manifest.chat_model.name,
        "chatModelVersion": manifest.chat_model.version,
        "chatModelSku": manifest.chat_model.sku,
        "chatModelCapacity": manifest.chat_model.capacity,
        "embeddingModelName": embedding.name if embedding else "text-embedding-3-small",
        "embeddingModelVersion": embedding.version if embedding else "1",
        "embeddingModelSku": embedding.sku if embedding else "GlobalStandard",
        "embeddingModelCapacity": embedding.capacity if embedding else 10,
        "tags": manifest.tags,
    }
