import {api} from './client'
import type {AgentStarterKitRequest,ArchitecturePackageRequest,DeploymentManifest,DeploymentProgress,DeploymentResourceKey,GeneratedAgentStarterKit,GeneratedBicepPackage} from './models'

const resourceKeys:Record<string,DeploymentResourceKey>={
  'Microsoft Foundry':'foundry','Managed Identity':'managed-identity','Azure Blob Storage':'storage','Storage Account':'storage',
  'Cosmos DB':'cosmos',
  'Azure AI Search':'ai-search','Application Insights':'observability','Virtual Network':'private-network',
  'Foundry embedding model deployment':'embedding-model',
}

export function deploymentKeysFor(resourceNames:string[]):DeploymentResourceKey[]{
  const keys=new Set<DeploymentResourceKey>()
  resourceNames.forEach(name=>{
    if(name.startsWith('Foundry model deployment:'))keys.add('chat-model')
    if(name.startsWith('Foundry embedding model deployment:'))keys.add('embedding-model')
    const key=resourceKeys[name];if(key)keys.add(key)
  })
  return [...keys]
}

export const createBicepPackage=(request:ArchitecturePackageRequest)=>api<GeneratedBicepPackage>('/api/packages',{method:'POST',body:JSON.stringify(request)})
export const getBicepPackage=(packageId:string)=>api<GeneratedBicepPackage>(`/api/packages/${packageId}`)
export const runPackageWhatIf=(packageId:string,subscriptionId:string)=>api<{result:{changes?:unknown[]};confirmationToken:string;expiresInSeconds:number}>(`/api/packages/${packageId}/what-if`,{method:'POST',body:JSON.stringify({subscriptionId})})
export const deployPackage=(packageId:string,subscriptionId:string,confirmationToken:string)=>api<{deploymentName:string;state:string}>(`/api/packages/${packageId}/deploy`,{method:'POST',body:JSON.stringify({subscriptionId,confirmationToken})})
export const getPackageDeploymentStatus=(packageId:string,deploymentName:string,subscriptionId:string)=>api<DeploymentProgress>(`/api/packages/${packageId}/deployments/${deploymentName}/status`,{method:'POST',body:JSON.stringify({subscriptionId})})
export const createAgentStarterKit=(packageId:string,request:AgentStarterKitRequest)=>api<GeneratedAgentStarterKit>(`/api/packages/${packageId}/agent-starter-kits`,{method:'POST',body:JSON.stringify(request)})

export const previewDeployment=async(manifest:DeploymentManifest)=>createBicepPackage(manifest)
export const runDeploymentWhatIf=async(manifest:DeploymentManifest):Promise<{confirmationToken:string}>=>{void manifest;throw new Error('Approve the architecture to generate a Bicep package first.')}
export const startDeployment=async(manifest:DeploymentManifest,confirmationToken:string):Promise<object>=>{void manifest;void confirmationToken;throw new Error('Deploy the approved Bicep package from Provisioning.')}
