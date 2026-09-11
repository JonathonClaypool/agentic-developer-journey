export type DeploymentResourceKey = 'foundry'|'chat-model'|'embedding-model'|'managed-identity'|'storage'|'ai-search'|'observability'|'private-network'

export type OperationalRequirements = {
  environments:'dev'|'dev-test'|'dev-test-prod';scale:'small'|'medium'|'large'
  serviceHours:'business-hours'|'extended-hours'|'24x7';businessImpact:'low'|'material'|'critical'
  rtoMinutes:15|60|240|1440;rpoMinutes:0|15|60|1440;failoverMode:'manual'|'operator-approved'|'automatic'
  secondaryRegion?:string;regulatedRecords:boolean;retentionDays:number;immutableAudit:boolean
  dataResidency:string[];customerManagedKeys:boolean
}

export type ArchitecturePlan = {
  profile:'development'|'standard-production'|'business-critical-warm-standby';label:string;deployable:boolean
  targets:{rtoMinutes:number;rpoMinutes:number};derivedParameters:Record<string,string|number|boolean>
  infrastructureChanges:{
    summary:string
    additionalInfrastructure:{resource:string;label:string;reason:string;implementationStatus:string}[]
    existingInfrastructure:{resource:string;label:string;status:'unchanged'|'reconfigured'|'scaled'|'upgraded'|'new'|'removed'|'blocked';current:string;target:string;reason:string}[]
  }
  resources:{type:string;configuration:Record<string,string|number|boolean|undefined>;reason:string}[]
  controls:{id:string;label:string}[];warnings:{severity:string;message:string}[];blockers:string[]
}

export type ArchitecturePackageRequest = {
  applicationId:string
  location:string
  resourceGroupName:string
  workloadName:string
  resources:DeploymentResourceKey[]
  chatModel:{name:string;version:string;sku:'GlobalStandard'|'Standard';capacity:number}
  embeddingModel?:{name:string;version:string;sku:'GlobalStandard'|'Standard';capacity:number}
  operationalRequirements:OperationalRequirements
  tags:Record<string,string>
}

export type GeneratedBicepPackage = ArchitecturePackageRequest & {
  packageId:string
  createdAt:string
  sha256:string
  files:{path:string;content:string}[]
  resourceDetails:{key:DeploymentResourceKey;label:string;module:string}[]
}

export type RegionAssessment = {
  recommendedRegion:string|null
  disclaimer:string
  regions:{region:string;label:string;preferred:boolean;status:'ready'|'conditional'|'blocked';score:number;checks:{name:string;status:'pass'|'warn'|'fail';detail:string}[]}[]
}

export type DeploymentManifest = ArchitecturePackageRequest & {subscriptionId:string}
export type DeploymentProgress = {
  deploymentName:string
  state:string
  timestamp?:string
  duration?:string
  error?:unknown
  resources:{resourceId:string;name:string;type:string;state:string;error?:unknown}[]
}

export type AgentStarterKitRequest = {
  agentName:string
  deploymentMode:'source'|'jfrog'
  mcpConnection?:{name:string;version?:string;apimPath:string}
  includeSearch:boolean
}

export type GeneratedAgentStarterKit = {
  kitId:string
  packageId:string
  createdAt:string
  sha256:string
  deploymentMode:'source'|'jfrog'
  includesSearch:boolean
  connectionCount:number
  configurationSource:'verified-azure-deployment'|'immutable-package-plan'
  downloadUrl:string
  files:{path:string;content:string}[]
}

export type RiskAssessmentRequest = {
  personal:'yes'|'no'|'';health:'yes'|'no'|'';employee:'yes'|'no'|'';confidential:'yes'|'no'|''
  regulated:'yes'|'no'|'';identifiable:'yes'|'no'|'';modelTraining:'yes'|'no'|'';externalData:'yes'|'no'|''
  crossBorder:'yes'|'no'|'';capabilities:string[];autonomy:number;publicFacing:'yes'|'no'|'';safety:'yes'|'no'|''
  quality:'yes'|'no'|'';decisions:'yes'|'no'|'';humanReview:'yes'|'no'|'';audit:'yes'|'no'|''
}

export type RiskAssessment = {
  level:'Low'|'Moderate'|'High'|'Restricted';score:number
  dimensions:{name:string;value:number}[];reasons:string[];reviewers:string[];controls:string[]
}

export type ModelOption = {id:'gpt-5-mini'|'gpt-5'|'o3';name:string;tier:string;description:string;bestFor:string;latency:string;cost:string;context:string;version:string}
export type EmbeddingModelOption = {id:'text-embedding-3-small'|'text-embedding-3-large';name:string;description:string;dimensions:string;cost:string;version:string}
export type ModelRecommendation = {model:ModelOption;score:number;level:'Focused'|'Balanced'|'Advanced';reasons:string[];capacity:string}
export type ModelRecommendationRequest = {capabilities:string[];dataTypes:string[];dataUses:string[];connectors:string[];memory:string[];regulated:boolean;scale:'small'|'medium'|'large'}
export type Catalog = {models:ModelOption[];embeddingModels:EmbeddingModelOption[];regions:{label:string;code:string;suffix:string}[]}
