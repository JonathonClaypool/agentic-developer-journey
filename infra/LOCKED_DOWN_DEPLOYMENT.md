# Deploying AI Launchpad from a locked-down Azure environment

These instructions are for an operator running from a VPN-connected workstation
that can reach private Azure endpoints. The portal deployment uses existing AKS,
Azure Container Registry (ACR), Storage, Foundry, Cosmos DB, and Azure AI Search
resources. It does not create the AKS cluster, ACR, virtual network, private
endpoints, or private DNS zones.

## Required access

The signed-in Azure identity needs permission to:

- create a subscription-scope deployment and the portal resource group;
- create a user-assigned managed identity and federated identity credential;
- create the artifact Blob container and its role assignment;
- grant `AcrPull` to the AKS kubelet identity;
- queue and read ACR Tasks builds;
- retrieve AKS credentials and apply Kubernetes resources.

`Owner` at the affected scopes satisfies these requirements for a prototype.
For least privilege, separate resource deployment, role-assignment, ACR build,
and AKS administration permissions according to the organization's standards.

Install PowerShell 7+, Azure CLI, `kubectl`, and Git. Docker is not required
because `infra/deploy.ps1` builds the images with ACR Tasks.

## Hosting and network prerequisites

Before deployment, confirm:

1. The workstation is connected to the VPN and can authenticate to Azure.
2. The existing AKS cluster has the OIDC issuer and Workload Identity enabled.
3. AKS can pull from the existing ACR. If the registry blocks public traffic,
   its private endpoint and `privatelink.azurecr.io` DNS zone must be reachable
   from the AKS virtual network.
4. AKS can resolve and reach the Storage Blob private endpoint. For a Storage
   account with public network access disabled:
   - create a Blob private endpoint in a subnet reachable by AKS;
   - create or reuse `privatelink.blob.core.windows.net`;
   - link that private DNS zone to the AKS virtual network;
   - ensure network security groups and firewalls allow HTTPS traffic.
5. ACR Tasks can obtain the source context uploaded by the deployment script
   and push images to the registry.
6. The configured Foundry, Storage, Cosmos DB, Azure AI Search, and managed
   identity resources already exist.

Check the AKS identity settings:

```powershell
az aks show `
  --resource-group <aks-resource-group> `
  --name <aks-name> `
  --query "{oidc:oidcIssuerProfile.enabled,workloadIdentity:securityProfile.workloadIdentity.enabled}" `
  --output table
```

If permitted, enable missing identity features:

```powershell
az aks update `
  --resource-group <aks-resource-group> `
  --name <aks-name> `
  --enable-oidc-issuer `
  --enable-workload-identity
```

From a VPN-connected host or a diagnostic pod on AKS, verify that the Storage
hostname resolves to a private address:

```powershell
Resolve-DnsName <storage-account>.blob.core.windows.net
```

Do not temporarily enable Storage public access for the deployed portal. The
backend is designed to use Workload Identity through the private endpoint.

## Configure the platform profile

Copy the safe template and edit the new ignored file:

```powershell
Copy-Item backend\.env.example backend\.env
```

Set every `PLATFORM_*` value and `AZURE_SUBSCRIPTION_ID` to existing resources
in the target environment. Keep:

```dotenv
ENABLE_AZURE_DEPLOYMENTS=false
PACKAGE_ARTIFACT_BACKEND=blob
```

`PACKAGE_ARTIFACT_CONTAINER_URL` is replaced by the AKS deployment and may
remain a placeholder locally. Never commit or transfer `backend/.env`.

Sign in and select the target subscription:

```powershell
az login
az account set --subscription <subscription-id>
az account show --query "{name:name,id:id,tenantId:tenantId}" --output table
```

## Deploy

Run from the repository root:

```powershell
.\infra\deploy.ps1 `
  -AksResourceGroupName <aks-resource-group> `
  -AksClusterName <aks-name> `
  -AcrResourceGroupName <acr-resource-group> `
  -AcrName <acr-name> `
  -PortalResourceGroupName <portal-resource-group> `
  -ImageTag <immutable-image-tag>
```

The script:

- deploys `infra/main.bicep` at subscription scope;
- creates the backend identity, federated credential, artifact container, and
  required Blob and ACR role assignments;
- builds the backend and frontend images in ACR from tracked Git files only;
- renders and applies the Kubernetes resources;
- waits for the backend and frontend rollouts.

Use `-StorageResourceGroupName`, `-StorageAccountName`, or
`-ArtifactContainerName` when the artifact account differs from the platform
profile. Do not pass `-EnableAzureDeployments` for the prototype. That switch
requires additional control-plane permissions for generated-package what-if
and deployment operations.

## Verify

Confirm both workloads use the requested immutable tag and are Ready:

```powershell
kubectl get pods -n ai-launchpad `
  -o custom-columns='NAME:.metadata.name,READY:.status.containerStatuses[0].ready,IMAGE:.spec.containers[0].image,RESTARTS:.status.containerStatuses[0].restartCount'
kubectl rollout status deployment/launchpad-backend -n ai-launchpad --timeout=5m
kubectl rollout status deployment/launchpad-frontend -n ai-launchpad --timeout=5m
```

Get the frontend address and test health:

```powershell
$address = kubectl get service launchpad-frontend -n ai-launchpad `
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
Invoke-RestMethod "http://$address/api/health/live"
Invoke-RestMethod "http://$address/api/health/ready"
```

Readiness must return `artifactStore: available`. If it does not, check private
DNS resolution, routes, network policy, the federated credential subject
`system:serviceaccount:ai-launchpad:launchpad-backend`, and the container-scoped
`Storage Blob Data Contributor` assignment.

Complete the approved Quality Event Summarizer flow in the browser and record
the package ID. Verify API read-back:

```powershell
$packageId = '<generated-package-id>'
$package = Invoke-RestMethod "http://$address/api/packages/$packageId"
$package | Select-Object packageId, sha256
$package.files.path
```

Verify the blobs without opening Storage public access:

```powershell
$pod = (kubectl get pods -n ai-launchpad -o name |
  Select-String 'launchpad-backend' |
  Select-Object -First 1).ToString().Replace('pod/','')

kubectl exec -n ai-launchpad $pod -- python -c @"
from azure.identity import DefaultAzureCredential
from azure.storage.blob import ContainerClient

client = ContainerClient(
    account_url='https://<storage-account>.blob.core.windows.net',
    container_name='launchpad-deployment-artifacts',
    credential=DefaultAzureCredential(),
)
for blob in client.list_blobs(name_starts_with='packages/$packageId/'):
    print(blob.name)
"@
```

A generated package currently produces nine blobs: seven source files plus
`main.json` and `package-metadata.json`.

## Prototype limitations

- The frontend is an unauthenticated public HTTP `LoadBalancer`. A locked-down
  production design should use a private ingress or approved application
  gateway, TLS, DNS, and authentication.
- Each service runs one replica to fit a one-node prototype cluster. Backend
  what-if approval state is process-local, so do not scale the backend until
  that state is moved to shared storage or replaced by signed tokens.
- Rolling updates use zero surge and allow one unavailable replica; deployments
  briefly interrupt service.
- Generated Azure resource deployment is disabled by default.
- The deployment references existing platform parents and creates only
  workload-scoped package artifacts and portal-owned identity/access resources.
