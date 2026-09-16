targetScope = 'resourceGroup'

param storageAccountName string
param containerName string
param backendPrincipalId string

var blobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: storageAccount
  name: 'default'
}

resource artifactContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}

resource artifactAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(artifactContainer.id, backendPrincipalId, blobDataContributorRoleId)
  scope: artifactContainer
  properties: {
    principalId: backendPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributorRoleId)
  }
}

output containerName string = artifactContainer.name
output containerUrl string = 'https://${storageAccount.name}.blob.${environment().suffixes.storage}/${artifactContainer.name}'
