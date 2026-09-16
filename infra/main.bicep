targetScope = 'subscription'

@description('Azure region for the portal resource group and managed identity.')
param location string

@description('Resource group that owns portal-specific resources.')
param portalResourceGroupName string

@description('Resource group containing the existing AKS cluster.')
param aksResourceGroupName string

@description('Name of the existing AKS cluster. OIDC issuer and workload identity must be enabled.')
param aksClusterName string

@description('Resource group containing the existing Azure Container Registry.')
param acrResourceGroupName string

@description('Name of the existing Azure Container Registry.')
param acrName string

@description('Resource group containing the existing artifact Storage account.')
param storageResourceGroupName string

@description('Name of the existing artifact Storage account.')
param storageAccountName string

@description('Dedicated private Blob container for deployment request and package artifacts.')
param artifactContainerName string = 'launchpad-deployment-artifacts'

@description('Kubernetes namespace for the portal workloads.')
param kubernetesNamespace string = 'ai-launchpad'

@description('Kubernetes service account used by the backend workload.')
param backendServiceAccountName string = 'launchpad-backend'

@description('Name of the backend user-assigned managed identity.')
param backendIdentityName string = 'id-ai-launchpad-backend'

resource portalResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: portalResourceGroupName
  location: location
  tags: {
    application: 'ai-launchpad'
    component: 'portal'
  }
}

resource aks 'Microsoft.ContainerService/managedClusters@2024-10-01' existing = {
  scope: resourceGroup(aksResourceGroupName)
  name: aksClusterName
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  scope: resourceGroup(acrResourceGroupName)
  name: acrName
}

module backendIdentity './modules/workload-identity.bicep' = {
  name: 'launchpad-workload-identity'
  scope: resourceGroup(portalResourceGroup.name)
  params: {
    identityName: backendIdentityName
    aksOidcIssuerUrl: aks.properties.oidcIssuerProfile.issuerURL
    kubernetesNamespace: kubernetesNamespace
    serviceAccountName: backendServiceAccountName
  }
}

module artifactStore './modules/artifact-store.bicep' = {
  name: 'launchpad-artifact-store'
  scope: resourceGroup(storageResourceGroupName)
  params: {
    storageAccountName: storageAccountName
    containerName: artifactContainerName
    backendPrincipalId: backendIdentity.outputs.principalId
  }
}

module registryAccess './modules/acr-pull.bicep' = {
  name: 'launchpad-acr-pull'
  scope: resourceGroup(acrResourceGroupName)
  params: {
    registryName: acrName
    kubeletPrincipalId: aks.properties.identityProfile.kubeletidentity.objectId
  }
}

output aksClusterName string = aks.name
output aksResourceGroupName string = aksResourceGroupName
output acrLoginServer string = acr.properties.loginServer
output artifactContainerName string = artifactStore.outputs.containerName
output artifactContainerUrl string = artifactStore.outputs.containerUrl
output backendIdentityClientId string = backendIdentity.outputs.clientId
output backendIdentityPrincipalId string = backendIdentity.outputs.principalId
output backendIdentityResourceId string = backendIdentity.outputs.resourceId
output backendServiceAccountName string = backendServiceAccountName
output kubernetesNamespace string = kubernetesNamespace
