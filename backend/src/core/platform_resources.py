import os
from functools import lru_cache
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PlatformResourceProfile(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    subscription_id: UUID = Field(alias="subscriptionId")
    location: str
    foundry_resource_group: str = Field(alias="foundryResourceGroup")
    foundry_account_name: str = Field(alias="foundryAccountName")
    storage_resource_group: str = Field(alias="storageResourceGroup")
    storage_account_name: str = Field(alias="storageAccountName")
    cosmos_resource_group: str = Field(alias="cosmosResourceGroup")
    cosmos_account_name: str = Field(alias="cosmosAccountName")
    cosmos_database_name: str = Field(alias="cosmosDatabaseName")
    search_resource_group: str = Field(alias="searchResourceGroup")
    search_service_name: str = Field(alias="searchServiceName")
    search_index_name: str = Field(alias="searchIndexName")
    managed_identity_resource_id: str = Field(alias="managedIdentityResourceId")


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Required platform resource setting {name} is not configured.")
    return value


@lru_cache
def get_platform_resource_profile() -> PlatformResourceProfile:
    return PlatformResourceProfile(
        subscriptionId=_required("AZURE_SUBSCRIPTION_ID"),
        location=_required("PLATFORM_LOCATION"),
        foundryResourceGroup=_required("PLATFORM_FOUNDRY_RESOURCE_GROUP"),
        foundryAccountName=_required("PLATFORM_FOUNDRY_ACCOUNT_NAME"),
        storageResourceGroup=_required("PLATFORM_STORAGE_RESOURCE_GROUP"),
        storageAccountName=_required("PLATFORM_STORAGE_ACCOUNT_NAME"),
        cosmosResourceGroup=_required("PLATFORM_COSMOS_RESOURCE_GROUP"),
        cosmosAccountName=_required("PLATFORM_COSMOS_ACCOUNT_NAME"),
        cosmosDatabaseName=_required("PLATFORM_COSMOS_DATABASE_NAME"),
        searchResourceGroup=_required("PLATFORM_SEARCH_RESOURCE_GROUP"),
        searchServiceName=_required("PLATFORM_SEARCH_SERVICE_NAME"),
        searchIndexName=_required("PLATFORM_SEARCH_INDEX_NAME"),
        managedIdentityResourceId=_required("PLATFORM_MANAGED_IDENTITY_RESOURCE_ID"),
    )
