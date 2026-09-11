from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from typing_extensions import Annotated

ResourceKey = Literal[
    "foundry",
    "chat-model",
    "embedding-model",
    "managed-identity",
    "storage",
    "ai-search",
    "observability",
    "private-network",
]
Answer = Literal["yes", "no", ""]

SafeName = Annotated[str, StringConstraints(pattern=r"^[a-zA-Z0-9._-]+$")]
ResourceGroupName = Annotated[
    str, StringConstraints(min_length=1, max_length=90, pattern=r"^[a-zA-Z0-9._()-]+$")
]
WorkloadName = Annotated[
    str, StringConstraints(min_length=2, max_length=32, pattern=r"^[a-z0-9-]+$")
]
AgentName = Annotated[
    str, StringConstraints(min_length=2, max_length=63, pattern=r"^[a-z0-9-]+$")
]


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class ModelDeployment(ApiModel):
    name: SafeName
    version: SafeName
    sku: Literal["GlobalStandard", "Standard"]
    capacity: int = Field(ge=1, le=1000)


class OperationalRequirements(ApiModel):
    environments: Literal["dev", "dev-test", "dev-test-prod"] = "dev"
    scale: Literal["small", "medium", "large"] = "small"
    service_hours: Literal["business-hours", "extended-hours", "24x7"] = Field(
        default="business-hours", alias="serviceHours"
    )
    business_impact: Literal["low", "material", "critical"] = Field(
        default="low", alias="businessImpact"
    )
    rto_minutes: Literal[15, 60, 240, 1440] = Field(default=1440, alias="rtoMinutes")
    rpo_minutes: Literal[0, 15, 60, 1440] = Field(default=1440, alias="rpoMinutes")
    failover_mode: Literal["manual", "operator-approved", "automatic"] = Field(
        default="manual", alias="failoverMode"
    )
    secondary_region: SafeName | None = Field(default=None, alias="secondaryRegion")
    regulated_records: bool = Field(default=False, alias="regulatedRecords")
    retention_days: int = Field(default=30, ge=30, le=3650, alias="retentionDays")
    immutable_audit: bool = Field(default=False, alias="immutableAudit")
    data_residency: list[SafeName] = Field(default_factory=list, alias="dataResidency")
    customer_managed_keys: bool = Field(default=False, alias="customerManagedKeys")


class DeploymentManifest(ApiModel):
    subscription_id: UUID = Field(alias="subscriptionId")
    location: Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+$")]
    resource_group_name: ResourceGroupName = Field(alias="resourceGroupName")
    workload_name: WorkloadName = Field(alias="workloadName")
    resources: list[ResourceKey] = Field(min_length=1)
    chat_model: ModelDeployment = Field(alias="chatModel")
    embedding_model: ModelDeployment | None = Field(default=None, alias="embeddingModel")
    operational_requirements: OperationalRequirements = Field(
        default_factory=OperationalRequirements, alias="operationalRequirements"
    )
    tags: dict[str, Annotated[str, StringConstraints(max_length=256)]] = Field(
        default_factory=dict
    )


class ArchitecturePackageRequest(ApiModel):
    application_id: SafeName = Field(alias="applicationId")
    location: Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+$")]
    resource_group_name: ResourceGroupName = Field(alias="resourceGroupName")
    workload_name: WorkloadName = Field(alias="workloadName")
    resources: list[ResourceKey] = Field(min_length=1)
    chat_model: ModelDeployment = Field(alias="chatModel")
    embedding_model: ModelDeployment | None = Field(default=None, alias="embeddingModel")
    operational_requirements: OperationalRequirements = Field(
        default_factory=OperationalRequirements, alias="operationalRequirements"
    )
    tags: dict[str, Annotated[str, StringConstraints(max_length=256)]] = Field(
        default_factory=dict
    )


class ArchitecturePlanRequest(ApiModel):
    resources: list[ResourceKey] = Field(default_factory=list)
    primary_region: SafeName | None = Field(default=None, alias="primaryRegion")
    operational_requirements: OperationalRequirements = Field(alias="operationalRequirements")


class RegionAssessmentRequest(ApiModel):
    subscription_id: UUID = Field(alias="subscriptionId")
    preferred_region: SafeName | None = Field(default=None, alias="preferredRegion")
    candidate_regions: list[SafeName] = Field(alias="candidateRegions", min_length=1, max_length=8)
    resources: list[ResourceKey] = Field(min_length=1)
    chat_model: ModelDeployment = Field(alias="chatModel")
    embedding_model: ModelDeployment | None = Field(default=None, alias="embeddingModel")


class PackageTarget(ApiModel):
    subscription_id: UUID = Field(alias="subscriptionId")


class ConfirmedPackageDeployment(PackageTarget):
    confirmation_token: UUID = Field(alias="confirmationToken")


class GovernedMcpConnection(ApiModel):
    name: SafeName
    version: SafeName | None = None
    apim_path: Annotated[
        str, StringConstraints(min_length=2, max_length=256, pattern=r"^/[a-zA-Z0-9._~/-]+$")
    ] = Field(alias="apimPath")


class AgentStarterKitRequest(ApiModel):
    agent_name: AgentName = Field(alias="agentName")
    deployment_mode: Literal["source", "jfrog"] = Field(alias="deploymentMode")
    mcp_connection: GovernedMcpConnection | None = Field(
        default=None, alias="mcpConnection"
    )
    include_search: bool = Field(default=False, alias="includeSearch")


class RiskAssessmentRequest(ApiModel):
    personal: Answer = ""
    health: Answer = ""
    employee: Answer = ""
    confidential: Answer = ""
    regulated: Answer = ""
    identifiable: Answer = ""
    model_training: Answer = Field(default="", alias="modelTraining")
    external_data: Answer = Field(default="", alias="externalData")
    cross_border: Answer = Field(default="", alias="crossBorder")
    capabilities: list[str] = Field(default_factory=list)
    autonomy: int = Field(default=1, ge=1, le=5)
    public_facing: Answer = Field(default="", alias="publicFacing")
    safety: Answer = ""
    quality: Answer = ""
    decisions: Answer = ""
    human_review: Answer = Field(default="", alias="humanReview")
    audit: Answer = ""


class ModelRecommendationRequest(ApiModel):
    capabilities: list[str] = Field(default_factory=list)
    data_types: list[str] = Field(default_factory=list, alias="dataTypes")
    data_uses: list[str] = Field(default_factory=list, alias="dataUses")
    connectors: list[str] = Field(default_factory=list)
    memory: list[str] = Field(default_factory=list)
    regulated: bool = False
    scale: Literal["small", "medium", "large"] = "small"


class CleanupRequest(ApiModel):
    subscription_id: UUID = Field(alias="subscriptionId")
    resource_group_name: ResourceGroupName = Field(alias="resourceGroupName")
    confirm: Literal[True]
