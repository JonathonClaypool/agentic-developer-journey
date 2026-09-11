targetScope = 'subscription'

@description('Resource group created for this generated application environment.')
param resourceGroupName string
param location string
param workloadName string
@description('Immutable package-specific suffix used to avoid collisions with soft-deleted globally named resources.')
param deploymentStamp string
@description('Create a new Microsoft Foundry account and child project in the new application resource group.')
param deployFoundry bool = true
param deployChatModel bool = true
param deployEmbeddingModel bool = false
param deployIdentity bool = true
param deployStorage bool = false
param deploySearch bool = false
param deployObservability bool = false
param deployPrivateNetwork bool = false
@allowed([
  'Standard_LRS'
  'Standard_GZRS'
])
param storageSku string = 'Standard_LRS'
@allowed([
  'basic'
  'standard'
])
param searchSku string = 'basic'
@minValue(1)
@maxValue(3)
param searchReplicaCount int = 1
@minValue(30)
@maxValue(3650)
param logRetentionDays int = 30
param chatModelName string
param chatModelVersion string
param chatModelSku string = 'GlobalStandard'
param chatModelCapacity int = 10
param embeddingModelName string = 'text-embedding-3-small'
param embeddingModelVersion string = '1'
param embeddingModelSku string = 'GlobalStandard'
param embeddingModelCapacity int = 10
param tags object = {}

resource applicationResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: union(tags, {
    workload: workloadName
    environment: 'poc'
    managedBy: 'ai-launchpad'
  })
}

module resources './resources.bicep' = {
  name: 'deploy-${workloadName}-resources'
  scope: applicationResourceGroup
  params: {
    location: location
    workloadName: workloadName
    deploymentStamp: deploymentStamp
    deployFoundry: deployFoundry
    deployChatModel: deployChatModel
    deployEmbeddingModel: deployEmbeddingModel
    deployIdentity: deployIdentity
    deployStorage: deployStorage
    deploySearch: deploySearch
    deployObservability: deployObservability
    deployPrivateNetwork: deployPrivateNetwork
    storageSku: storageSku
    searchSku: searchSku
    searchReplicaCount: searchReplicaCount
    logRetentionDays: logRetentionDays
    chatModelName: chatModelName
    chatModelVersion: chatModelVersion
    chatModelSku: chatModelSku
    chatModelCapacity: chatModelCapacity
    embeddingModelName: embeddingModelName
    embeddingModelVersion: embeddingModelVersion
    embeddingModelSku: embeddingModelSku
    embeddingModelCapacity: embeddingModelCapacity
    tags: tags
  }
}

output resourceGroupName string = applicationResourceGroup.name
output deployment object = resources.outputs.deployment
