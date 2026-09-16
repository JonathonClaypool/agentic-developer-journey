# AI Launchpad application infrastructure

This directory deploys the portal application itself. Workload checkout
templates belong under `catalog/templates/` and are packaged by the backend;
they are intentionally separate from this infrastructure.

## Target architecture

The deployment uses existing shared platform infrastructure:

- an existing AKS cluster with OIDC issuer and Azure Workload Identity enabled;
- an existing Azure Container Registry;
- an existing Storage account;
- the configured Foundry, Storage, Cosmos DB, AI Search, and managed identity
  resources exposed to the portal through backend configuration.

`main.bicep` creates only portal-owned resources:

- a resource group for the portal identity;
- a user-assigned managed identity and AKS federated credential;
- a private Blob container dedicated to deployment requests, generated packages,
  deployment evidence, and starter-kit archives;
- least-privilege `Storage Blob Data Contributor` access on that container;
- `AcrPull` access for the existing AKS kubelet identity.

The Kubernetes manifest runs the React frontend and FastAPI backend as separate
deployments. Nginx serves the compiled frontend and proxies `/api` to the
backend service, keeping browser traffic same-origin. The backend receives the
Blob container URL and platform-resource profile through a ConfigMap and uses
AKS Workload Identity for passwordless Blob access.

## Prerequisites

- Azure CLI, `kubectl`, and permission to deploy at subscription scope.
- An existing AKS cluster with `oidcIssuerProfile.enabled=true` and
  `securityProfile.workloadIdentity.enabled=true`.
- An existing ACR reachable by the AKS cluster.
- An existing Storage account reachable from the AKS cluster. If public network
  access is disabled, the cluster needs private DNS and network connectivity to
  the Blob endpoint.
- `backend/.env` populated with the backend-owned platform profile.

The deployment switch remains disabled unless `-EnableAzureDeployments` is
explicitly supplied.

## Deploy

Run from the repository root:

```powershell
.\infra\deploy.ps1 `
  -AksResourceGroupName <aks-resource-group> `
  -AksClusterName <aks-name> `
  -AcrResourceGroupName <acr-resource-group> `
  -AcrName <acr-name> `
  -PortalResourceGroupName <portal-resource-group>
```

By default the script uses `PLATFORM_STORAGE_RESOURCE_GROUP` and
`PLATFORM_STORAGE_ACCOUNT_NAME` from `backend/.env`, creates container
`launchpad-deployment-artifacts`, builds both images with ACR Tasks, applies the
rendered Kubernetes manifest, waits for both rollouts, and removes the rendered
manifest from local disk.

Use `-StorageResourceGroupName`, `-StorageAccountName`, or
`-ArtifactContainerName` to override the artifact store. Use
`-EnableAzureDeployments` only after the backend identity also has the Azure
control-plane permissions required for package what-if and deployment.
