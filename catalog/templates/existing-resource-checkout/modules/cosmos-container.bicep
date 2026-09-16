targetScope = 'resourceGroup'

param accountName string
param databaseName string
param containerName string
param partitionKeyPath string

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: accountName
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' existing = {
  parent: account
  name: databaseName
}

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: containerName
  properties: {
    resource: {
      id: containerName
      partitionKey: {
        paths: [
          partitionKeyPath
        ]
        kind: 'Hash'
        version: 2
      }
    }
  }
}

output containerName string = container.name
output containerResourceId string = container.id
