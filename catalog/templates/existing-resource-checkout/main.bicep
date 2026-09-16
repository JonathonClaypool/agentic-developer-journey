targetScope = 'subscription'

param location string
param workloadName string
param deploymentStamp string
param foundryResourceGroupName string
param foundryAccountName string
param storageResourceGroupName string
param storageAccountName string
param cosmosResourceGroupName string
param cosmosAccountName string
param cosmosDatabaseName string
param searchResourceGroupName string
param searchServiceName string
param searchIndexName string
param managedIdentityResourceId string
param deployFoundryProject bool = true
param deployChatModel bool = true
param deployEmbeddingModel bool = false
param deployStorageContainer bool = false
param deployCosmosContainer bool = false
param referenceSearchIndex bool = false
param chatModelName string
param chatModelVersion string
param chatModelSku string = 'GlobalStandard'
param chatModelCapacity int = 10
param embeddingModelName string = 'text-embedding-3-small'
param embeddingModelVersion string = '1'
param embeddingModelSku string = 'GlobalStandard'
param embeddingModelCapacity int = 10
param cosmosPartitionKeyPath string = '/id'
param tags object = {}

var suffix = take(toLower(deploymentStamp), 6)
var projectName = take('proj-${workloadName}-${suffix}', 64)
var chatDeploymentName = take('${chatModelName}-${suffix}', 64)
var embeddingDeploymentName = take('${embeddingModelName}-${suffix}', 64)
var blobContainerName = take(toLower('${workloadName}-${suffix}'), 63)
var cosmosContainerName = take('${workloadName}-${suffix}', 255)

module foundry './modules/foundry.bicep' = if (deployFoundryProject) {
  name: 'checkout-foundry-${suffix}'
  scope: resourceGroup(foundryResourceGroupName)
  params: {
    location: location
    accountName: foundryAccountName
    projectName: projectName
    deployChatModel: deployChatModel
    deployEmbeddingModel: deployEmbeddingModel
    chatDeploymentName: chatDeploymentName
    chatModelName: chatModelName
    chatModelVersion: chatModelVersion
    chatModelSku: chatModelSku
    chatModelCapacity: chatModelCapacity
    embeddingDeploymentName: embeddingDeploymentName
    embeddingModelName: embeddingModelName
    embeddingModelVersion: embeddingModelVersion
    embeddingModelSku: embeddingModelSku
    embeddingModelCapacity: embeddingModelCapacity
    tags: tags
  }
}

module storage './modules/storage-container.bicep' = if (deployStorageContainer) {
  name: 'checkout-storage-${suffix}'
  scope: resourceGroup(storageResourceGroupName)
  params: {
    accountName: storageAccountName
    containerName: blobContainerName
  }
}

module cosmos './modules/cosmos-container.bicep' = if (deployCosmosContainer) {
  name: 'checkout-cosmos-${suffix}'
  scope: resourceGroup(cosmosResourceGroupName)
  params: {
    accountName: cosmosAccountName
    databaseName: cosmosDatabaseName
    containerName: cosmosContainerName
    partitionKeyPath: cosmosPartitionKeyPath
  }
}

output deployment object = {
  foundryAccountName: foundryAccountName
  foundryAccountResourceId: resourceId(subscription().subscriptionId, foundryResourceGroupName, 'Microsoft.CognitiveServices/accounts', foundryAccountName)
  foundryProjectName: deployFoundryProject ? foundry!.outputs.projectName : ''
  foundryProjectResourceId: deployFoundryProject ? foundry!.outputs.projectResourceId : ''
  foundryProjectEndpoint: deployFoundryProject ? foundry!.outputs.projectEndpoint : ''
  chatModelDeployment: deployChatModel ? foundry!.outputs.chatModelDeployment : ''
  chatModelResourceId: deployChatModel ? foundry!.outputs.chatModelResourceId : ''
  embeddingModelDeployment: deployEmbeddingModel ? foundry!.outputs.embeddingModelDeployment : ''
  embeddingModelResourceId: deployEmbeddingModel ? foundry!.outputs.embeddingModelResourceId : ''
  storageAccountName: deployStorageContainer ? storageAccountName : ''
  storageResourceId: deployStorageContainer ? resourceId(subscription().subscriptionId, storageResourceGroupName, 'Microsoft.Storage/storageAccounts', storageAccountName) : ''
  storageBlobEndpoint: deployStorageContainer ? 'https://${storageAccountName}.blob.${environment().suffixes.storage}' : ''
  storageContainerName: deployStorageContainer ? storage!.outputs.containerName : ''
  storageContainerResourceId: deployStorageContainer ? storage!.outputs.containerResourceId : ''
  cosmosAccountName: cosmosAccountName
  cosmosDatabaseName: cosmosDatabaseName
  cosmosContainerName: deployCosmosContainer ? cosmos!.outputs.containerName : ''
  cosmosContainerResourceId: deployCosmosContainer ? cosmos!.outputs.containerResourceId : ''
  searchServiceName: referenceSearchIndex ? searchServiceName : ''
  searchResourceId: referenceSearchIndex ? resourceId(subscription().subscriptionId, searchResourceGroupName, 'Microsoft.Search/searchServices', searchServiceName) : ''
  searchEndpoint: referenceSearchIndex ? 'https://${searchServiceName}.search.windows.net' : ''
  searchIndexName: referenceSearchIndex ? searchIndexName : ''
  managedIdentityResourceId: managedIdentityResourceId
}
