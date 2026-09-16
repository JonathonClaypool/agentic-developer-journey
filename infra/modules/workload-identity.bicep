targetScope = 'resourceGroup'

param identityName string
param aksOidcIssuerUrl string
param kubernetesNamespace string
param serviceAccountName string

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: resourceGroup().location
  tags: {
    application: 'ai-launchpad'
    component: 'backend'
  }
}

resource federatedCredential 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: identity
  name: 'aks-${uniqueString(kubernetesNamespace, serviceAccountName)}'
  properties: {
    audiences: [
      'api://AzureADTokenExchange'
    ]
    issuer: aksOidcIssuerUrl
    subject: 'system:serviceaccount:${kubernetesNamespace}:${serviceAccountName}'
  }
}

output clientId string = identity.properties.clientId
output principalId string = identity.properties.principalId
output resourceId string = identity.id
