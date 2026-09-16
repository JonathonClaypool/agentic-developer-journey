targetScope = 'resourceGroup'

param accountName string
param containerName string

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: accountName
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: account
  name: 'default'
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}

output containerName string = container.name
output containerResourceId string = container.id
