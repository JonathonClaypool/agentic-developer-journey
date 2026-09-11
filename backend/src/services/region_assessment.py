from concurrent.futures import ThreadPoolExecutor
from typing import Any

from connectors.azure_cli import AzureCommandError, _run_azure
from models.schemas import ModelDeployment, RegionAssessmentRequest

REGION_LABELS = {
    "eastus": "East US",
    "eastus2": "East US 2",
    "centralus": "Central US",
    "westus3": "West US 3",
    "westeurope": "West Europe",
    "northeurope": "North Europe",
    "swedencentral": "Sweden Central",
    "switzerlandnorth": "Switzerland North",
}

RESOURCE_REQUIREMENTS = {
    "foundry": [("Microsoft.CognitiveServices", "accounts", "Microsoft Foundry")],
    "managed-identity": [("Microsoft.ManagedIdentity", "userAssignedIdentities", "Managed Identity")],
    "storage": [("Microsoft.Storage", "storageAccounts", "Azure Storage")],
    "ai-search": [("Microsoft.Search", "searchServices", "Azure AI Search")],
    "observability": [
        ("Microsoft.OperationalInsights", "workspaces", "Log Analytics"),
        ("Microsoft.Insights", "components", "Application Insights"),
    ],
    "private-network": [("Microsoft.Network", "virtualNetworks", "Virtual Network")],
}

# POC-specific evidence from attempted Basic Azure AI Search allocations.
# These failures are stronger signals than provider-advertised regional support.
POC_SEARCH_FAILED_REGIONS = {"eastus2", "westus3"}


def _normalize_location(value: str) -> str:
    return "".join(character for character in value.lower() if character.isalnum())


def _required_resource_types(request: RegionAssessmentRequest) -> list[tuple[str, str, str]]:
    requirements: list[tuple[str, str, str]] = []
    for resource in request.resources:
        requirements.extend(RESOURCE_REQUIREMENTS.get(resource, []))
    return list(dict.fromkeys(requirements))


def _provider_locations(subscription_id: str, namespace: str, resource_type: str) -> set[str]:
    provider = _run_azure(
        [
            "provider",
            "show",
            "--subscription",
            subscription_id,
            "--namespace",
            namespace,
            "--output",
            "json",
        ]
    )
    for definition in provider.get("resourceTypes", []):
        if definition.get("resourceType", "").lower() == resource_type.lower():
            return {_normalize_location(location) for location in definition.get("locations", [])}
    return set()


def _model_check(model: ModelDeployment, models: list[dict[str, Any]], usages: list[dict[str, Any]]) -> dict[str, object]:
    matches = [
        entry
        for entry in models
        if entry.get("model", {}).get("name") == model.name
        and entry.get("model", {}).get("version") == model.version
    ]
    sku_supported = any(
        model.sku in [sku.get("name") for sku in entry.get("model", {}).get("skus", [])]
        for entry in matches
    )
    usage_name = f"OpenAI.{model.sku}.{model.name}".lower()
    usage = next(
        (entry for entry in usages if entry.get("name", {}).get("value", "").lower() == usage_name),
        None,
    )
    available = None
    if usage:
        available = float(usage.get("limit", 0)) - float(usage.get("currentValue", 0))
    quota_ready = available is None or available >= model.capacity
    return {
        "name": model.name,
        "version": model.version,
        "sku": model.sku,
        "capacity": model.capacity,
        "available": sku_supported,
        "quotaAvailable": available,
        "quotaReady": quota_ready,
    }


def _regional_models(request: RegionAssessmentRequest, region: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    subscription_id = str(request.subscription_id)
    models = _run_azure(
        [
            "cognitiveservices",
            "model",
            "list",
            "--subscription",
            subscription_id,
            "--location",
            region,
            "--output",
            "json",
        ]
    )
    usages = _run_azure(
        [
            "cognitiveservices",
            "usage",
            "list",
            "--subscription",
            subscription_id,
            "--location",
            region,
            "--output",
            "json",
        ]
    )
    return models, usages


def assess_regions(request: RegionAssessmentRequest) -> dict[str, object]:
    subscription_id = str(request.subscription_id)
    requirements = _required_resource_types(request)
    provider_support: dict[tuple[str, str], set[str]] = {}
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {
            (namespace, resource_type): executor.submit(
                _provider_locations, subscription_id, namespace, resource_type
            )
            for namespace, resource_type, _ in requirements
        }
        regional_futures = {
            region: executor.submit(_regional_models, request, region)
            for region in request.candidate_regions
        }
        for key, future in futures.items():
            provider_support[key] = future.result()

        assessments: list[dict[str, object]] = []
        for region in request.candidate_regions:
            checks: list[dict[str, str]] = []
            normalized_region = _normalize_location(region)
            for namespace, resource_type, label in requirements:
                supported = normalized_region in provider_support[(namespace, resource_type)]
                checks.append(
                    {
                        "name": label,
                        "status": "pass" if supported else "fail",
                        "detail": "Supported" if supported else "Not advertised in this region",
                    }
                )

            model_results: list[dict[str, object]] = []
            try:
                models, usages = regional_futures[region].result()
                selected_models = [request.chat_model]
                if request.embedding_model:
                    selected_models.append(request.embedding_model)
                for model in selected_models:
                    result = _model_check(model, models, usages)
                    model_results.append(result)
                    if not result["available"]:
                        status = "fail"
                        detail = f"Version {model.version} with {model.sku} is unavailable"
                    elif not result["quotaReady"]:
                        status = "fail"
                        detail = f"Needs {model.capacity}K TPM; {result['quotaAvailable']:.0f}K available"
                    elif result["quotaAvailable"] is None:
                        status = "warn"
                        detail = "Available; quota could not be confirmed"
                    else:
                        status = "pass"
                        detail = f"Available; {result['quotaAvailable']:.0f}K TPM quota remaining"
                    checks.append({"name": model.name, "status": status, "detail": detail})
            except AzureCommandError as error:
                checks.append(
                    {
                        "name": "Foundry model availability",
                        "status": "fail",
                        "detail": f"Could not verify: {error}",
                    }
                )

            if "ai-search" in request.resources:
                checks.append(
                    {
                        "name": "Azure AI Search live capacity",
                        "status": "warn",
                        "detail": "Supported, but live allocation is confirmed only during deployment",
                    }
                )
                if region in POC_SEARCH_FAILED_REGIONS:
                    checks.append(
                        {
                            "name": "Recent POC deployment evidence",
                            "status": "fail",
                            "detail": f"A recent Basic Search allocation failed in {REGION_LABELS.get(region, region)}",
                        }
                    )

            failures = sum(check["status"] == "fail" for check in checks)
            warnings = sum(check["status"] == "warn" for check in checks)
            score = 100 - failures * 40 - warnings * 5
            if request.preferred_region and region == request.preferred_region:
                score += 2
            assessments.append(
                {
                    "region": region,
                    "label": REGION_LABELS.get(region, region),
                    "preferred": bool(request.preferred_region and region == request.preferred_region),
                    "status": "blocked" if failures else "conditional" if warnings else "ready",
                    "score": max(score, 0),
                    "checks": checks,
                    "models": model_results,
                }
            )

    compatible = [item for item in assessments if item["status"] != "blocked"]
    recommended = max(compatible, key=lambda item: item["score"], default=None)
    return {
        "recommendedRegion": recommended["region"] if recommended else None,
        "regions": sorted(assessments, key=lambda item: item["score"], reverse=True),
        "disclaimer": "Service support and quota are checked now. Live physical capacity is not reserved and can still change before deployment.",
    }
