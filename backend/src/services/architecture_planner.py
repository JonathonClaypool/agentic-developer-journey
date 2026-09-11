from models.schemas import ArchitecturePlanRequest, OperationalRequirements, ResourceKey


def _profile(requirements: OperationalRequirements) -> tuple[str, str, bool]:
    if requirements.business_impact == "critical" or requirements.rto_minutes <= 60:
        return "business-critical-warm-standby", "Business-critical warm standby", False
    if (
        requirements.environments == "dev-test-prod"
        or requirements.service_hours == "24x7"
        or requirements.business_impact == "material"
        or requirements.rto_minutes <= 240
    ):
        return "standard-production", "Standard production", True
    return "development", "Development", True


def _infrastructure_changes(
    request: ArchitecturePlanRequest,
    profile: str,
    storage_sku: str,
    search_sku: str,
    search_replicas: int,
    log_retention: int,
) -> dict[str, object]:
    production = profile != "development"
    labels = {
        "foundry": "Microsoft Foundry",
        "chat-model": "Foundry chat model deployment",
        "embedding-model": "Foundry embedding model deployment",
        "managed-identity": "Managed Identity",
        "storage": "Azure Storage",
        "ai-search": "Azure AI Search",
        "observability": "Application Insights and Log Analytics",
        "private-network": "Virtual Network and private access",
    }
    changes: list[dict[str, str]] = []
    for resource in request.resources:
        change = {
            "resource": resource,
            "label": labels[resource],
            "status": "unchanged",
            "current": "Existing selected configuration",
            "target": "Retain existing configuration",
            "reason": "No profile-specific infrastructure change is required.",
        }
        if resource == "storage":
            change.update({
                "status": "upgraded" if production else "unchanged",
                "current": "Standard_LRS · versioning off · 7-day soft delete",
                "target": f"{storage_sku} · versioning {'on' if production else 'off'} · {30 if production else 7}-day soft delete",
                "reason": "Increase data durability and recovery protection." if production else "Development durability is sufficient for the selected service level.",
            })
        elif resource == "ai-search":
            change.update({
                "status": "scaled" if production else "unchanged",
                "current": "Basic · 1 replica",
                "target": f"{search_sku.title()} · {search_replicas} {'replicas' if search_replicas != 1 else 'replica'}",
                "reason": "Increase production query availability." if production else "Development search capacity is sufficient.",
            })
        elif resource == "observability":
            change.update({
                "status": "reconfigured" if production else "unchanged",
                "current": "30-day retention · baseline telemetry",
                "target": f"{log_retention}-day retention · diagnostic settings {'enabled' if production else 'baseline'}",
                "reason": "Enable production diagnostics and operational evidence." if production else "Baseline development telemetry is retained.",
            })
        changes.append(change)

    additions: list[dict[str, str]] = []
    if profile == "business-critical-warm-standby":
        additions.extend([
            {
                "resource": "secondary-regional-stamp",
                "label": "Secondary regional stamp",
                "reason": "Provide reduced-capacity recovery infrastructure in the standby region.",
                "implementationStatus": "blocked",
            },
            {
                "resource": "global-routing",
                "label": "Global failover routing",
                "reason": "Route traffic to the standby region during a regional failure.",
                "implementationStatus": "blocked",
            },
        ])

    changed_count = sum(change["status"] != "unchanged" for change in changes)
    if additions:
        change_noun = "component" if changed_count == 1 else "components"
        summary = f"{len(additions)} additional infrastructure components are required; {changed_count} existing {change_noun} will change."
    elif changed_count:
        change_noun = "component" if changed_count == 1 else "components"
        summary = f"No additional Azure services are required; {changed_count} existing {change_noun} will be production-hardened."
    else:
        summary = "No additional Azure services or profile-specific changes are required."
    return {"summary": summary, "additionalInfrastructure": additions, "existingInfrastructure": changes}


def create_architecture_plan(request: ArchitecturePlanRequest) -> dict[str, object]:
    requirements = request.operational_requirements
    profile, label, deployable = _profile(requirements)
    controls: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    blockers: list[str] = []
    resources: list[dict[str, object]] = []

    production = profile != "development"
    warm_standby = profile == "business-critical-warm-standby"
    storage_sku = "Standard_GZRS" if production else "Standard_LRS"
    search_sku = "standard" if production else "basic"
    search_replicas = 2 if production else 1
    log_retention = max(requirements.retention_days, 90 if production else 30)

    if "storage" in request.resources:
        resources.append({
            "type": "storage",
            "configuration": {
                "sku": storage_sku,
                "versioning": production,
                "softDeleteDays": 30 if production else 7,
                "immutableRetention": requirements.immutable_audit,
                "customerManagedKeys": requirements.customer_managed_keys,
            },
            "reason": "Data durability and recovery objectives",
        })
    if "ai-search" in request.resources:
        resources.append({
            "type": "ai-search",
            "configuration": {"sku": search_sku, "replicas": search_replicas},
            "reason": "Production query availability" if production else "Development capacity",
        })
    resources.append({
        "type": "observability",
        "configuration": {"retentionDays": log_retention, "diagnosticSettings": production},
        "reason": "Operational evidence and recovery detection",
    })

    if requirements.regulated_records:
        controls.extend([
            {"id": "audit-retention", "label": f"Retain audit evidence for {requirements.retention_days} days"},
            {"id": "change-control", "label": "Require controlled deployment and change evidence"},
            {"id": "private-access", "label": "Use managed identities and private service access"},
        ])
    if requirements.immutable_audit:
        controls.append({"id": "immutable-audit", "label": "Store audit evidence with immutable retention"})
    if requirements.customer_managed_keys:
        controls.append({"id": "cmk", "label": "Use managed identities and customer-managed encryption keys"})
        warnings.append({
            "severity": "approval-required",
            "message": "CMK support and key-rotation behavior must be validated for every selected service.",
        })

    if warm_standby:
        if not requirements.secondary_region:
            blockers.append("Select and validate a secondary Azure region.")
        if request.primary_region and requirements.secondary_region == request.primary_region:
            blockers.append("The recovery region must differ from the primary region.")
        blockers.append("Warm-standby regional stamps and global failover routing are not yet implemented by the deployment template.")
        resources.extend([
            {"type": "secondary-regional-stamp", "configuration": {"region": requirements.secondary_region, "capacity": "reduced"}, "reason": f"RTO target of {requirements.rto_minutes} minutes"},
            {"type": "global-routing", "configuration": {"mode": "priority", "failover": requirements.failover_mode}, "reason": "Regional failover"},
        ])

    infrastructure_changes = _infrastructure_changes(
        request, profile, storage_sku, search_sku, search_replicas, log_retention
    )

    return {
        "profile": profile,
        "label": label,
        "deployable": deployable and not blockers,
        "targets": {"rtoMinutes": requirements.rto_minutes, "rpoMinutes": requirements.rpo_minutes},
        "derivedParameters": {
            "storageSku": storage_sku,
            "searchSku": search_sku,
            "searchReplicaCount": search_replicas,
            "logRetentionDays": log_retention,
        },
        "infrastructureChanges": infrastructure_changes,
        "resources": resources,
        "controls": controls,
        "warnings": warnings,
        "blockers": blockers,
    }
