import { useCallback, useEffect, useRef, useState } from 'react'
import './solution-builder.css'
import './operational-wizard.css'
import './governance-wizard.css'
import { assessRegions, createAgentStarterKit, createBicepPackage, deployPackage, deploymentKeysFor, getPackageDeploymentStatus, planArchitecture, previewDeployment, recommendModel as requestModelRecommendation, runDeploymentWhatIf, runPackageWhatIf, startDeployment, type ArchitecturePackageRequest, type ArchitecturePlan, type DeploymentManifest, type DeploymentProgress, type GeneratedAgentStarterKit, type GeneratedBicepPackage, type OperationalRequirements, type RegionAssessment } from './api'

type Capability = 'chat' | 'grounding' | 'content' | 'agents' | 'actions' | 'documents' | 'uploads' | 'state'
type Connector = 'sharepoint' | 'graph' | 'sql' | 'snowflake' | 'internal-api' | 'on-prem' | 'servicenow' | 'mcp' | 'teams' | 'website'
type Resource = { name: string; type: string; purpose: string; reason: string; icon: string; required: boolean }
type CatalogAsset = { id:string; connector:Connector; kind:'Connector'|'MCP server'|'A2A agent'; source:'Enterprise'|'MedTech'; name:string; domain:string; owner:string; description:string; detail:string; status:'Approved'|'Restricted'|'Pending'|'Not onboarded'; version?:string }
type BicepTemplate = { id:string; name:string; version:string; owner:string; description:string; covers:string[]; files:string[] }
type Requirements = {
  privateNetwork: boolean; externalUsers: boolean; onPremises: boolean; asyncWork: boolean
  multiRegion: boolean; disasterRecovery: boolean; regulated: boolean; customerKey: boolean
  environments: 'dev' | 'dev-test' | 'dev-test-prod'; scale: 'small' | 'medium' | 'large'
  availability: 'standard' | 'high' | 'critical'; region: string
  serviceHours:'business-hours'|'extended-hours'|'24x7';businessImpact:'low'|'material'|'critical'
  rtoMinutes:15|60|240|1440;rpoMinutes:0|15|60|1440;failoverMode:'manual'|'operator-approved'|'automatic'
  secondaryRegion:string;retentionDays:number;immutableAudit:boolean;dataResidency:string[]
}
type DataConfiguration = { access?:'yes'|'no'|''; types:string[]; uses:string[]; freshness:string; controls:string[] }
type ChannelConfiguration = { m365:'yes'|'no'|''; surfaces:string[]; agentStore:'yes'|'no'|'' }
type GovernanceConfiguration = {
  audiences:string[];roleModel:'uniform'|'role-based'|'segregated';privilegedAdmins:boolean
  timeBoundAccess:boolean;accessApproval:boolean;periodicReviews:boolean
  allowDownloads:boolean;productionDataInNonProduction:boolean;humanApprovalForActions:boolean
  conversationMemory:boolean;crossUserData:boolean;auditEvents:string[];siemExport:boolean
  businessOwner:string;technicalOwner:string
}
type ModelId = 'gpt-5-mini' | 'gpt-5' | 'o3'
type ModelOption = { id:ModelId; name:string; tier:string; description:string; bestFor:string; latency:string; cost:string; context:string }
type ModelRecommendation = { model:ModelOption; score:number; level:'Focused'|'Balanced'|'Advanced'; reasons:string[]; capacity:string }
type EmbeddingModelId='text-embedding-3-small'|'text-embedding-3-large'
type EmbeddingModelOption={id:EmbeddingModelId;name:string;description:string;dimensions:string;cost:string}
type WorkspaceScreen = 'overview'|'design'|'describe'|'data'|'connectors'|'channels'|'memory'|'requirements'|'model'|'region'|'architecture'|'iac'|'governance'|'provisioning'|'activity'|'ready'
const workspaceScreenKey='launchpad.workspace-screen'
const generatedPackageKey='launchpad.generated-package'
const activeDeploymentKey='launchpad.active-deployment'
const workspaceScreens=new Set<WorkspaceScreen>(['overview','design','describe','data','connectors','channels','memory','requirements','model','region','architecture','iac','governance','provisioning','activity','ready'])

function restoredWorkspaceScreen():WorkspaceScreen{
  try{
    const value=sessionStorage.getItem(workspaceScreenKey) as WorkspaceScreen|null
    return value&&workspaceScreens.has(value)?value:'overview'
  }catch{return'overview'}
}

function restoredGeneratedPackage():GeneratedBicepPackage|null{
  try{return JSON.parse(sessionStorage.getItem(generatedPackageKey)??'null') as GeneratedBicepPackage|null}catch{return null}
}

const initialRequirements: Requirements = { privateNetwork:true, externalUsers:false, onPremises:false, asyncWork:false, multiRegion:false, disasterRecovery:false, regulated:false, customerKey:false, environments:'dev', scale:'small', availability:'standard', region:'',serviceHours:'business-hours',businessImpact:'low',rtoMinutes:1440,rpoMinutes:1440,failoverMode:'manual',secondaryRegion:'',retentionDays:30,immutableAudit:false,dataResidency:[] }
const operationalRequirements=(requirements:Requirements):OperationalRequirements=>({environments:requirements.environments,scale:requirements.scale,serviceHours:requirements.serviceHours,businessImpact:requirements.businessImpact,rtoMinutes:requirements.rtoMinutes,rpoMinutes:requirements.rpoMinutes,failoverMode:requirements.failoverMode,secondaryRegion:requirements.secondaryRegion||undefined,regulatedRecords:requirements.regulated,retentionDays:requirements.retentionDays,immutableAudit:requirements.immutableAudit,dataResidency:requirements.dataResidency,customerManagedKeys:requirements.customerKey})
const initialDataConfiguration:DataConfiguration = {access:'',types:[],uses:[],freshness:'Daily',controls:[]}
const initialChannelConfiguration:ChannelConfiguration={m365:'',surfaces:[],agentStore:''}
const initialGovernanceConfiguration:GovernanceConfiguration={audiences:['Employees'],roleModel:'role-based',privilegedAdmins:true,timeBoundAccess:false,accessApproval:true,periodicReviews:true,allowDownloads:false,productionDataInNonProduction:false,humanApprovalForActions:true,conversationMemory:false,crossUserData:false,auditEvents:['Sign-ins','Model calls','Data access','Tool execution','Administrative changes','Deployments'],siemExport:false,businessOwner:'',technicalOwner:''}
const approvedCapabilities:Capability[]=['grounding','content']
let navigateWorkspace:((screen:WorkspaceScreen)=>void)|undefined
let workingResources:Resource[]=[]

const foundryModels:ModelOption[]=[
  {id:'gpt-5-mini',name:'GPT-5 mini',tier:'Efficient reasoning',description:'Fast, cost-efficient reasoning for grounded enterprise assistants and high-volume content work.',bestFor:'Summarization, grounded Q&A, extraction, and classification',latency:'Low',cost:'$',context:'Large context'},
  {id:'gpt-5',name:'GPT-5',tier:'Advanced reasoning',description:'Higher reasoning quality for complex instructions, multi-step tools, and consequential workflows.',bestFor:'Agent workflows, complex synthesis, and tool orchestration',latency:'Medium',cost:'$$$',context:'Large context'},
  {id:'o3',name:'o3',tier:'Deep analysis',description:'Deliberative reasoning for difficult analytical tasks where depth matters more than response speed.',bestFor:'Complex analysis, validation, and difficult decision support',latency:'Higher',cost:'$$$',context:'Large context'},
]
const modelVersions:Record<ModelId,string>={'gpt-5-mini':'2025-08-07','gpt-5':'2025-08-07',o3:'2025-04-16'}
const regionCodes:Record<string,string>={'East US':'eastus','East US 2':'eastus2','Central US':'centralus','West US 3':'westus3','West Europe':'westeurope','North Europe':'northeurope','Sweden Central':'swedencentral','Switzerland North':'switzerlandnorth'}
const regionLabels=Object.fromEntries(Object.entries(regionCodes).map(([label,code])=>[code,label]))
const regionSuffixes:Record<string,string>={eastus:'eus',eastus2:'eus2',centralus:'cus',westus3:'wus3',westeurope:'weu',northeurope:'neu',swedencentral:'swc',switzerlandnorth:'chn'}
const azureRegionCode=(region:string)=>regionCodes[region]??region.toLowerCase().replace(/[^a-z0-9]/g,'')

const embeddingModels:EmbeddingModelOption[]=[
  {id:'text-embedding-3-small',name:'Text Embedding 3 Small',description:'Cost-efficient embeddings for general enterprise search and grounded Q&A.',dimensions:'Up to 1,536',cost:'$'},
  {id:'text-embedding-3-large',name:'Text Embedding 3 Large',description:'Higher-quality multilingual and difficult semantic retrieval.',dimensions:'Up to 3,072',cost:'$$'},
]

function initialModelRecommendation(capabilities:Capability[],data:DataConfiguration,connectors:Connector[],memory:string[],requirements:Requirements):ModelRecommendation{
  let score=1
  const reasons:string[]=[]
  if(capabilities.includes('grounding')){score+=1;reasons.push('Grounded answers and source-aware summarization')}
  if(capabilities.includes('agents')){score+=2;reasons.push('Multi-agent coordination')}
  if(capabilities.includes('actions')){score+=2;reasons.push('Tool calls and business actions')}
  if(data.types.length>=3){score+=1;reasons.push('Multiple information types')}
  if(data.uses.some(use=>['metrics','trends'].includes(use))){score+=2;reasons.push('Analytical reasoning')}
  if(connectors.length>=2){score+=1;reasons.push('Multiple governed integrations')}
  if(memory.includes('Workflow checkpoints')){score+=1;reasons.push('Resumable workflows')}
  if(requirements.regulated){score+=1;reasons.push('Regulated workload controls')}
  if(requirements.scale==='large'){score+=1;reasons.push('Large usage profile')}
  const analytical=data.uses.some(use=>['metrics','trends'].includes(use))&&score>=7
  const model=foundryModels.find(option=>option.id===(analytical?'o3':score>=6?'gpt-5':'gpt-5-mini'))!
  return {model,score,level:score>=7?'Advanced':score>=4?'Balanced':'Focused',reasons:reasons.length?reasons:['Focused content-generation workload'],capacity:requirements.scale==='large'?'80K TPM':requirements.scale==='medium'?'30K TPM':'10K TPM'}
}

const capabilityOptions: { id: Capability; title: string; description: string; icon: string }[] = [
  { id: 'chat', title: 'Conversational experience', description: 'Users interact through a secure chat interface.', icon: '◌' },
  { id: 'grounding', title: 'Grounded answers', description: 'Answer from approved enterprise knowledge.', icon: '⌕' },
  { id: 'content', title: 'Content generation', description: 'Draft, rewrite, summarize, or classify content.', icon: '✦' },
  { id: 'agents', title: 'Agent workflows', description: 'Coordinate one or more specialized AI agents.', icon: '⌘' },
  { id: 'actions', title: 'Tools & system actions', description: 'Call approved APIs or perform business actions.', icon: '⚡' },
  { id: 'documents', title: 'Document processing', description: 'Extract and understand PDFs, scans, or forms.', icon: '▤' },
  { id: 'uploads', title: 'User uploads', description: 'Allow users to submit files for analysis.', icon: '⇧' },
  { id: 'state', title: 'Persistent application data', description: 'Store sessions, preferences, or workflow state.', icon: '⬡' },
]

const catalogAssets:CatalogAsset[] = [
  {id:'sap',connector:'internal-api',kind:'Connector',source:'Enterprise',name:'SAP S/4HANA',domain:'ERP',owner:'IT Integration',description:'Enterprise resource and supply chain operations.',detail:'OData v4 · Entra-secured',status:'Approved'},
  {id:'snowflake',connector:'snowflake',kind:'Connector',source:'Enterprise',name:'Snowflake',domain:'Data',owner:'Enterprise Data',description:'Governed enterprise analytical datasets.',detail:'Role-level security enforced',status:'Approved'},
  {id:'servicenow',connector:'servicenow',kind:'Connector',source:'Enterprise',name:'ServiceNow',domain:'ITSM',owner:'IT Ops',description:'Incidents, requests, changes, and CMDB scopes.',detail:'Scoped read / write actions',status:'Approved'},
  {id:'sharepoint',connector:'sharepoint',kind:'Connector',source:'Enterprise',name:'SharePoint Online',domain:'Collaboration',owner:'Microsoft 365',description:'Approved sites and document libraries.',detail:'Microsoft Graph · delegated or app access',status:'Approved'},
  {id:'veeva',connector:'internal-api',kind:'Connector',source:'MedTech',name:'Veeva Vault QualityDocs',domain:'Quality',owner:'Quality IT',description:'Controlled quality documents and evidence.',detail:'GxP · evidence required',status:'Restricted'},
  {id:'adx',connector:'internal-api',kind:'Connector',source:'Enterprise',name:'Azure Data Explorer',domain:'Telemetry',owner:'Platform Data',description:'Operational telemetry and time-series data.',detail:'Onboarding request required',status:'Not onboarded'},
  {id:'mcp-complaint',connector:'mcp',kind:'MCP server',source:'MedTech',name:'mcp-complaint-intake',domain:'Market Surveillance',owner:'Post-Market Surveillance',description:'Ingest and normalize post-market complaints.',detail:'Entra app role + subkey · /mcp/complaint-intake',status:'Approved',version:'v2.4.1'},
  {id:'mcp-veeva',connector:'mcp',kind:'MCP server',source:'MedTech',name:'mcp-veeva-quality-docs',domain:'Quality',owner:'Quality IT',description:'Read controlled quality documents with audit trail.',detail:'Managed identity OBO · /mcp/veeva-quality',status:'Approved',version:'v1.9.0'},
  {id:'mcp-device',connector:'mcp',kind:'MCP server',source:'MedTech',name:'mcp-device-master-data',domain:'Device Engineering',owner:'Device Engineering',description:'Device master records, UDI, and product hierarchy.',detail:'Entra app role · /mcp/device-master',status:'Approved',version:'v3.1.2'},
  {id:'mcp-clinical',connector:'mcp',kind:'MCP server',source:'MedTech',name:'mcp-clinical-trial-lookup',domain:'Clinical',owner:'Clinical Data',description:'Search study metadata and protocol references.',detail:'Approval workflow in progress',status:'Pending',version:'v0.8.0'},
  {id:'agent-quality',connector:'internal-api',kind:'A2A agent',source:'MedTech',name:'Quality Evidence Agent',domain:'Quality',owner:'Quality AI CoE',description:'Finds, summarizes, and cites approved quality evidence.',detail:'A2A · human review required',status:'Approved',version:'v1.4'},
  {id:'agent-privacy',connector:'internal-api',kind:'A2A agent',source:'Enterprise',name:'Privacy Classification Agent',domain:'Privacy',owner:'Responsible AI',description:'Classifies data handling and identifies privacy controls.',detail:'A2A · advisory output only',status:'Approved',version:'v2.0'},
  {id:'agent-regulatory',connector:'internal-api',kind:'A2A agent',source:'MedTech',name:'Regulatory Research Agent',domain:'Regulatory',owner:'Regulatory Operations',description:'Locates and compares approved regulatory references.',detail:'Evidence package required',status:'Restricted',version:'v0.9'},
]

const bicepTemplates:BicepTemplate[] = [
  {id:'secure-ai-baseline',name:'Secure AI application baseline',version:'v4.2.0',owner:'Enterprise Cloud Platform',description:'Subscription-scoped landing zone with mandatory identity, security, observability, and private networking controls.',covers:['Microsoft Foundry','Managed Identity','Key Vault','Application Insights','Virtual Network','Private Endpoints & Private DNS','Log Analytics Workspace'],files:['main.bicep','resources.bicep','main.bicepparam']},
  {id:'knowledge-document-pack',name:'Knowledge & document processing pack',version:'v2.7.1',owner:'AI Platform Engineering',description:'Reusable modules for governed retrieval, document storage, indexing, and extraction.',covers:['Azure AI Search','Storage Account','Document Intelligence'],files:['modules/knowledge.bicep','modules/documents.bicep']},
  {id:'agent-integration-pack',name:'Agent runtime & integration pack',version:'v3.1.0',owner:'AI Platform Engineering',description:'Containerized agent runtime with governed APIs, messaging, and private MCP hosting.',covers:['Azure Container Apps','API Management','Service Bus','Container Apps for MCP','Microsoft Graph Integration'],files:['modules/runtime.bicep','modules/integration.bicep']},
  {id:'resilience-connectivity-pack',name:'Resilience & connectivity pack',version:'v1.8.3',owner:'Cloud Reliability Engineering',description:'Optional enterprise modules for ingress, hybrid connectivity, controlled egress, and recovery.',covers:['Azure Front Door + WAF','VPN Gateway','Controlled Outbound Egress','Recovery & Geo-Replication'],files:['modules/connectivity.bicep','modules/resilience.bicep']},
]

const optionalResources:Resource[]=[
  {name:'Azure Front Door + WAF',type:'Edge security',purpose:'Secure global ingress and web protection',reason:'Added by solution designer',icon:'◫',required:false},
  {name:'Service Bus',type:'Messaging',purpose:'Reliable asynchronous workflow processing',reason:'Added by solution designer',icon:'⇥',required:false},
  {name:'Cosmos DB',type:'Application data',purpose:'Store application and workflow state',reason:'Added by solution designer',icon:'◎',required:false},
  {name:'API Management',type:'Integration',purpose:'Govern, authenticate, and audit API calls',reason:'Added by solution designer',icon:'⚡',required:false},
  {name:'Azure AI Search',type:'Knowledge retrieval',purpose:'Index and retrieve approved knowledge',reason:'Added by solution designer',icon:'⌕',required:false},
  {name:'Microsoft Fabric',type:'Analytics',purpose:'Use governed data products and semantic models',reason:'Added by solution designer',icon:'F',required:false},
]

function resourcesFor(selected: Capability[], requirements: Requirements, connectors: Connector[], data:DataConfiguration=initialDataConfiguration, memory:string[]=[]): Resource[] {
  const resources: Resource[] = [
    { name: 'Microsoft Foundry', type: 'AI platform', purpose: 'Model and agent runtime', reason: 'Required for all governed AI applications', icon: '✦', required: true },
    { name: 'Managed Identity', type: 'Identity', purpose: 'Passwordless service authentication', reason: 'Required security baseline', icon: '◇', required: true },
    { name: 'Key Vault', type: 'Security', purpose: 'Certificates and protected configuration', reason: 'Required security baseline', icon: '⌑', required: true },
    { name: 'Application Insights', type: 'Observability', purpose: 'Tracing, monitoring, and audit evidence', reason: 'Required governance baseline', icon: '↗', required: true },
    { name: 'Log Analytics Workspace', type: 'Observability', purpose: 'Store monitoring, diagnostic, and audit logs', reason: requirements.regulated?'Required for regulated workload evidence':'Required by workspace-based Application Insights', icon: '▥', required: true },
  ]
  if (selected.some(x => ['chat', 'agents', 'actions'].includes(x))) resources.push({ name: 'Azure Container Apps', type: 'Application runtime', purpose: 'Host the application and APIs', reason: 'Selected interactive or agent experience', icon: '▣', required: false })
  if (selected.includes('uploads')) resources.push({ name: 'Azure Blob Storage', type: 'Data', purpose: 'Store uploaded application files', reason: 'Selected user file uploads', icon: '▱', required: false })
  if (selected.includes('documents')) resources.push({ name: 'Document Intelligence', type: 'AI service', purpose: 'Extract text, tables, and document structure', reason: 'Selected document processing', icon: '▤', required: false })
  if (selected.includes('state')) resources.push({ name: 'Cosmos DB', type: 'Application data', purpose: 'Store session and workflow state', reason: 'Selected persistent application data', icon: '⬡', required: false })
  if (selected.includes('actions')) resources.push({ name: 'API Management', type: 'Integration', purpose: 'Govern tool and API access', reason: 'Selected tools and system actions', icon: '⚡', required: false })
  if (requirements.privateNetwork) resources.push({ name: 'Virtual Network', type: 'Networking', purpose: 'Isolate production application and AI traffic', reason: 'Required for production · omitted from POC deployment', icon: '◎', required: true })
  if (requirements.privateNetwork) resources.push({ name: 'Private Endpoints & Private DNS', type: 'Networking', purpose: 'Provide private production access to Azure services', reason: 'Required for production · omitted from POC deployment', icon: '◉', required: true })
  if (requirements.externalUsers) resources.push({ name: 'Azure Front Door + WAF', type: 'Edge security', purpose: 'Secure global ingress and web protection', reason: 'Selected external user access', icon: '◫', required: true })
  if (requirements.onPremises) resources.push({ name: 'VPN Gateway', type: 'Hybrid connectivity', purpose: 'Connect J&J networks to the application', reason: 'Selected on-premises integration', icon: '⇄', required: false })
  if (requirements.asyncWork) resources.push({ name: 'Service Bus', type: 'Messaging', purpose: 'Reliable asynchronous workflow processing', reason: 'Selected long-running or asynchronous work', icon: '⇥', required: false })
  if (requirements.customerKey) resources.push({ name: 'Customer-Managed Keys', type: 'Encryption', purpose: 'Control data-encryption keys in Key Vault', reason: 'Selected customer-managed encryption', icon: '⌑', required: true })
  if (requirements.multiRegion || requirements.disasterRecovery) resources.push({ name: 'Recovery & Geo-Replication', type: 'Resilience', purpose: 'Replicate critical data and configuration', reason: requirements.multiRegion ? 'Multi-region operation selected' : 'Disaster recovery selected', icon: '↻', required: false })
  if (connectors.includes('sharepoint') || connectors.includes('graph')) resources.push({ name:'Microsoft Graph Integration',type:'Connector',purpose:'Access approved Microsoft 365 content and actions',reason:'SharePoint or Microsoft Graph selected',icon:'G',required:false })
  if (connectors.some(x=>['internal-api','servicenow','mcp'].includes(x))) resources.push({ name:'API Management',type:'Integration',purpose:'Govern, authenticate, and audit tool calls',reason:'Selected API or tool connector',icon:'⚡',required:false })
  if (connectors.includes('sql')) resources.push({ name:'Azure SQL Private Connection',type:'Data connection',purpose:'Connect to structured data using private access',reason:'Azure SQL selected',icon:'▤',required:false })
  if (connectors.includes('snowflake') || connectors.includes('servicenow') || connectors.includes('website')) resources.push({ name:'Controlled Outbound Egress',type:'Networking',purpose:'Restrict and inspect outbound connector traffic',reason:'External SaaS or web connector selected',icon:'⇢',required:true })
  if (connectors.includes('on-prem')) resources.push({ name:'VPN Gateway',type:'Hybrid connectivity',purpose:'Connect J&J networks to the application',reason:'On-premises data source selected',icon:'⇄',required:true })
  if (connectors.includes('mcp')) resources.push({ name:'Container Apps for MCP',type:'Tool hosting',purpose:'Host approved private MCP tool servers',reason:'Approved MCP server selected',icon:'M',required:false })
  if (connectors.includes('teams')) resources.push({ name:'Azure Bot / Teams Channel',type:'User channel',purpose:'Expose the application in Microsoft Teams',reason:'Microsoft Teams selected',icon:'T',required:false })
  const hasDocuments=data.types.some(type=>['documents','uploads'].includes(type))
  const hasAnalytics=data.types.includes('analytics')
  if(hasDocuments) resources.push({name:'Azure AI Search',type:'Knowledge retrieval',purpose:'Index and retrieve approved document knowledge',reason:'Documents or uploaded files selected in Data & Knowledge',icon:'⌕',required:false})
  if(hasDocuments) resources.push({name:'Azure Blob Storage',type:'Data',purpose:'Store application-managed documents and extracted content',reason:'Unstructured information selected in Data & Knowledge',icon:'▱',required:false})
  if(hasAnalytics) resources.push({name:'Microsoft Fabric',type:'Analytics',purpose:'Query governed data products, semantic models, and metrics',reason:'Analytical data selected in Data & Knowledge',icon:'F',required:false})
  if(hasDocuments&&hasAnalytics) resources.push({name:'Foundry IQ',type:'Knowledge platform',purpose:'Unify governed document and analytical grounding for agents',reason:'Both unstructured and structured information are required',icon:'IQ',required:false})
  if(data.types.includes('operational')) resources.push({name:'API Management',type:'Integration',purpose:'Govern live access to operational systems of record',reason:'Live operational records selected in Data & Knowledge',icon:'⚡',required:false})
  if(data.types.includes('uploads')) resources.push({name:'Document Intelligence',type:'AI service',purpose:'Extract text, tables, and document structure',reason:'User-uploaded files selected in Data & Knowledge',icon:'▤',required:false})
  if(memory.length) resources.push({name:'Cosmos DB',type:'Application data',purpose:'Store conversation memory and resumable workflow state',reason:`${memory.length} memory ${memory.length===1?'capability':'capabilities'} selected`,icon:'◎',required:false})
  return resources.filter((resource,index,array)=>array.findIndex(item=>item.name===resource.name)===index)
}

const workspaceItems:{id:WorkspaceScreen;label:string;icon:string;status:string}[]=[
  {id:'overview',label:'Overview',icon:'⌂',status:'complete'},
  {id:'data',label:'Data & Knowledge',icon:'⌕',status:'action'},
  {id:'connectors',label:'Tools & Agents',icon:'⚡',status:'progress'},
  {id:'channels',label:'Channels & Distribution',icon:'T',status:'progress'},
  {id:'memory',label:'Memory & State',icon:'◎',status:'progress'},
  {id:'requirements',label:'Architecture',icon:'◇',status:'progress'},
  {id:'governance',label:'Access & Governance',icon:'▣',status:'action'},
  {id:'model',label:'Model & Capacity',icon:'✦',status:'progress'},
  {id:'iac',label:'Infrastructure & Deploy',icon:'⌘',status:'complete'},
  {id:'activity',label:'Activity',icon:'≡',status:'complete'},
]

function WorkspaceNav({screen,resources,profile,navigate}:{screen:WorkspaceScreen;resources:Resource[];profile:string[];navigate:(screen:WorkspaceScreen)=>void}){
  const active=screen==='architecture'?'requirements':screen==='design'||screen==='describe'?'overview':screen
  const showAzure=['architecture','iac','provisioning'].includes(screen)
  return <aside className="workspace-nav"><div><span>APPROVED APPLICATION</span><h2>Quality Event Summarizer</h2><small>AI-2026-0118 · High risk</small></div><nav>{workspaceItems.map(item=><button className={active===item.id?'active':''} disabled={item.status==='locked'} onClick={()=>navigate(item.id)} key={item.id}><i>{item.icon}</i><span>{item.label}</span><b className={item.status}>{item.status==='complete'?'✓':item.status==='action'?'!':item.status==='locked'?'🔒':'●'}</b></button>)}</nav><section className={`workspace-components ${showAzure?'azure-mode':'profile-mode'}`}><header><span>{showAzure?'AZURE COMPONENTS':'SOLUTION PROFILE'}</span><b>{showAzure?resources.length:profile.length}</b></header><p>{showAzure?'Generated from confirmed requirements.':'Business requirements collected so far.'}</p><div>{showAzure?resources.map(resource=><button onClick={()=>navigate('architecture')} key={resource.name}><i>{resource.icon}</i><span><strong>{resource.name}</strong><small>{resource.required?'Required baseline':resource.reason}</small></span></button>):profile.length?profile.map(item=><button onClick={()=>undefined} key={item}><i>✓</i><span><strong>{item}</strong><small>Confirmed requirement</small></span></button>):<span className="profile-empty">No requirements selected yet.</span>}</div></section></aside>
}

function WorkspacePage({kicker,title,description,children}:{kicker:string;title:string;description:string;children:React.ReactNode}){return <><div className="workspace-heading"><span>{kicker}</span><h1>{title}</h1><p>{description}</p></div>{children}</>}

export function LegacyDataKnowledge({data,setData}:{data:DataConfiguration;setData:React.Dispatch<React.SetStateAction<DataConfiguration>>}){
  const toggle=(field:'types'|'uses'|'controls',value:string)=>setData(current=>({...current,[field]:current[field].includes(value)?current[field].filter(item=>item!==value):[...current[field],value]}))
  const hasDocuments=data.types.some(type=>['documents','uploads'].includes(type))
  const hasAnalytics=data.types.includes('analytics')
  const hasOperational=data.types.includes('operational')
  const recommendations=[
    ...(hasDocuments?[['⌕','Document grounding','Search, retrieve, and cite approved document knowledge']]:[]),
    ...(hasAnalytics?[['▤','Analytical reasoning','Use governed metrics, semantic models, and calculations']]:[]),
    ...(hasDocuments&&hasAnalytics?[['◇','Unified knowledge access','Combine document and analytical information in one experience']]:[]),
    ...(hasOperational?[['⚡','Live operational access','Retrieve current records from systems of record']]:[]),
    ...(data.types.includes('uploads')?[['⇧','File ingestion','Extract content and structure from user-submitted files']]:[]),
  ]
  return <WorkspacePage kicker="DATA & KNOWLEDGE" title="What information does the application need?" description="Describe the information and intended use. Azure services will be generated later from the completed solution profile."><div className="data-question-layout"><section className="solution-card data-questionnaire"><div className="data-question"><div className="question-number">01</div><div className="question-copy"><h2>What type of information is needed?</h2><p>Select every category the application must access.</p></div><div className="data-choice-grid">{[['documents','Documents & enterprise knowledge','PDFs, policies, SharePoint, presentations, and web content','▧'],['analytics','Business metrics & analytical data','Tables, semantic models, lakehouses, KPIs, and historical trends','▤'],['operational','Live operational records','Current records from systems such as SAP, ServiceNow, or CRM','⚡'],['uploads','User-uploaded files','Documents or forms submitted directly for analysis','⇧']].map(option=><button className={data.types.includes(option[0])?'selected':''} onClick={()=>toggle('types',option[0])} key={option[0]}><i>{option[3]}</i><span><strong>{option[1]}</strong><small>{option[2]}</small></span><b>{data.types.includes(option[0])?'✓':''}</b></button>)}</div></div><div className="data-question"><div className="question-number">02</div><div className="question-copy"><h2>How should the application use it?</h2><p>This distinguishes grounding from analytics and tools.</p></div><div className="use-options">{[['search','Search and answer'],['citations','Return citations'],['metrics','Calculate metrics'],['trends','Analyze trends'],['current','Retrieve current records'],['write','Create or update records']].map(option=><button className={data.uses.includes(option[0])?'selected':''} onClick={()=>toggle('uses',option[0])} key={option[0]}><b>{data.uses.includes(option[0])?'✓':'+'}</b>{option[1]}</button>)}</div></div><div className="data-question"><div className="question-number">03</div><div className="question-copy"><h2>How current must the information be?</h2><p>Freshness determines synchronization and live-access patterns.</p></div><div className="freshness-options">{['Real time','Hourly','Daily','Weekly'].map(option=><button className={data.freshness===option?'selected':''} onClick={()=>setData(current=>({...current,freshness:option}))} key={option}>{option}</button>)}</div></div><div className="data-question"><div className="question-number">04</div><div className="question-copy"><h2>Which controls are required?</h2><p>Recommended controls are preselected from the application risk profile.</p></div><div className="control-options">{[['permissions','Preserve source permissions'],['citations','Citations required'],['region','Keep data in approved region'],['boundary','Prevent cross-unit access']].map(option=><label key={option[0]}><input type="checkbox" checked={data.controls.includes(option[0])} onChange={()=>toggle('controls',option[0])}/><span>{option[1]}</span></label>)}</div></div></section><aside className="solution-card data-recommendation"><div><span>SOLUTION PROFILE</span><h2>Information requirements</h2><p>Technical implementation is intentionally deferred until Architecture.</p></div>{recommendations.length?<div className="recommended-services">{recommendations.map(service=><article key={service[1]}><i>{service[0]}</i><span><strong>{service[1]}</strong><small>{service[2]}</small></span><b>Captured</b></article>)}</div>:<div className="no-data-needed"><b>—</b><strong>No information selected</strong><span>Select an information type to build the solution profile.</span></div>}<section className="mapping-reason"><strong>Services come later</strong><p>The Architecture page will translate these confirmed requirements into Foundry IQ, Fabric, AI Search, storage, or governed API components as appropriate.</p></section><dl><div><dt>Freshness</dt><dd>{data.freshness}</dd></div><div><dt>Citations</dt><dd>{data.controls.includes('citations')?'Required':'Optional'}</dd></div><div><dt>Source permissions</dt><dd>{data.controls.includes('permissions')?'Preserved':'Application-defined'}</dd></div></dl></aside></div></WorkspacePage>
}

function DataKnowledge({data,setData,next=()=>navigateWorkspace?.('connectors')}:{data:DataConfiguration;setData:React.Dispatch<React.SetStateAction<DataConfiguration>>;next?:()=>void}){
  const access=data.access||(data.types.length?'yes':'')
  const toggle=(field:'types'|'uses'|'controls',value:string)=>setData(current=>({...current,[field]:current[field].includes(value)?current[field].filter(item=>item!==value):[...current[field],value]}))
  const chooseAccess=(value:'yes'|'no')=>setData(current=>value==='no'?{...initialDataConfiguration,access:'no'}:{...current,access:'yes'})
  const useOptions=[
    ...(data.types.some(type=>['documents','uploads'].includes(type))?[['search','Search and answer'],['citations','Return citations']]:[]),
    ...(data.types.includes('analytics')?[['metrics','Calculate metrics'],['trends','Analyze trends']]:[]),
    ...(data.types.includes('operational')?[['current','Retrieve current records'],['write','Create or update records']]:[]),
  ]
  return <WorkspacePage kicker="DATA & KNOWLEDGE" title="Does this application need access to data?" description="Start with a simple answer. We will ask only the follow-up questions needed to determine the right architecture.">
    <div className="data-question-layout progressive-data-layout">
      <section className="solution-card data-questionnaire">
        <div className="data-gate">
          <div className="question-number">01</div>
          <div><h2>Will the application read, search, analyze, receive, or update information?</h2><p>This includes enterprise documents, business metrics, live records, and files uploaded by users.</p></div>
          <div className="binary-choice">
            <button className={access==='yes'?'selected':''} onClick={()=>chooseAccess('yes')}><b>{access==='yes'?'✓':'Yes'}</b><span><strong>Yes, it needs data</strong><small>Ask me a few follow-up questions.</small></span></button>
            <button className={access==='no'?'selected':''} onClick={()=>chooseAccess('no')}><b>{access==='no'?'✓':'No'}</b><span><strong>No data access</strong><small>The application only uses user-entered prompts.</small></span></button>
          </div>
        </div>
        {access==='yes'&&<>
          <div className="progressive-question">
            <div className="question-number">02</div><div className="question-copy"><h2>What kind of information does it need?</h2><p>Select all that apply. These choices determine the next questions.</p></div>
            <div className="data-choice-grid">{[['documents','Documents & knowledge','Policies, PDFs, SharePoint, presentations, or web content','▧'],['analytics','Metrics & analytical data','Tables, semantic models, KPIs, or historical trends','▤'],['operational','Live business records','Current records from SAP, ServiceNow, CRM, or another system','⚡'],['uploads','Files from users','Documents or forms submitted directly to the application','⇧']].map(option=><button className={data.types.includes(option[0])?'selected':''} onClick={()=>toggle('types',option[0])} key={option[0]}><i>{option[3]}</i><span><strong>{option[1]}</strong><small>{option[2]}</small></span><b>{data.types.includes(option[0])?'✓':''}</b></button>)}</div>
          </div>
          {data.types.length>0&&<div className="progressive-question revealed-question">
            <div className="question-number">03</div><div className="question-copy"><h2>What should the application do with it?</h2><p>Only actions relevant to the information selected above are shown.</p></div>
            <div className="use-options">{useOptions.map(option=><button className={data.uses.includes(option[0])?'selected':''} onClick={()=>toggle('uses',option[0])} key={option[0]}><b>{data.uses.includes(option[0])?'✓':'+'}</b>{option[1]}</button>)}</div>
          </div>}
          {data.uses.length>0&&<div className="progressive-question revealed-question">
            <div className="question-number">04</div><div className="question-copy"><h2>Which safeguards are needed?</h2><p>Choose the controls that must follow the information into the application.</p></div>
            <div className="control-options">{[['permissions','Preserve source permissions'],['citations','Show citations'],['region','Keep data in approved region'],['boundary','Prevent cross-unit access']].map(option=><label key={option[0]}><input type="checkbox" checked={data.controls.includes(option[0])} onChange={()=>toggle('controls',option[0])}/><span>{option[1]}</span></label>)}</div>
          </div>}
        </>}
        {access==='no'&&<div className="no-data-branch"><i>✓</i><span><strong>No data infrastructure will be added</strong><small>This answer can be changed later. The architecture will not include knowledge, analytics, ingestion, or operational-data services.</small></span></div>}
        {access&&<div className="progressive-actions"><span>{access==='no'?'No data access required':`${data.types.length} information ${data.types.length===1?'type':'types'} selected`}</span><button className="solution-primary" disabled={access==='yes'&&!data.types.length} onClick={next}>Save to solution profile <b>→</b></button></div>}
      </section>
      <Recommendation resources={workingResources}/>
    </div>
  </WorkspacePage>
}

export function LegacyMemoryState({memory,setMemory}:{memory:string[];setMemory:React.Dispatch<React.SetStateAction<string[]>>}){const options=[['Session memory','Retain context during a conversation'],['Long-term user memory','Remember user preferences across conversations'],['Shared case memory','Share context across an approved team or business case'],['Workflow checkpoints','Resume interrupted agent workflows']];return <WorkspacePage kicker="MEMORY & STATE" title="Define what the application remembers" description="Select only the memory patterns required by the application."><div className="memory-layout"><section className="solution-card workspace-section"><div className="memory-options">{options.map(option=><button className={memory.includes(option[0])?'selected':''} onClick={()=>setMemory(current=>current.includes(option[0])?current.filter(item=>item!==option[0]):[...current,option[0]])} key={option[0]}><b>{memory.includes(option[0])?'✓':''}</b><span><strong>{option[0]}</strong><small>{option[1]}</small></span></button>)}</div></section></div></WorkspacePage>}

function ChannelsDistribution({channels,setChannels,next=()=>navigateWorkspace?.('memory')}:{channels:ChannelConfiguration;setChannels:React.Dispatch<React.SetStateAction<ChannelConfiguration>>;next?:()=>void}){
  const chooseM365=(value:'yes'|'no')=>setChannels(value==='no'?{m365:'no',surfaces:[],agentStore:'no'}:current=>({...current,m365:'yes'}))
  const toggleSurface=(value:string)=>setChannels(current=>({...current,surfaces:current.surfaces.includes(value)?current.surfaces.filter(item=>item!==value):[...current.surfaces,value]}))
  return <WorkspacePage kicker="CHANNELS & DISTRIBUTION" title="Where will people use this agent?" description="Choose how the approved application is surfaced to users. These answers determine Microsoft 365 integration and publication requirements.">
    <div className="data-question-layout progressive-data-layout">
      <section className="solution-card data-questionnaire">
        <div className="data-gate"><div className="question-number">01</div><div><h2>Should users access this agent through Microsoft 365?</h2><p>This includes Microsoft Teams and Microsoft 365 Copilot experiences.</p></div><div className="binary-choice"><button className={channels.m365==='yes'?'selected':''} onClick={()=>chooseM365('yes')}><b>{channels.m365==='yes'?'✓':'Yes'}</b><span><strong>Yes, integrate with Microsoft 365</strong><small>Choose where the agent should appear.</small></span></button><button className={channels.m365==='no'?'selected':''} onClick={()=>chooseM365('no')}><b>{channels.m365==='no'?'✓':'No'}</b><span><strong>No Microsoft 365 integration</strong><small>Users will access the standalone application.</small></span></button></div></div>
        {channels.m365==='yes'&&<div className="progressive-question revealed-question"><div className="question-number">02</div><div className="question-copy"><h2>Where should the agent be available?</h2><p>Select every Microsoft 365 surface that users need.</p></div><div className="channel-options">{[['teams','Microsoft Teams','Use the agent in Teams chats and approved team contexts','T'],['copilot','Microsoft 365 Copilot','Make the agent available from the Microsoft 365 Copilot experience','M365']].map(option=><button className={channels.surfaces.includes(option[0])?'selected':''} onClick={()=>toggleSurface(option[0])} key={option[0]}><i>{option[3]}</i><span><strong>{option[1]}</strong><small>{option[2]}</small></span><b>{channels.surfaces.includes(option[0])?'✓':''}</b></button>)}</div></div>}
        {channels.m365==='yes'&&channels.surfaces.length>0&&<div className="progressive-question revealed-question"><div className="question-number">03</div><div className="question-copy"><h2>Should employees discover it in the organizational Agent Store?</h2><p>Agent Store publication adds catalog metadata, owner validation, audience assignment, and release approval.</p></div><div className="binary-choice compact-binary"><button className={channels.agentStore==='yes'?'selected':''} onClick={()=>setChannels(current=>({...current,agentStore:'yes'}))}><b>{channels.agentStore==='yes'?'✓':'Yes'}</b><span><strong>Publish to Agent Store</strong><small>Make it discoverable to its approved audience.</small></span></button><button className={channels.agentStore==='no'?'selected':''} onClick={()=>setChannels(current=>({...current,agentStore:'no'}))}><b>{channels.agentStore==='no'?'✓':'No'}</b><span><strong>Do not publish</strong><small>Distribute it through a direct installation or link.</small></span></button></div></div>}
        {channels.m365==='no'&&<div className="no-data-branch"><i>✓</i><span><strong>Standalone application experience</strong><small>No Teams, Microsoft 365 Copilot, or Agent Store integration will be configured.</small></span></div>}
        {channels.m365==='yes'&&channels.surfaces.length>0&&<div className="channel-deployment-note"><b>i</b><span><strong>What this adds</strong><small>Publishing a Foundry custom engine agent provisions Azure Bot Service and a Microsoft Entra app registration. The Microsoft 365 app package and organizational catalog submission are deployment artifacts—not Azure resources.</small></span></div>}
        {channels.m365&&<div className="progressive-actions"><span>{channels.m365==='no'?'Standalone application':`${channels.surfaces.length} Microsoft 365 ${channels.surfaces.length===1?'surface':'surfaces'} selected`}</span><button className="solution-primary" disabled={channels.m365==='yes'&&(!channels.surfaces.length||!channels.agentStore)} onClick={next}>Save and continue to memory <b>→</b></button></div>}
      </section>
      <Recommendation resources={workingResources}/>
    </div>
  </WorkspacePage>
}

function MemoryState({memory,setMemory,next=()=>navigateWorkspace?.('requirements')}:{memory:string[];setMemory:React.Dispatch<React.SetStateAction<string[]>>;next?:()=>void}){
  const [needsMemory,setNeedsMemory]=useState<'yes'|'no'|''>(memory.length?'yes':'')
  const options=[['Session memory','Keep context only while the current conversation is open'],['Long-term user memory','Remember a user’s approved preferences across visits'],['Shared case memory','Keep context for a team, case, or business process'],['Workflow checkpoints','Resume a long-running workflow after interruption']]
  const choose=(value:'yes'|'no')=>{setNeedsMemory(value);if(value==='no')setMemory([])}
  const toggle=(value:string)=>setMemory(current=>current.includes(value)?current.filter(item=>item!==value):[...current,value])
  return <WorkspacePage kicker="MEMORY & STATE" title="Does this application need to remember anything?" description="Memory is optional. Start with a simple answer and configure it only when the experience or workflow requires persisted context.">
    <div className="data-question-layout progressive-data-layout">
      <section className="solution-card data-questionnaire">
        <div className="data-gate"><div className="question-number">01</div><div><h2>Should information persist beyond the immediate request?</h2><p>This includes conversation context, user preferences, shared case history, and resumable workflows.</p></div><div className="binary-choice"><button className={needsMemory==='yes'?'selected':''} onClick={()=>choose('yes')}><b>{needsMemory==='yes'?'✓':'Yes'}</b><span><strong>Yes, remember context</strong><small>Ask what needs to persist.</small></span></button><button className={needsMemory==='no'?'selected':''} onClick={()=>choose('no')}><b>{needsMemory==='no'?'✓':'No'}</b><span><strong>No memory needed</strong><small>Each request can remain independent.</small></span></button></div></div>
        {needsMemory==='yes'&&<div className="progressive-question revealed-question"><div className="question-number">02</div><div className="question-copy"><h2>What should the application remember?</h2><p>Select all that apply. Architecture will determine the governed persistence pattern later.</p></div><div className="memory-options progressive-memory-options">{options.map(option=><button className={memory.includes(option[0])?'selected':''} onClick={()=>toggle(option[0])} key={option[0]}><b>{memory.includes(option[0])?'✓':''}</b><span><strong>{option[0]}</strong><small>{option[1]}</small></span></button>)}</div></div>}
        {needsMemory==='no'&&<div className="no-data-branch"><i>✓</i><span><strong>No persistent state will be added</strong><small>The application will process each request independently. This can be changed later.</small></span></div>}
        {needsMemory&&<div className="progressive-actions"><span>{needsMemory==='no'?'No memory required':`${memory.length} memory ${memory.length===1?'pattern':'patterns'} selected`}</span><button className="solution-primary" disabled={needsMemory==='yes'&&!memory.length} onClick={next}>Save and continue to architecture <b>→</b></button></div>}
      </section>
      <Recommendation resources={workingResources}/>
    </div>
  </WorkspacePage>
}

function ModelSelection({recommendation,selected,setSelected,requiresEmbedding,selectedEmbedding,setSelectedEmbedding,embeddingCapacity,setEmbeddingCapacity,next=()=>navigateWorkspace?.('architecture')}:{recommendation:ModelRecommendation;selected:ModelId;setSelected:(model:ModelId)=>void;requiresEmbedding:boolean;selectedEmbedding:EmbeddingModelId|'';setSelectedEmbedding:(model:EmbeddingModelId)=>void;embeddingCapacity:number;setEmbeddingCapacity:(capacity:number)=>void;next?:()=>void}){
  const chosen=foundryModels.find(model=>model.id===selected)??recommendation.model
  const overridden=chosen.id!==recommendation.model.id
  return <WorkspacePage kicker="MODEL & CAPACITY" title="Choose the Foundry model deployment" description="The recommendation uses the confirmed application requirements. Compare approved alternatives and include the selected deployment in the generated package.">
    <div className="model-selection-layout">
      <section className="solution-card model-selection-card">
        <div className="model-recommendation-hero"><div><span>✦ RECOMMENDED FOR THIS APPLICATION</span><h2>{recommendation.model.name}</h2><p>{recommendation.model.description}</p></div><b>{recommendation.level}<small>Complexity {recommendation.score}/10</small></b></div>
        <div className="model-reasoning"><strong>Why this recommendation</strong><div>{recommendation.reasons.map(reason=><span key={reason}>✓ {reason}</span>)}</div></div>
        <div className="model-options">{foundryModels.map(model=><button className={chosen.id===model.id?'selected':''} onClick={()=>setSelected(model.id)} key={model.id}><div><i>✦</i><span><strong>{model.name}</strong><small>{model.tier}</small></span>{model.id===recommendation.model.id&&<em>Recommended</em>}</div><p>{model.description}</p><dl><div><dt>Best for</dt><dd>{model.bestFor}</dd></div><div><dt>Latency</dt><dd>{model.latency}</dd></div><div><dt>Relative cost</dt><dd>{model.cost}</dd></div><div><dt>Context</dt><dd>{model.context}</dd></div></dl><b>{chosen.id===model.id?'✓ Selected':'Select model'}</b></button>)}</div>
        {requiresEmbedding&&<section className="embedding-selection"><div><span>REQUIRED FOR AZURE AI SEARCH</span><h3>Choose an embedding model</h3><p>Vector and hybrid retrieval require embeddings. Select the model and capacity that will be deployed with this project.</p></div><div className="embedding-options">{embeddingModels.map(model=><button className={selectedEmbedding===model.id?'selected':''} key={model.id} onClick={()=>setSelectedEmbedding(model.id)}><i>⌁</i><span><strong>{model.name}</strong><small>{model.id}</small><p>{model.description}</p><em>{model.dimensions} dimensions · {model.cost}</em></span><b>{selectedEmbedding===model.id?'✓':'Select'}</b></button>)}</div><label>Embedding deployment capacity<select value={embeddingCapacity} onChange={event=>setEmbeddingCapacity(Number(event.target.value))}><option value={10}>10K TPM</option><option value={30}>30K TPM</option><option value={80}>80K TPM</option></select></label>{!selectedEmbedding&&<small className="embedding-required">Choose an embedding model to continue.</small>}</section>}
        {overridden&&<div className="model-override-note"><b>!</b><span><strong>Recommendation overridden</strong><small>{chosen.name} will be recorded as a design decision. Model evaluation must confirm quality, latency, safety, and cost before production.</small></span><button onClick={()=>setSelected(recommendation.model.id)}>Use recommendation</button></div>}
        <div className="progressive-actions"><span>{chosen.name} · {recommendation.capacity}{requiresEmbedding&&selectedEmbedding?` · ${selectedEmbedding} · ${embeddingCapacity}K TPM`:''}</span><button className="solution-primary" disabled={requiresEmbedding&&!selectedEmbedding} onClick={next}>Save model deployments <b>→</b></button></div>
      </section>
      <aside className="solution-card model-deployment-card"><span>DEPLOYMENT PACKAGE</span><h3>{chosen.id}</h3><div><small>Chat model</small><strong>{chosen.name}</strong></div>{requiresEmbedding&&<div><small>Embedding model</small><strong>{selectedEmbedding||'Selection required'}</strong></div>}<div><small>Provider</small><strong>Microsoft Foundry</strong></div><div><small>Deployment type</small><strong>Global Standard</strong></div><div><small>Chat capacity</small><strong>{recommendation.capacity}</strong></div>{requiresEmbedding&&<div><small>Embedding capacity</small><strong>{embeddingCapacity}K TPM</strong></div>}<div><small>Content safety</small><strong>J&amp;J governed policy</strong></div><div><small>Authentication</small><strong>Managed identity</strong></div><p><b>i</b> Region support, model versions, quota, and capacity are validated immediately before provisioning. Only available approved deployments can proceed.</p></aside>
    </div>
  </WorkspacePage>
}

function RegionReadiness({resources,chatModel,embeddingModel,back,confirm}:{resources:ReturnType<typeof deploymentKeysFor>;chatModel:ArchitecturePackageRequest['chatModel'];embeddingModel?:ArchitecturePackageRequest['embeddingModel'];back:()=>void;confirm:(region:string)=>void}){
  const [assessment,setAssessment]=useState<RegionAssessment>()
  const [selectedRegion,setSelectedRegion]=useState('')
  const [error,setError]=useState('')
  const subscriptionId=import.meta.env.VITE_AZURE_SUBSCRIPTION_ID??''
  const candidateRegions=['eastus2','eastus','centralus','westus3']
  useEffect(()=>{
    let active=true
    setAssessment(undefined);setError('')
    void assessRegions({subscriptionId,candidateRegions,resources,chatModel,embeddingModel}).then(result=>{if(active){setAssessment(result);setSelectedRegion(result.recommendedRegion??'')}}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'Region assessment failed')})
    return()=>{active=false}
  },[subscriptionId,resources.join(','),chatModel.name,chatModel.version,chatModel.sku,chatModel.capacity,embeddingModel?.name,embeddingModel?.version,embeddingModel?.sku,embeddingModel?.capacity])
  const selected=assessment?.regions.find(region=>region.region===selectedRegion)
  return <WorkspacePage kicker="REGION READINESS" title="Choose a compatible Azure region" description="The preferred region is now checked against every selected service, exact model deployment, and available subscription quota.">
    <section className="solution-card region-context"><div><span>ASSESSMENT SCOPE</span><strong>United States</strong><small>Comparing approved POC candidate regions</small></div><b>→</b><div><span>FINAL REGION</span><strong>{selected?.label??'Assessing candidates…'}</strong><small>{selected?'Selected after compatibility checks':'No deployment decision has been made'}</small></div></section>
    {!assessment&&!error&&<section className="solution-card region-assessing"><i></i><span><strong>Checking Azure region readiness</strong><small>Verifying service support, model versions, deployment SKUs, and TPM quota across {candidateRegions.length} candidate regions.</small></span></section>}
    {error&&<section className="solution-card plan-error"><b>!</b><span><strong>Region readiness could not be checked</strong><small>{error}</small></span></section>}
    {assessment&&<><div className="region-results">{assessment.regions.map(region=><button className={`${region.status} ${selectedRegion===region.region?'selected':''}`} key={region.region} disabled={region.status==='blocked'} onClick={()=>setSelectedRegion(region.region)}><header><span><i>{region.status==='blocked'?'!':region.status==='conditional'?'◇':'✓'}</i><strong>{region.label}</strong></span><div>{region.preferred&&<em>Preferred</em>}{region.region===assessment.recommendedRegion&&region.status!=='blocked'&&<b>Recommended</b>}</div></header><div className="region-score"><span style={{width:`${region.score}%`}}></span></div><section>{region.checks.map(check=><div key={`${check.name}-${check.detail}`}><i className={check.status}>{check.status==='pass'?'✓':check.status==='warn'?'!':'×'}</i><span><strong>{check.name}</strong><small>{check.detail}</small></span></div>)}</section><footer><strong>{region.status==='blocked'?'Requirements not met':region.status==='conditional'?'Compatible with capacity caveat':'All checks passed'}</strong><span>{selectedRegion===region.region?'✓ Selected':'Select region'}</span></footer></button>)}</div><div className="region-disclaimer"><b>i</b><span><strong>Compatibility is not a capacity reservation</strong><small>{assessment.disclaimer}</small></span></div></>}
    <div className="region-actions"><button className="solution-secondary" onClick={back}>← Model & capacity</button><span>{selected?`${selected.checks.filter(check=>check.status==='pass').length} checks passed · ${selected.checks.filter(check=>check.status==='warn').length} capacity caveats`:error?'Assessment required':'Checking Azure…'}</span><button className="solution-primary" disabled={!selected||selected.status==='blocked'} onClick={()=>selected&&confirm(regionLabels[selected.region]??selected.label)}>Confirm {selected?.label??'region'} →</button></div>
  </WorkspacePage>
}

function GovernancePage({requirements,setRequirement}:{requirements:Requirements;setRequirement:<K extends keyof Requirements>(key:K,value:Requirements[K])=>void}={requirements:initialRequirements,setRequirement:()=>undefined}){return <WorkspacePage kicker="ACCESS & GOVERNANCE" title="Configure access, compliance, and evidence" description="Apply governance obligations after the runtime architecture is defined. These controls remain part of the generated deployment package."><section className="solution-card governance-configuration"><div className="solution-card-head"><div><h2>Compliance and evidence controls</h2><p>Confirm requirements based on the approved data classification and organizational policy.</p></div><span>Policy configuration</span></div><div className="governance-control-grid"><RequirementToggle title="Regulated records" description="Apply evidence retention and controlled-change requirements." value={requirements.regulated} change={()=>setRequirement('regulated',!requirements.regulated)}/><RequirementToggle title="Immutable audit evidence" description="Prevent audit evidence from modification or early deletion." value={requirements.immutableAudit} change={()=>setRequirement('immutableAudit',!requirements.immutableAudit)}/><RequirementToggle title="Customer-managed keys" description="Use organization-controlled encryption keys where supported." value={requirements.customerKey} change={()=>setRequirement('customerKey',!requirements.customerKey)}/><label>Evidence retention<select value={requirements.retentionDays} onChange={event=>setRequirement('retentionDays',Number(event.target.value))}><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option><option value={2555}>7 years</option></select><small>Operational and compliance evidence retention period</small></label></div></section><section className="solution-card governance-list">{[['GenAI Council conditions','4 of 4 acknowledged','complete'],['Information Security review','Approved with private networking','complete'],['Veeva QualityDocs access','Evidence request awaiting owner','action'],['Production validation plan','Required before production','action'],['Managed identity roles','6 assignments prepared','progress']].map(item=><article key={item[0]}><i className={item[2]}>{item[2]==='complete'?'✓':item[2]==='action'?'!':'●'}</i><span><strong>{item[0]}</strong><small>{item[1]}</small></span><button>View details →</button></article>)}</section></WorkspacePage>}

function GovernanceAssessment({requirements,setRequirement,governance,setGovernance,back,next}:{requirements:Requirements;setRequirement:<K extends keyof Requirements>(key:K,value:Requirements[K])=>void;governance:GovernanceConfiguration;setGovernance:React.Dispatch<React.SetStateAction<GovernanceConfiguration>>;back:()=>void;next:()=>void}){
  const [step,setStep]=useState<1|2|3|4|5>(1)
  const update=<K extends keyof GovernanceConfiguration>(key:K,value:GovernanceConfiguration[K])=>setGovernance(current=>({...current,[key]:value}))
  const toggleList=(key:'audiences'|'auditEvents',value:string)=>update(key,governance[key].includes(value)?governance[key].filter(item=>item!==value):[...governance[key],value])
  const controls=[
    'Microsoft Entra authentication and managed identities',
    governance.roleModel!=='uniform'?'Application roles and group-based authorization':'Uniform authenticated-user access',
    governance.privilegedAdmins?'Privileged Identity Management for administrators':'Permanent administrator assignment not requested',
    governance.accessApproval||governance.timeBoundAccess?'Approval-based, time-bound access packages':'Direct group assignment',
    governance.periodicReviews?'Periodic access certification':'No periodic access review requested',
    governance.humanApprovalForActions?'Human approval before consequential tool actions':'Tool execution without an added approval gate',
    requirements.regulated?'Controlled change and regulated evidence retention':'Standard operational evidence',
  ]
  const infrastructure=[
    {name:'Microsoft Entra application and app roles',needed:true,reason:'Authenticate users and enforce solution roles'},
    {name:'Entra ID Governance',needed:governance.accessApproval||governance.timeBoundAccess||governance.periodicReviews,reason:'Access packages, approvals, expiration, and reviews'},
    {name:'Privileged Identity Management',needed:governance.privilegedAdmins,reason:'Eligible, just-in-time administration'},
    {name:'Microsoft Sentinel integration',needed:governance.siemExport,reason:'Export security evidence to the corporate SIEM'},
    {name:'Immutable evidence storage',needed:requirements.immutableAudit,reason:'Prevent modification or early deletion of audit evidence'},
    {name:'Customer-managed key configuration',needed:requirements.customerKey,reason:'Organization-controlled encryption keys and rotation'},
  ].filter(item=>item.needed)
  const steps=['People & access','Data boundaries','AI permissions','Evidence','Review']
  return <WorkspacePage kicker="ACCESS & GOVERNANCE" title="Define who can do what—and prove it" description="Answer business questions. Enterprise policy and approved intake facts are applied automatically."><div className="governance-assessment-layout"><section className={`solution-card governance-assessment governance-step-${step}`}><nav className="governance-stepper" aria-label="Access and governance progress">{steps.map((label,index)=>{const number=(index+1) as 1|2|3|4|5;return <button className={number===step?'current':number<step?'complete':''} onClick={()=>setStep(number)} key={label}><i>{number<step?'✓':number}</i><span>{label}</span></button>})}</nav>
    <section className="governance-question-step"><header><b>1</b><span><h2>Who needs access?</h2><p>Describe people and responsibilities rather than choosing Azure roles.</p></span></header><h3>User populations</h3><div className="governance-choice-grid">{['Employees','Contractors','Partners / HCPs','Patients / public','Service identities'].map(item=><button className={governance.audiences.includes(item)?'selected':''} onClick={()=>toggleList('audiences',item)} key={item}><i>{governance.audiences.includes(item)?'✓':''}</i><span><strong>{item}</strong></span></button>)}</div><div className="governance-field-grid"><label>How should responsibilities differ?<select value={governance.roleModel} onChange={event=>update('roleModel',event.target.value as GovernanceConfiguration['roleModel'])}><option value="uniform">Everyone has the same access</option><option value="role-based">Distinct user and contributor roles</option><option value="segregated">Segregated requester, approver, and administrator roles</option></select></label></div><div className="governance-toggle-grid"><RequirementToggle title="Privileged administrators" description="Some users can configure the application or manage access." value={governance.privilegedAdmins} change={()=>update('privilegedAdmins',!governance.privilegedAdmins)}/><RequirementToggle title="Approval before access" description="A manager, owner, or data steward must approve access." value={governance.accessApproval} change={()=>update('accessApproval',!governance.accessApproval)}/><RequirementToggle title="Time-bound access" description="Contractor or elevated access must expire automatically." value={governance.timeBoundAccess} change={()=>update('timeBoundAccess',!governance.timeBoundAccess)}/><RequirementToggle title="Periodic access reviews" description="Owners must recertify access on a schedule." value={governance.periodicReviews} change={()=>update('periodicReviews',!governance.periodicReviews)}/></div></section>
    <section className="governance-question-step"><header><b>2</b><span><h2>What are the data boundaries?</h2><p>Confirm how governed information may be accessed, stored, and exported.</p></span></header><div className="inherited-governance"><span><b>Inherited from approved intake</b><strong>High-risk application · Confidential quality information · Private J&amp;J network</strong></span><em>Policy applied</em></div><div className="governance-toggle-grid"><RequirementToggle title="Allow result downloads" description="Users may export generated answers or retrieved content." value={governance.allowDownloads} change={()=>update('allowDownloads',!governance.allowDownloads)}/><RequirementToggle title="Production data in non-production" description="Development and test environments may use production records." value={governance.productionDataInNonProduction} change={()=>update('productionDataInNonProduction',!governance.productionDataInNonProduction)}/><RequirementToggle title="Conversation memory" description="Prompt and response history may persist between sessions." value={governance.conversationMemory} change={()=>update('conversationMemory',!governance.conversationMemory)}/><RequirementToggle title="Cross-user data access" description="Authorized users may view information created by others." value={governance.crossUserData} change={()=>update('crossUserData',!governance.crossUserData)}/></div></section>
    <section className="governance-question-step"><header><b>3</b><span><h2>What may the AI and its users do?</h2><p>Separate model invocation, knowledge contribution, administration, and consequential actions.</p></span></header><div className="governance-role-preview">{[['User','Ask questions and view permitted citations'],['Knowledge contributor','Upload and curate approved grounding content'],['Operator','Monitor runs and investigate failures'],['Administrator','Configure integrations and grant access']].map(([role,description])=><article key={role}><i>{role.charAt(0)}</i><span><strong>{role}</strong><small>{description}</small></span><b>Derived role</b></article>)}</div><div className="governance-toggle-grid single"><RequirementToggle title="Human approval for consequential actions" description="Tool calls that change business data require an explicit approval checkpoint." value={governance.humanApprovalForActions} change={()=>update('humanApprovalForActions',!governance.humanApprovalForActions)}/></div></section>
    <section className="governance-question-step"><header><b>4</b><span><h2>What evidence and encryption are required?</h2><p>Choose obligations only when required by policy or the approved data classification.</p></span></header><h3>Auditable events</h3><div className="governance-chip-list">{['Sign-ins','Model calls','Data access','Tool execution','Administrative changes','Deployments','Human approvals'].map(item=><button className={governance.auditEvents.includes(item)?'selected':''} onClick={()=>toggleList('auditEvents',item)} key={item}>{governance.auditEvents.includes(item)?'✓ ':''}{item}</button>)}</div><div className="governance-toggle-grid"><RequirementToggle title="Regulated records" description="Apply controlled-change and regulated evidence requirements." value={requirements.regulated} change={()=>setRequirement('regulated',!requirements.regulated)}/><RequirementToggle title="Immutable audit evidence" description="Prevent evidence from modification or early deletion." value={requirements.immutableAudit} change={()=>setRequirement('immutableAudit',!requirements.immutableAudit)}/><RequirementToggle title="Customer-managed keys" description="Use organization-controlled encryption keys where supported." value={requirements.customerKey} change={()=>setRequirement('customerKey',!requirements.customerKey)}/><RequirementToggle title="Export to corporate SIEM" description="Forward security and audit evidence to Microsoft Sentinel." value={governance.siemExport} change={()=>update('siemExport',!governance.siemExport)}/></div><div className="governance-field-grid"><label>Evidence retention<select value={requirements.retentionDays} onChange={event=>setRequirement('retentionDays',Number(event.target.value))}><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option><option value={2555}>7 years</option></select></label></div></section>
    <section className="governance-question-step governance-review"><header><b>5</b><span><h2>Review the derived governance plan</h2><p>Confirm controls, infrastructure, and accountable owners before model selection.</p></span></header><div className="governance-review-columns"><div><h3>Required controls</h3>{controls.map(control=><p key={control}><i>✓</i>{control}</p>)}</div><div><h3>Governance infrastructure</h3>{infrastructure.map(item=><p key={item.name}><i>+</i><span><strong>{item.name}</strong><small>{item.reason}</small></span></p>)}</div></div><div className="governance-owner-grid"><label>Business owner<input value={governance.businessOwner} onChange={event=>update('businessOwner',event.target.value)} placeholder="Name or group"/></label><label>Technical owner<input value={governance.technicalOwner} onChange={event=>update('technicalOwner',event.target.value)} placeholder="Name or group"/></label></div><div className="governance-review-note"><b>i</b><span><strong>Mandatory controls cannot be disabled here</strong><small>Policy conflicts become approval blockers or time-bound exception requests.</small></span></div></section>
    <footer className="governance-wizard-actions"><button className="solution-secondary" onClick={()=>step===1?back():setStep(value=>(value-1) as 1|2|3|4|5)}>← {step===1?'Architecture':'Back'}</button><span>Step {step} of 5</span>{step<5?<button className="solution-primary" onClick={()=>setStep(value=>(value+1) as 1|2|3|4|5)}>Continue →</button>:<button className="solution-primary" onClick={next}>Continue to model selection →</button>}</footer></section><aside className="solution-card governance-live-summary"><span>GOVERNANCE PLAN</span><h2>{controls.filter(control=>!control.startsWith('No ')).length} controls derived</h2><p>Updates as requirements are confirmed.</p><div><small>ACCESS</small><strong>{governance.roleModel==='uniform'?'Uniform access':governance.roleModel==='role-based'?'Role-based access':'Segregated duties'}</strong></div><div><small>APPROVALS</small><strong>{governance.accessApproval?'Owner approval required':'Direct assignment'}</strong></div><div><small>EVIDENCE</small><strong>{requirements.retentionDays} days · {governance.auditEvents.length} event types</strong></div><div><small>INFRASTRUCTURE</small><strong>{infrastructure.length} governance components</strong></div></aside></div></WorkspacePage>
}

function ProvisioningPage({resources=workingResources,model=foundryModels[0],capacity='10K TPM'}:{resources?:Resource[];model?:ModelOption;capacity?:string}){
  const [subscriptionId,setSubscriptionId]=useState(import.meta.env.VITE_AZURE_SUBSCRIPTION_ID??'')
  const [resourceGroupName,setResourceGroupName]=useState('rg-quality-rag-poc-eus2')
  const [status,setStatus]=useState<'idle'|'previewing'|'previewed'|'what-if'|'ready'|'deploying'|'complete'|'failed'>('idle')
  const [result,setResult]=useState('')
  const [confirmationToken,setConfirmationToken]=useState('')
  const keys=deploymentKeysFor(resources.map(resource=>resource.name))
  const modelVersions:Record<ModelId,string>={'gpt-5-mini':'2025-08-07','gpt-5':'2025-08-07',o3:'2025-04-16'}
  const manifest:DeploymentManifest={applicationId:'AI-2026-0118',subscriptionId,location:'eastus2',resourceGroupName,workloadName:'quality-rag-poc',resources:keys,chatModel:{name:model.id,version:modelVersions[model.id],sku:'GlobalStandard',capacity:Number.parseInt(capacity)},embeddingModel:keys.includes('embedding-model')?{name:'text-embedding-3-small',version:'1',sku:'GlobalStandard',capacity:10}:undefined,operationalRequirements:operationalRequirements(initialRequirements),tags:{applicationId:'AI-2026-0118',environment:'poc',expiresOn:'2026-09-30'}}
  const execute=async(action:'preview'|'what-if'|'deploy')=>{try{
    setStatus(action==='preview'?'previewing':action==='what-if'?'what-if':'deploying')
    if(action==='preview'){
      setConfirmationToken('')
      const response=await previewDeployment(manifest)
      setResult(JSON.stringify(response,null,2))
      setStatus('previewed')
    }else if(action==='what-if'){
      const response=await runDeploymentWhatIf(manifest)
      setConfirmationToken(response.confirmationToken)
      setResult(JSON.stringify(response,null,2))
      setStatus('ready')
    }else{
      if(!confirmationToken) throw new Error('Run Azure what-if before deployment.')
      const response=await startDeployment(manifest,confirmationToken)
      setConfirmationToken('')
      setResult(JSON.stringify(response,null,2))
      setStatus('complete')
    }
  }catch(error){setConfirmationToken('');setResult(error instanceof Error?error.message:'Deployment request failed');setStatus('failed')}}
  return <WorkspacePage kicker="PROVISIONING" title="Deploy the architecture you selected" description="The deployment manifest is built from the resources inferred during the guided flow. The backend deploys only approved resource keys through reviewed Bicep."><div className="provision-layout"><section className="solution-card provision-target"><div className="solution-card-head"><div><h2>Development POC target</h2><p>Deploy into a new, disposable resource group. No Azure credentials are sent to the browser.</p></div><span className="policy-pass">{keys.length} deployable resources</span></div><div className="provision-fields"><label>Azure subscription ID<input value={subscriptionId} onChange={event=>{setSubscriptionId(event.target.value);setStatus('idle')}} placeholder="00000000-0000-0000-0000-000000000000"/></label><label>Region<input value="East US 2" disabled/></label><label>Resource group<input value={resourceGroupName} onChange={event=>{setResourceGroupName(event.target.value);setStatus('idle')}}/></label><label>Environment<input value="Development POC" disabled/></label></div><div className="deployment-resource-list"><strong>Generated from this solution</strong>{keys.map(key=><span key={key}><i>✓</i>{key}</span>)}</div><div className="deployment-actions"><button className="solution-secondary" disabled={!subscriptionId||status==='previewing'} onClick={()=>execute('preview')}>1. Validate manifest</button><button className="solution-secondary" disabled={status!=='previewed'&&status!=='ready'} onClick={()=>execute('what-if')}>2. Run Azure what-if</button><button className="solution-primary" disabled={status!=='ready'} onClick={()=>execute('deploy')}>3. Deploy resources</button></div></section><aside className="solution-card deployment-result"><span>DEPLOYMENT STATUS</span><h3>{status.replace('-',' ')}</h3><p>{status==='idle'?'Enter the target subscription, then validate the generated manifest.':status==='previewing'?'Validating approved resource keys and Bicep parameters…':status==='what-if'?'Asking Azure Resource Manager to calculate changes…':status==='deploying'?'Azure deployment is running. This can take several minutes.':status==='complete'?'Deployment completed successfully.':status==='failed'?'The operation did not complete. Review the backend response below.':'The generated manifest is ready for the next step.'}</p>{result&&<pre>{result}</pre>}</aside></div></WorkspacePage>
}

function ActivityPage(){return <WorkspacePage kicker="ACTIVITY" title="Application history" description="A permanent timeline of configuration, governance, and deployment events."><section className="solution-card timeline">{[['Today · 10:42','Bicep package regenerated','Architecture changes produced generation 2 with 15 files.'],['Today · 09:18','GenAI Council decision recorded','Approved with conditions by council quorum.'],['Sep 8 · 16:05','Reusable asset requested','Veeva QualityDocs evidence request submitted.'],['Sep 7 · 11:32','Security review completed','Private networking and managed identity required.'],['Sep 5 · 14:20','Application approved','Initial intake review completed.']].map((item,index)=><article key={item[0]}><i className={index?'':'current'}/><span><small>{item[0]}</small><strong>{item[1]}</strong><p>{item[2]}</p></span></article>)}</section></WorkspacePage>}

function Overview({ begin }: { begin: () => void }) {
  return <>
    <section className="solution-hero">
      <div><span className="solution-status">✓ APPROVED</span><p>AI-2026-0118</p><h1>Quality Event Summarizer</h1><p className="hero-copy">Summarize quality event records and surface relevant patterns for review by quality specialists.</p></div>
      <button className="solution-primary" onClick={begin}>Configure solution <span>→</span></button>
    </section>
    <div className="solution-layout">
      <div className="solution-main">
        <section className="solution-card readiness">
          <div className="solution-card-head"><div><h2>Ready for solution design</h2><p>Your request has completed initial governance review.</p></div><span>4 of 4 complete</span></div>
          <div className="approval-grid">
            {['Business owner', 'AI Governance', 'MedTech Quality', 'Information Security'].map((team, i) => <div key={team}><i>✓</i><span><strong>{team}</strong><small>Approved · Sep {4 + i}, 2026</small></span></div>)}
          </div>
        </section>
        <section className="solution-card next-stage">
          <div className="section-kicker">NEXT STAGE</div><h2>Complete your solution profile</h2><p>Your approved business need and AI capabilities are already included. Now confirm the data, tools, memory, and operating details needed to generate an approved Azure architecture.</p>
          <div className="stage-cards">
            <article><b>01</b><span><strong>Confirm solution details</strong><small>Identify information, tools, memory, and operational needs.</small></span></article>
            <article><b>02</b><span><strong>Generate architecture</strong><small>See why each Azure service is included.</small></span></article>
            <article><b>03</b><span><strong>Complete configuration</strong><small>Add connections, environments, and access.</small></span></article>
          </div>
          <button className="solution-primary" onClick={begin}>Complete solution profile <span>→</span></button>
        </section>
      </div>
      <aside className="solution-side">
        <section className="solution-card"><h3>Approved guardrails</h3><div className="guardrail"><span>Risk classification</span><b className="high-risk">High</b></div><div className="guardrail"><span>Audience</span><b>J&J employees</b></div><div className="guardrail"><span>Human review</span><b>Required</b></div><div className="guardrail"><span>Data boundary</span><b>J&J controlled</b></div><div className="guardrail"><span>Deployment region</span><b>United States</b></div></section>
        <section className="solution-card help"><span>?</span><div><h3>Need architecture help?</h3><p>An AI platform architect can collaborate on this configuration.</p><button>Request consultation</button></div></section>
      </aside>
    </div>
  </>
}

function DesignStart({describe,guided}:{describe:()=>void;guided:()=>void}){return <WorkspacePage kicker="COMPLETE SOLUTION PROFILE" title="How would you like to fill in the remaining details?" description="The approved intake already defines the business need, audience, risk controls, and AI capabilities. Choose how to complete the technical requirements."><div className="approved-baseline solution-card"><span><b>✓ APPROVED BASELINE</b><strong>Search & answer · Summarize · Assistive autonomy · Human review required</strong><small>Carried forward from application AI-2026-0118</small></span></div><div className="design-methods"><button onClick={describe}><i>✦</i><span><b>FASTEST PATH</b><h2>Add details in plain language</h2><p>Describe the information sources, connected systems, memory, freshness, and operating needs not captured during intake.</p><strong>Add and analyze details →</strong></span></button><button onClick={guided}><i>☷</i><span><b>GUIDED PATH</b><h2>Configure step by step</h2><p>Confirm data and knowledge, tools and agents, memory, and operational requirements with full control.</p><strong>Start with data & knowledge →</strong></span></button></div><section className="solution-card shared-model-note"><b>i</b><span><strong>No need to redefine the application</strong><small>Both paths build on the approved intake. Any new scope is highlighted for governance review rather than silently changing the approval.</small></span></section></WorkspacePage>}

function DescribeApplication({apply,back}:{apply:(caps:Capability[],data:DataConfiguration,memory:string[],requirements:Partial<Requirements>)=>void;back:()=>void}){
  const [description,setDescription]=useState('')
  const [analyzed,setAnalyzed]=useState(false)
  const text = description.toLowerCase()
    const caps:Capability[]=[...(text.match(/chat|conversation|assistant|copilot/)?['chat' as Capability]:[]),...(text.match(/search|answer|knowledge|document|citation/)?['grounding' as Capability]:[]),...(text.match(/summar|draft|generate|write|classif/)?['content' as Capability]:[]),...(text.match(/agent|coordinate|multi-step/)?['agents' as Capability]:[]),...(text.match(/create|update|action|ticket|workflow/)?['actions' as Capability]:[]),...(text.match(/pdf|document|form|extract/)?['documents' as Capability]:[]),...(text.match(/upload|submit file/)?['uploads' as Capability]:[])]
  const types=[...(text.match(/document|pdf|policy|sharepoint|knowledge/)?['documents']:[]),...(text.match(/metric|trend|analytics|table|lakehouse|fabric/)?['analytics']:[]),...(text.match(/sap|servicenow|crm|live record|current record/)?['operational']:[]),...(text.match(/upload|submit file/)?['uploads']:[])]
  const memory=[...(text.match(/remember|conversation context|preference/)?['Session memory']:[]),...(text.match(/resume|checkpoint|long-running workflow/)?['Workflow checkpoints']:[])]
  const useExample=()=>setDescription('Create a conversational assistant that searches approved quality documents with citations, summarizes uploaded PDFs, analyzes quality metrics and trends, remembers conversation context, and requires human review before results are used.')
  return <WorkspacePage kicker="ADD SOLUTION DETAILS" title="What else should architecture know?" description="The approved business need and capabilities are already included. Focus on information sources, systems, memory, freshness, connectivity, and operational constraints."><div className="describe-layout"><section className="solution-card describe-card"><label>Additional solution details<textarea value={description} onChange={event=>{setDescription(event.target.value);setAnalyzed(false)}} placeholder="For example: Use approved quality documents and uploaded PDFs, analyze quality metrics, connect to Veeva, remember conversation context, and use private network access..."/></label><div className="prompt-help"><span>Include:</span><b>Information sources</b><b>Connected systems</b><b>Freshness</b><b>Memory</b><b>Network or scale</b></div><div className="describe-actions"><button className="solution-secondary" onClick={back}>← Choose another path</button><button className="example-link" onClick={useExample}>Use an example</button><button className="solution-primary" disabled={!description.trim()} onClick={()=>setAnalyzed(true)}>✦ Analyze details</button></div></section>{analyzed&&<section className="solution-card analysis-result"><div><span>INFERRED SOLUTION PROFILE</span><h2>Review what the platform understood</h2><p>Approved capabilities remain unchanged unless new scope is explicitly detected.</p></div><section><h3>Approved and detected capabilities</h3><div>{[...new Set([...approvedCapabilities,...caps])].map(cap=><span key={cap}>✓ {capabilityOptions.find(option=>option.id===cap)?.title}</span>)}</div></section><section><h3>Information needed</h3><div>{types.length?types.map(type=><span key={type}>✓ {{documents:'Document knowledge',analytics:'Analytical data',operational:'Live operational records',uploads:'User-uploaded files'}[type]}</span>):<em>No new data requirements identified</em>}</div></section><section><h3>Memory & operation</h3><div>{memory.map(item=><span key={item}>✓ {item}</span>)}{text.match(/human review|approval/)&&<span>✓ Human review required</span>}{!memory.length&&!text.match(/human review|approval/)&&<em>No additional memory or operating requirements identified</em>}</div></section><aside><b>!</b><span><strong>Assumptions to confirm</strong><small>Data classification, source permissions, freshness, environments, and network access still need confirmation.</small></span></aside><button className="solution-primary" onClick={()=>apply([...new Set([...approvedCapabilities,...caps])],{types:[...new Set(types)],uses:types.includes('analytics')?['metrics','trends']:['search','citations'],freshness:'Daily',controls:['permissions','citations']},memory,{privateNetwork:text.includes('private'),regulated:text.match(/quality|clinical|regulated/)!==null})}>Apply details and review data →</button></section>}</div></WorkspacePage>
}

function RequirementToggle({ title, description, value, change }: { title:string; description:string; value:boolean; change:()=>void }) { if(title==='Private network isolation')return <div className="requirement-toggle selected standard-requirement"><span><strong>Private network within the J&J network</strong><small>J&J standard: Azure services use private endpoints and approved corporate network paths.</small></span><i>Standard</i></div>;return <button className={`requirement-toggle ${value?'selected':''}`} onClick={change}><span><strong>{title}</strong><small>{description}</small></span><i>{value?'Yes':'No'}</i></button> }

function ConnectorCatalog({ selected, requested, capabilities, data, toggle, back, next:_next, requirements }: { selected:string[]; requested:string[]; capabilities:Capability[]; data:DataConfiguration; toggle:(asset:CatalogAsset)=>void; back:()=>void; next:()=>void; requirements:Requirements }) {
  void _next
  const next=()=>navigateWorkspace?.('channels')
  const [search,setSearch]=useState(''),[status,setStatus]=useState<'All'|CatalogAsset['status']>('All'),[source,setSource]=useState<'All'|CatalogAsset['source']>('All')
  const selectedConnectors=[...new Set(catalogAssets.filter(asset=>selected.includes(asset.id)).map(asset=>asset.connector))]
  const resources=resourcesFor(capabilities,requirements,selectedConnectors,data)
  const visible=catalogAssets.filter(asset=>(!search||`${asset.name} ${asset.domain} ${asset.owner} ${asset.description}`.toLowerCase().includes(search.toLowerCase()))&&(status==='All'||asset.status===status)&&(source==='All'||asset.source===source))
  const groups:CatalogAsset['kind'][]=['Connector','MCP server','A2A agent']
  const action=(asset:CatalogAsset)=>requested.includes(asset.id)?'✓ Request submitted':asset.status==='Approved'?'Reuse':asset.status==='Restricted'?'Request with evidence':asset.status==='Pending'?'View request':'Request onboarding'
  return <div className="catalog-layout"><section className="solution-card catalog-panel"><div className="blueprint-heading"><p>STEP 2 OF 4 · REUSABLE ASSETS</p><h1>Find the tools your application needs</h1><span>Reuse approved assets wherever possible. Selecting one adds its access and infrastructure requirements to your blueprint.</span></div><div className="catalog-controls"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search connectors, MCP servers, agents, or owners..."/><div className="filter-row"><span>Status</span>{(['All','Approved','Restricted','Pending','Not onboarded'] as const).map(x=><button className={status===x?'active':''} onClick={()=>setStatus(x)} key={x}>{x}</button>)}</div><div className="filter-row"><span>Source</span>{(['All','Enterprise','MedTech'] as const).map(x=><button className={source===x?'active':''} onClick={()=>setSource(x)} key={x}>{x==='All'?'All catalogues':`${x} catalogue`}</button>)}</div></div>{groups.map(group=>{const assets=visible.filter(asset=>asset.kind===group);return assets.length>0&&<section className="asset-section" key={group}><div className="asset-section-title"><div><b>{group==='Connector'?'◉':group==='MCP server'?'◇':'✦'}</b><h3>{group==='Connector'?'Connectors':group==='MCP server'?'MCP servers':'A2A agents'}</h3><span>{group==='Connector'?'Existing enterprise and MedTech integrations':group==='MCP server'?'Reusable Model Context Protocol tool servers':'Specialized agents for agent-to-agent workflows'}</span></div><em>{assets.length} available</em></div><div className="asset-grid">{assets.map(asset=><article className={selected.includes(asset.id)?'selected':''} key={asset.id}><div className="asset-top"><i>{asset.name.charAt(0).toUpperCase()}</i><span><strong>{asset.name}</strong><small>{asset.domain} · Owner: {asset.owner}</small></span><b className={`asset-status ${asset.status.toLowerCase().replace(' ','-')}`}>● {asset.status}</b></div><p>{asset.description}</p><div className="asset-meta">{asset.source==='MedTech'&&<em>MT</em>}{asset.version&&<span>{asset.version}</span>}<span>{asset.detail}</span></div><button disabled={asset.status==='Pending'} onClick={()=>toggle(asset)}>{selected.includes(asset.id)?'✓ Added':action(asset)}</button></article>)}</div></section>})}<div className="inference-note"><b>✦</b><span><strong>Every selection updates the architecture</strong><small>Authentication, private connectivity, API governance, controlled egress, and hosting are inferred from the assets you reuse.</small></span></div><div className="blueprint-actions"><button className="solution-secondary" onClick={back}>← Capabilities</button><span>{selected.length} assets selected · {resources.length} components</span><button className="solution-primary" onClick={next}>Architecture needs →</button></div></section><Recommendation resources={resources}/></div>
}

function AssetRequestModal({asset,close,submit}:{asset:CatalogAsset;close:()=>void;submit:()=>void}) {
  const [justification,setJustification]=useState('')
  return <div className="request-backdrop" role="presentation" onMouseDown={close}><section className="request-modal" role="dialog" aria-modal="true" aria-labelledby="request-title" onMouseDown={event=>event.stopPropagation()}><button className="modal-close" onClick={close}>×</button><span className="modal-kicker">GOVERNED ASSET REQUEST</span><h2 id="request-title">{asset.name}</h2><p>{asset.status==='Restricted'?'Provide the intended use and evidence need. The owning team will review access before provisioning.':'Request platform onboarding so this asset can be assessed, secured, and published for reuse.'}</p><div className="request-details"><span><small>Owner</small><strong>{asset.owner}</strong></span><span><small>Current status</small><strong>{asset.status}</strong></span></div><label>Business justification<textarea value={justification} onChange={event=>setJustification(event.target.value)} placeholder="Describe why this application needs the asset and how it will be used..."/></label><label>Data classification<select defaultValue="Confidential"><option>Internal</option><option>Confidential</option><option>Highly confidential / regulated</option></select></label><div className="modal-actions"><button className="solution-secondary" onClick={close}>Cancel</button><button className="solution-primary" disabled={!justification.trim()} onClick={submit}>Submit request →</button></div></section></div>
}

function Recommendation({resources}:{resources:Resource[]}) { return <aside className="recommendation-preview solution-card"><div className="preview-head"><span>✦</span><div><small>WORKING ARCHITECTURE</small><h2>Azure components</h2></div></div><div className="preview-summary"><span>{resources.length}</span><div><strong>Components identified</strong><small>Builds as answers are confirmed</small></div></div><div className="mini-resources">{resources.map(resource=><div className={resource.required?'required-resource':''} key={resource.name}><i>{resource.icon}</i><span><strong>{resource.name}{resource.required&&<em>Required</em>}</strong><small>{resource.reason}</small></span></div>)}</div><div className="constraint"><b>🛡</b><span><strong>J&J standards applied</strong><small>Private networking, managed identity, audit logging, and approved data boundaries.</small></span></div></aside> }

function InfrastructureChanges({plan}:{plan:ArchitecturePlan}) {
  const changes=plan.infrastructureChanges
  return <section className="infrastructure-impact"><header><span><small>TARGET ARCHITECTURE IMPACT</small><h2>How your infrastructure will change</h2><p>{changes.summary}</p></span></header><div className="infrastructure-impact-group"><h3>Additional infrastructure</h3>{changes.additionalInfrastructure.length?<div className="infrastructure-additions">{changes.additionalInfrastructure.map(item=><article key={item.resource}><i>+</i><span><strong>{item.label}</strong><small>{item.reason}</small></span><b className={item.implementationStatus}>{item.implementationStatus==='blocked'?'Not yet deployable':'New'}</b></article>)}</div>:<div className="no-additional-infrastructure"><i>✓</i><span><strong>No additional Azure services required</strong><small>The selected profile is achieved by changing the configuration of existing components.</small></span></div>}</div><div className="infrastructure-impact-group"><h3>Existing component changes</h3><div className="infrastructure-change-list">{changes.existingInfrastructure.map(change=><article key={change.resource}><span><strong>{change.label}</strong><b className={change.status}>{change.status}</b></span><div><small>CURRENT</small><p>{change.current}</p></div><i>→</i><div><small>TARGET</small><p>{change.target}</p></div></article>)}</div></div></section>
}

function ArchitectureOutcomeDetails({plan,planError}:{plan?:ArchitecturePlan;planError:string}) {
  if(!plan&&!planError)return <div className="outcome-page-loading"><i/><strong>Deriving architecture recommendation…</strong></div>
  if(planError)return <div className="summary-blockers"><h3>Recommendation unavailable</h3><p>{planError}</p></div>
  if(!plan)return null
  return <><div className={`outcome-profile ${plan.deployable?'ready':'attention'}`}><i>{plan.deployable?'✓':'!'}</i><span><small>RECOMMENDED PROFILE</small><h2>{plan.label}</h2><p>{plan.deployable?'This profile can be generated with the current templates.':'Additional architecture work is required before deployment.'}</p></span><div><span><small>RESTORE SERVICE</small><strong>{plan.targets.rtoMinutes===1440?'Next day':`${plan.targets.rtoMinutes} min`}</strong></span><span><small>DATA LOSS</small><strong>{plan.targets.rpoMinutes===0?'Near zero':`${plan.targets.rpoMinutes} min`}</strong></span></div></div>{plan.blockers.length>0&&<section className="outcome-blockers"><h3>Before this architecture can be deployed</h3>{plan.blockers.map(blocker=><p key={blocker}>{blocker}</p>)}</section>}<InfrastructureChanges plan={plan}/></>
}

function ArchitectureNeeds({requirements,setRequirement,capabilities,connectors,data,memory,back,next}:{requirements:Requirements;setRequirement:<K extends keyof Requirements>(key:K,value:Requirements[K])=>void;capabilities:Capability[];connectors:Connector[];data:DataConfiguration;memory:string[];back:()=>void;next:()=>void}) {
  const resources=resourcesFor(capabilities,requirements,connectors,data,memory)
  const [plan,setPlan]=useState<ArchitecturePlan>()
  const [planError,setPlanError]=useState('')
  const [step,setStep]=useState<1|2|3|4>(1)
  useEffect(()=>{let active=true;const timer=window.setTimeout(()=>{setPlanError('');void planArchitecture({resources:deploymentKeysFor(resources.map(resource=>resource.name)),primaryRegion:azureRegionCode(requirements.region)||undefined,operationalRequirements:operationalRequirements(requirements)}).then(result=>{if(active)setPlan(result)}).catch(error=>{if(active)setPlanError(error instanceof Error?error.message:'Architecture planning failed')})},200);return()=>{active=false;window.clearTimeout(timer)}},[requirements,resources.map(resource=>resource.name).join(',')])
  return <div className={`operational-layout operational-layout-step-${step}`}>
    <section className={`solution-card capability-panel operational-form wizard-step-${step}`}>
      <nav className="operational-stepper" aria-label="Operational requirements progress">
        {(['Environment','Criticality','Review','Outcome'] as const).map((label,index)=>{const number=(index+1) as 1|2|3|4;return <button type="button" className={step===number?'current':step>number?'complete':''} onClick={()=>setStep(number)} aria-current={step===number?'step':undefined} key={label}><i>{step>number?'✓':number}</i><span>{label}</span></button>})}
      </nav>
      <div className="blueprint-heading"><p>STEP 3 OF 4 · OPERATIONAL REQUIREMENTS</p><h1>Set the operating expectations</h1><span>Answer business questions in order. Azure components update automatically on the right.</span></div>
      {step<3&&<div className={`compact-architecture-outcome ${plan?.deployable?'ready':'attention'}`} aria-live="polite"><i>{!plan?'…':plan.deployable?'✓':'!'}</i><span><small>RECOMMENDED PROFILE</small><strong>{plan?.label??'Deriving recommendation…'}</strong></span>{plan&&<div><span><small>RESTORE</small><b>{plan.targets.rtoMinutes===1440?'Next day':`${plan.targets.rtoMinutes} min`}</b></span><span><small>DATA LOSS</small><b>{plan.targets.rpoMinutes===0?'Near zero':`${plan.targets.rpoMinutes} min`}</b></span></div>}<em>{plan&&!plan.deployable?'Action required':'Full details after Review'}</em></div>}
      <section className="operational-section"><header><b>1</b><span><h2>Where and how will it run?</h2><p>Confirm access constraints already inferred from your selected data and tools.</p></span></header><div className="requirement-grid"><RequirementToggle title="Private J&J network" description="Use private endpoints and approved corporate paths." value={requirements.privateNetwork} change={()=>setRequirement('privateNetwork',!requirements.privateNetwork)}/><RequirementToggle title="External user access" description="Patients, partners, HCPs, or public users need access." value={requirements.externalUsers} change={()=>setRequirement('externalUsers',!requirements.externalUsers)}/><RequirementToggle title="On-premises connectivity" description="Connect to systems inside J&J corporate networks." value={requirements.onPremises} change={()=>setRequirement('onPremises',!requirements.onPremises)}/><RequirementToggle title="Asynchronous workflows" description="Queues, background jobs, or long-running actions." value={requirements.asyncWork} change={()=>setRequirement('asyncWork',!requirements.asyncWork)}/></div></section>
      <section className="operational-section"><header><b>2</b><span><h2>How critical is the service?</h2><p>These answers determine availability, backup, and regional recovery—not individual Azure products.</p></span></header><div className="requirement-fields"><label>Lifecycle<select value={requirements.environments} onChange={e=>setRequirement('environments',e.target.value as Requirements['environments'])}><option value="dev">Development only</option><option value="dev-test">Development + test</option><option value="dev-test-prod">Development + test + production</option></select></label><label>Expected usage<select value={requirements.scale} onChange={e=>setRequirement('scale',e.target.value as Requirements['scale'])}><option value="small">Small · under 100 users</option><option value="medium">Medium · 100–5,000 users</option><option value="large">Large · over 5,000 users</option></select></label><label>Service hours<select value={requirements.serviceHours} onChange={e=>setRequirement('serviceHours',e.target.value as Requirements['serviceHours'])}><option value="business-hours">Business hours</option><option value="extended-hours">Extended hours</option><option value="24x7">24 × 7</option></select></label><label>Impact of an outage<select value={requirements.businessImpact} onChange={e=>setRequirement('businessImpact',e.target.value as Requirements['businessImpact'])}><option value="low">Minor inconvenience</option><option value="material">Business process stops</option><option value="critical">Regulated or safety-critical impact</option></select></label><label>Service must return<select value={requirements.rtoMinutes} onChange={e=>setRequirement('rtoMinutes',Number(e.target.value) as Requirements['rtoMinutes'])}><option value={1440}>By the next business day</option><option value={240}>Within 4 hours</option><option value={60}>Within 1 hour</option><option value={15}>Within 15 minutes</option></select><small>Recovery time objective (RTO)</small></label><label>Acceptable data loss<select value={requirements.rpoMinutes} onChange={e=>setRequirement('rpoMinutes',Number(e.target.value) as Requirements['rpoMinutes'])}><option value={1440}>Up to 24 hours</option><option value={60}>Up to 1 hour</option><option value={15}>Up to 15 minutes</option><option value={0}>Near zero</option></select><small>Recovery point objective (RPO)</small></label></div>{(requirements.businessImpact==='critical'||requirements.rtoMinutes<=60)&&<div className="recovery-followup"><b>Recovery region required</b><label>Preferred standby region<select value={requirements.secondaryRegion} onChange={e=>setRequirement('secondaryRegion',e.target.value)}><option value="">Choose a region</option><option value="centralus">Central US</option><option value="eastus2">East US 2</option><option value="westus3">West US 3</option></select></label><small>Final compatibility and model quota are validated after the primary region is selected.</small></div>}</section>
      <div className="blueprint-actions"><button className="solution-secondary" onClick={back}>← Data &amp; tools</button><span>{plan?.deployable?'Requirements complete':plan?'Review the recommendation':'Updating recommendation…'}</span><button className="solution-primary" disabled={!plan?.deployable} onClick={next}>Continue to access &amp; governance →</button></div>
      <section className="operational-section operational-review"><header><b>3</b><span><h2>Review your operating expectations</h2><p>Confirm these choices before continuing.</p></span></header><div className="operational-review-grid"><article><span><strong>Environment &amp; connectivity</strong><button onClick={()=>setStep(1)}>Edit</button></span><p>{requirements.privateNetwork?'Private J&J network':'Public network'} · {requirements.externalUsers?'External access':'Internal users'} · {requirements.onPremises?'On-premises connected':'Cloud only'} · {requirements.asyncWork?'Async workflows':'Synchronous workflows'}</p></article><article><span><strong>Service criticality</strong><button onClick={()=>setStep(2)}>Edit</button></span><p>{{dev:'Development only','dev-test':'Development + test','dev-test-prod':'Development + test + production'}[requirements.environments]} · {requirements.scale} scale · {requirements.serviceHours.replace(/-/g,' ')} · RTO {requirements.rtoMinutes===1440?'next business day':`${requirements.rtoMinutes} min`} · RPO {requirements.rpoMinutes===0?'near zero':`${requirements.rpoMinutes} min`}</p></article></div></section>
      <section className="operational-section architecture-outcome-page"><ArchitectureOutcomeDetails plan={plan} planError={planError}/></section><div className="operational-wizard-actions"><button className="solution-secondary" onClick={()=>step===1?back():setStep(previous=>(previous-1) as 1|2|3|4)}>← {step===1?'Data & tools':'Back'}</button><span>Step {step} of 4</span>{step<3?<button className="solution-primary" onClick={()=>setStep(current=>(current+1) as 1|2|3|4)}>Continue →</button>:step===3?<button className="solution-primary" onClick={()=>setStep(4)}>See recommended architecture →</button>:<button className="solution-primary" disabled={!plan?.deployable} onClick={next}>Continue to access &amp; governance →</button>}</div>
    </section>
    <div className="operational-right-rail">
      <Recommendation resources={resources}/>
    <aside className="solution-card operational-summary" aria-live="polite"><span className="summary-kicker">ARCHITECTURE OUTCOME</span>{!plan&&!planError&&<div className="summary-loading"><i/><strong>Deriving recommendation…</strong></div>}{plan&&<><header className={plan.deployable?'ready':'attention'}><i>{plan.deployable?'✓':'!'}</i><span><small>RECOMMENDED PROFILE</small><h2>{plan.label}</h2><p>{plan.deployable?'This profile can be generated with the current templates.':'Additional architecture work is required before deployment.'}</p></span></header><div className="recovery-targets"><span><small>RESTORE SERVICE</small><strong>{plan.targets.rtoMinutes===1440?'Next day':`${plan.targets.rtoMinutes} min`}</strong></span><span><small>DATA LOSS</small><strong>{plan.targets.rpoMinutes===0?'Near zero':`${plan.targets.rpoMinutes} min`}</strong></span></div><section><h3>What this changes</h3>{plan.resources.map(resource=><div className="summary-decision" key={resource.type}><i>✓</i><span><strong>{resource.type.replaceAll('-',' ')}</strong><small>{resource.reason}</small></span></div>)}</section>{plan.controls.length>0&&<section><h3>Required controls</h3>{plan.controls.map(control=><div className="summary-decision" key={control.id}><i>◇</i><span><strong>{control.label}</strong></span></div>)}</section>}{plan.blockers.length>0&&<section className="summary-blockers"><h3>Before you can continue</h3>{plan.blockers.map(blocker=><p key={blocker}>{blocker}</p>)}</section>}</>}{planError&&<section className="summary-blockers"><h3>Recommendation unavailable</h3><p>{planError}</p></section>}</aside>
    </div>
  </div>
}

export function BicepTemplateCatalog({resources,selected,toggle,model,capacity}:{resources:Resource[];selected:string[];toggle:(id:string)=>void;model:ModelOption;capacity:string}) {
  const [generation,setGeneration]=useState(1)
  const [showCode,setShowCode]=useState(false)
  const moduleGroups=[...new Set(resources.map(resource=>resource.type.toLowerCase().replace(/[^a-z0-9]+/g,'-')))]
  const generatedFiles=['main.bicep','resources.bicep','main.bicepparam','modules/model-deployment.bicep','deployment-manifest.json',...moduleGroups.filter(group=>group!=='model-deployment').map(group=>`modules/${group}.bicep`)]
  const modelCodePreview=`targetScope = 'subscription'

param location string = 'eastus2'
param resourceGroupName string
param modelName string = '${model.id}'
param modelDeploymentName string = '${model.id}-quality-event-summarizer'
param modelCapacity int = ${Number.parseInt(capacity)}

// resources.bicep composes modules/model-deployment.bicep
// SKU: GlobalStandard
// version and regional capacity are resolved and validated before provisioning

// Generated composition covers ${resources.length} Azure components.`
  return <section className="solution-card bicep-catalog generated-bicep"><div className="solution-card-head"><div><span className="bicep-kicker">GENERATED INFRASTRUCTURE AS CODE</span><h2>Bicep package generated from this blueprint</h2><p>The platform creates a fresh, policy-aligned deployment package whenever capabilities, tools, model selection, or operational requirements change.</p></div><div className="coverage-score"><strong>100%</strong><span>resource coverage</span></div></div><div className="model-package-summary"><i>✦</i><span><small>FOUNDRY MODEL DEPLOYMENT</small><strong>{model.name}</strong><em>{model.id} · Global Standard · {capacity}</em></span><b>Included</b></div><div className="generation-summary"><div><i>✦</i><span><strong>Generation {generation} is ready</strong><small>{resources.length} resources · {generatedFiles.length} files · {moduleGroups.length} generated modules</small></span></div><div><span className="validation-pill">✓ Syntax ready</span><span className="validation-pill">✓ Policy mapped</span></div></div><div className="bicep-pattern"><b>Generated structure</b><span><code>main.bicep</code> creates the resource group</span><span><code>resources.bicep</code> orchestrates generated modules</span><span><code>main.bicepparam</code> contains environment values</span></div><div className="generated-file-grid">{generatedFiles.map((file,index)=><article key={file}><i>{index<3?'B':file.endsWith('.json')?'{}':'M'}</i><span><strong>{file}</strong><small>{index===0?'Subscription scope and resource group':index===1?'Resource-group deployment composition':index===2?'Live environment parameters':file==='modules/model-deployment.bicep'?'Foundry model deployment, SKU, capacity, and safety policy':file.endsWith('.json')?'Resolved deployment metadata and validation status':'Generated resource module'}</small></span><b>Generated</b></article>)}</div><div className="generated-actions"><div><strong>Generated specifically for this architecture</strong><small>Model version, regional availability, and quota remain preflight checks before deployment.</small></div><button className="solution-secondary" onClick={()=>setShowCode(current=>!current)}>{showCode?'Hide code':'Preview generated code'}</button><button className="solution-primary" onClick={()=>setGeneration(current=>current+1)}>↻ Regenerate package</button></div>{showCode&&<pre className="code-preview"><code>{modelCodePreview}</code></pre>}</section>

  /* Legacy template composition retained below for reference. */
  const codePreview=`targetScope = 'subscription'

@description('Deployment region')
param location string = '${resources.some(resource=>resource.name==='Microsoft Foundry')?'eastus2':'eastus'}'
param resourceGroupName string
param modelName string = '${model.id}'
param modelDeploymentName string = '${model.id}-quality-event-summarizer'
param modelCapacity int = ${Number.parseInt(capacity)}

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
}
module solution './resources.bicep' = {

  // resources.bicep composes modules/model-deployment.bicep with:
  // model: ${model.id}
  // SKU: GlobalStandard
  // planned capacity: ${capacity}
  // version: resolved, validated, and pinned before provisioning
    if(resources.length>=0)return <section className="solution-card bicep-catalog generated-bicep"><div className="solution-card-head"><div><span className="bicep-kicker">GENERATED INFRASTRUCTURE AS CODE</span><h2>Bicep package generated from this blueprint</h2><p>The platform creates a fresh, policy-aligned deployment package whenever capabilities, tools, model selection, or operational requirements change.</p></div><div className="coverage-score"><strong>100%</strong><span>resource coverage</span></div></div><div className="model-package-summary"><i>✦</i><span><small>FOUNDRY MODEL DEPLOYMENT</small><strong>{model.name}</strong><em>{model.id} · Global Standard · {capacity}</em></span><b>Included</b></div><div className="generation-summary"><div><i>✦</i><span><strong>Generation {generation} is ready</strong><small>{resources.length} resources · {generatedFiles.length} files · {moduleGroups.length+1} generated modules</small></span></div><div><span className="validation-pill">✓ Syntax ready</span><span className="validation-pill">✓ Policy mapped</span></div></div><div className="bicep-pattern"><b>Generated structure</b><span><code>main.bicep</code> creates the resource group</span><span><code>resources.bicep</code> orchestrates generated modules</span><span><code>main.bicepparam</code> contains environment values</span></div><div className="generated-file-grid">{generatedFiles.map((file,index)=><article key={file}><i>{index<3?'B':file.endsWith('.json')?'{}':'M'}</i><span><strong>{file}</strong><small>{index===0?'Subscription scope and resource group':index===1?'Resource-group deployment composition':index===2?'Live environment parameters':file==='modules/model-deployment.bicep'?'Foundry model deployment, SKU, capacity, and safety policy':file.endsWith('.json')?'Resolved deployment metadata and validation status':'Generated resource module'}</small></span><b>Generated</b></article>)}</div><div className="generated-actions"><div><strong>Generated specifically for this architecture</strong><small>Model version, regional availability, and quota remain preflight checks before deployment.</small></div><button className="solution-secondary" onClick={()=>setShowCode(current=>!current)}>{showCode?'Hide code':'Preview generated code'}</button><button className="solution-primary" onClick={()=>setGeneration(current=>current+1)}>↻ Regenerate package</button></div>{showCode&&<pre className="code-preview"><code>{codePreview}</code></pre>}</section>
  name: 'deploy-ai-solution'
  scope: rg
  params: {
    location: location
    workloadName: 'quality-event-summarizer'
  }
}

// Generated composition covers ${resources.length} recommended components:
${resources.map(resource=>`// - ${resource.name}: ${resource.reason}`).join('\n')}`
  if(resources.length>=0)return <section className="solution-card bicep-catalog generated-bicep"><div className="solution-card-head"><div><span className="bicep-kicker">GENERATED INFRASTRUCTURE AS CODE</span><h2>Bicep package generated from this blueprint</h2><p>The platform creates a fresh, policy-aligned deployment package whenever capabilities, tools, or operational requirements change.</p></div><div className="coverage-score"><strong>100%</strong><span>resource coverage</span></div></div><div className="generation-summary"><div><i>✦</i><span><strong>Generation {generation} is ready</strong><small>{resources.length} resources · {generatedFiles.length} files · {moduleGroups.length} generated modules</small></span></div><div><span className="validation-pill">✓ Syntax ready</span><span className="validation-pill">✓ Policy mapped</span></div></div><div className="bicep-pattern"><b>Generated structure</b><span><code>main.bicep</code> creates the resource group</span><span><code>resources.bicep</code> orchestrates generated modules</span><span><code>main.bicepparam</code> contains environment values</span></div><div className="generated-file-grid">{generatedFiles.map((file,index)=><article key={file}><i>{index<3?'B':'M'}</i><span><strong>{file}</strong><small>{index===0?'Subscription scope and resource group':index===1?'Resource-group deployment composition':index===2?'Live environment parameters':'Generated resource module'}</small></span><b>Generated</b></article>)}</div><div className="generated-actions"><div><strong>Generated specifically for this architecture</strong><small>No prebuilt template selection is required. Updating the blueprint regenerates only the files and modules needed.</small></div><button className="solution-secondary" onClick={()=>setShowCode(current=>!current)}>{showCode?'Hide code':'Preview generated code'}</button><button className="solution-primary" onClick={()=>setGeneration(current=>current+1)}>↻ Regenerate package</button></div>{showCode&&<div className="code-preview"><div><span>main.bicep</span><b>Generated preview</b></div><pre>{codePreview}</pre></div>}</section>
  const resourceNames=resources.map(resource=>resource.name)
  const covered=[...new Set(bicepTemplates.filter(template=>selected.includes(template.id)).flatMap(template=>template.covers))]
  const matched=resourceNames.filter(name=>covered.includes(name)).length
  const coverage=Math.round((matched/resourceNames.length)*100)
  const uncovered=resourceNames.filter(name=>!covered.includes(name))
  return <section className="solution-card bicep-catalog"><div className="solution-card-head"><div><span className="bicep-kicker">INFRASTRUCTURE AS CODE</span><h2>Compose from approved Bicep templates</h2><p>Reuse governed modules first. The platform will compose selected templates into a subscription-scoped deployment package.</p></div><div className="coverage-score"><strong>{coverage}%</strong><span>resource coverage</span></div></div><div className="bicep-pattern"><b>Recommended structure</b><span><code>main.bicep</code> creates the resource group</span><span><code>resources.bicep</code> contains deployable resources</span><span><code>main.bicepparam</code> holds environment values</span></div><div className="template-grid">{bicepTemplates.map(template=>{const matches=template.covers.filter(name=>resourceNames.includes(name));const isSelected=selected.includes(template.id);return <article className={isSelected?'selected':''} key={template.id}><div className="template-top"><i>⌘</i><span><strong>{template.name}</strong><small>{template.owner} · {template.version}</small></span><b>✓ APPROVED</b></div><p>{template.description}</p><div className="template-match"><strong>{matches.length} recommended components covered</strong><span>{matches.length?matches.join(' · '):'Available for future requirements'}</span></div><div className="template-files">{template.files.map(file=><code key={file}>{file}</code>)}</div><button onClick={()=>toggle(template.id)}>{isSelected?'✓ Included in composition':'Reuse template'}</button></article>})}</div><div className={`coverage-note ${uncovered.length?'attention':''}`}><b>{uncovered.length?'!':'✓'}</b><span><strong>{uncovered.length?`${uncovered.length} component${uncovered.length===1?'':'s'} need generated modules`:'All recommended components are covered'}</strong><small>{uncovered.length?`${uncovered.join(', ')} will be added as policy-aligned custom modules.`:'The selected templates can be composed without custom resource modules.'}</small></span></div></section>
}

function Architecture({ resources,requirements,addedResources,removeResource,addResource,back,next }: {resources:Resource[];requirements:Requirements;addedResources:string[];removeResource:(name:string,reason:string)=>void;addResource:(name:string)=>void;back:()=>void;next:()=>void }) {
  const [serviceToAdd,setServiceToAdd]=useState('')
  const [pendingRemoval,setPendingRemoval]=useState<string|null>(null)
  const [removalReason,setRemovalReason]=useState('')
  const available=optionalResources.filter(resource=>!resources.some(item=>item.name===resource.name))
  const estimate = 620 + resources.length * 115
  return <>
    <div className="architecture-heading"><div><p>STEP 4 OF 4 · RECOMMENDATION</p><h1>Recommended Azure architecture</h1><span>Generated from capabilities, connectors, operational needs, and approved guardrails. A tailored Bicep package is created automatically.</span></div><div><button className="solution-secondary" onClick={back}>← Architecture needs</button><button className="solution-primary" onClick={next}>Accept blueprint →</button></div></div>
    <div className="architecture-grid">
      <section className="solution-card diagram-card"><div className="solution-card-head"><div><h2>Solution flow</h2><p>Logical architecture · Development environment</p></div><span className="policy-pass">✓ Policy aligned</span></div>
        <div className="architecture-diagram">
          <div className="diagram-node user-node"><i>♙</i><strong>J&J User</strong><small>Microsoft Entra ID</small></div><b>→</b>
          <div className="diagram-group app-group"><label>APPLICATION</label><div className="diagram-node"><i>▣</i><strong>Container Apps</strong><small>Web app & API</small></div></div><b>→</b>
          <div className="diagram-group ai-group"><label>AI PLATFORM</label><div className="diagram-node"><i>✦</i><strong>Microsoft Foundry</strong><small>Model & agent runtime</small></div></div>
          {resources.some(resource=>['Azure AI Search','Microsoft Fabric','Foundry IQ'].includes(resource.name)) && <><b>↔</b><div className="diagram-group data-group"><label>KNOWLEDGE & DATA</label><div className="diagram-node"><i>{resources.some(resource=>resource.name==='Foundry IQ')?'IQ':resources.some(resource=>resource.name==='Microsoft Fabric')?'F':'⌕'}</i><strong>{resources.some(resource=>resource.name==='Foundry IQ')?'Foundry IQ':resources.some(resource=>resource.name==='Microsoft Fabric')?'Microsoft Fabric':'AI Search'}</strong><small>{resources.some(resource=>resource.name==='Foundry IQ')?'Unified grounding':resources.some(resource=>resource.name==='Microsoft Fabric')?'Analytical data':'Document retrieval'}</small></div></div></>}
          <div className="diagram-baseline"><span>◇ Managed Identity</span><span>⌑ Key Vault</span><span>↗ Application Insights</span></div>
        </div>
      </section>
      <aside className="solution-card architecture-summary"><h3>Blueprint summary</h3><div><span>Environments</span><strong>{requirements.environments==='dev-test-prod'?'Dev, test & prod':requirements.environments==='dev-test'?'Dev & test':'Development'}</strong></div><div><span>Region</span><strong>{requirements.region}</strong></div><div><span>Components</span><strong>{resources.length}</strong></div><div><span>Network</span><strong>{requirements.privateNetwork?'Private access':'Public endpoints'}</strong></div><div><span>Availability</span><strong>{requirements.availability==='critical'?'99.95%+':requirements.availability==='high'?'99.9%':'Standard'}</strong></div><div><span>Authentication</span><strong>Managed identity</strong></div><hr/><small>ESTIMATED MONTHLY RANGE</small><b className="cost">${estimate.toLocaleString()}–${(estimate + 480).toLocaleString()}</b><p>Preliminary estimate based on selected scale and environments.</p></aside>
    </div>
    <section className="solution-card resource-list editable-resources"><div className="solution-card-head"><div><h2>Architecture components</h2><p>Review generated services, add optional components, or justify removing a recommendation.</p></div><div className="add-service"><select value={serviceToAdd} onChange={event=>setServiceToAdd(event.target.value)}><option value="">Add an optional service…</option>{available.map(resource=><option value={resource.name} key={resource.name}>{resource.name}</option>)}</select><button className="solution-secondary" disabled={!serviceToAdd} onClick={()=>{addResource(serviceToAdd);setServiceToAdd('')}}>+ Add</button></div></div><div className="resource-table"><div className="resource-row labels"><span>Azure component</span><span>Purpose</span><span>Why included</span><span>Status</span><span>Action</span></div>{resources.map(resource => <div className="resource-row" key={resource.name}><span><i>{resource.icon}</i><b>{resource.name}</b><small>{resource.type}</small></span><span>{resource.purpose}</span><span>{resource.reason}</span><span><em className={addedResources.includes(resource.name)?'user-added':''}>{resource.required?'Required':addedResources.includes(resource.name)?'User-added':'Recommended'}</em></span><span><button className="resource-remove" disabled={resource.required} title={resource.required?'Required by an active guardrail or requirement':''} onClick={()=>{setPendingRemoval(resource.name);setRemovalReason('')}}>{resource.required?'Locked':'Remove'}</button></span></div>)}</div>{pendingRemoval&&<div className="removal-review"><b>!</b><span><strong>Remove {pendingRemoval}?</strong><small>This service satisfies an active solution requirement. Remove or change that requirement, choose an approved alternative, or document why this recommendation is not needed.</small><textarea value={removalReason} onChange={event=>setRemovalReason(event.target.value)} placeholder="Required justification…"/></span><div><button className="solution-secondary" onClick={()=>setPendingRemoval(null)}>Cancel</button><button className="solution-primary" disabled={!removalReason.trim()} onClick={()=>{removeResource(pendingRemoval,removalReason);setPendingRemoval(null)}}>Confirm removal</button></div></div>}</section>
  </>
}

type DeploymentStage='review'|'checking'|'checked'|'deploying'|'deployed'|'error'
type InfrastructureView='plan'|'code'|'validation'
type PredictedResource={id:string;name:string;label:string;type:string;change:string;spec:string;location:string;parent?:string}
type ActiveDeployment={packageId:string;deploymentName:string;subscriptionId:string}

function restoredActiveDeployment():ActiveDeployment|null{
  try{return JSON.parse(sessionStorage.getItem(activeDeploymentKey)??'null') as ActiveDeployment|null}catch{return null}
}

function predictedResources(changes:unknown[],pkg:GeneratedBicepPackage):PredictedResource[]{
  let manifest:ArchitecturePackageRequest|undefined
  try{manifest=JSON.parse(pkg.files.find(item=>item.path==='deployment-manifest.json')?.content??'') as ArchitecturePackageRequest}catch{manifest=undefined}
  return changes.flatMap(change=>{
    if(!change||typeof change!=='object')return []
    const record=change as Record<string,unknown>
    const id=typeof record.resourceId==='string'?record.resourceId:''
    if(!id)return []
    const parts=id.split('/').filter(Boolean)
    const providerIndex=parts.indexOf('providers')
    if(providerIndex<0){
      const groupIndex=parts.indexOf('resourceGroups')
      const name=groupIndex>=0?parts[groupIndex+1]:'Resource group'
      return [{id,name,label:'Resource group',type:'Microsoft.Resources/resourceGroups',change:String(record.changeType??'Change'),spec:'Application isolation boundary',location:manifest?.location??'—'}]
    }
    const namespace=parts[providerIndex+1]
    const resourceSegments=parts.slice(providerIndex+2)
    const types:string[]=[]
    const names:string[]=[]
    for(let index=0;index<resourceSegments.length;index+=2){types.push(resourceSegments[index]);if(resourceSegments[index+1])names.push(resourceSegments[index+1])}
    const type=`${namespace}/${types.join('/')}`
    const normalized=type.toLowerCase()
    const name=names[names.length-1]??id
    let label=type
    let spec='Configured by the approved Bicep package'
    if(normalized==='microsoft.cognitiveservices/accounts'){label='Microsoft Foundry account';spec='AIServices · S0 · System-assigned identity · Entra-only'}
    else if(normalized==='microsoft.cognitiveservices/accounts/projects'){label='Microsoft Foundry project';spec='System-assigned identity · Governed project'}
    else if(normalized==='microsoft.cognitiveservices/accounts/deployments'){
      const model=name===manifest?.embeddingModel?.name?manifest?.embeddingModel:manifest?.chatModel
      label=name===manifest?.embeddingModel?.name?'Embedding model deployment':'Chat model deployment'
      spec=model?`${model.name} · Version ${model.version} · ${model.sku} · ${model.capacity}K TPM`:'Foundry model deployment'
    }else if(normalized==='microsoft.search/searchservices'){label='Azure AI Search';spec='Basic · Semantic ranker free · System-assigned identity · Entra-only'}
    else if(normalized==='microsoft.storage/storageaccounts'){label='Azure Storage';spec='StorageV2 · Standard LRS · OAuth default · Shared keys disabled'}
    else if(normalized==='microsoft.managedidentity/userassignedidentities'){label='Managed identity';spec='User-assigned identity · Passwordless access'}
    else if(normalized==='microsoft.operationalinsights/workspaces'){label='Log Analytics workspace';spec='PerGB2018 · 30-day retention'}
    else if(normalized==='microsoft.insights/components'){label='Application Insights';spec='Workspace-based · Local authentication disabled'}
    else if(normalized==='microsoft.network/virtualnetworks'){label='Virtual network';spec='10.42.0.0/16 · Private endpoint subnet'}
    return [{id,name,label,type,change:String(record.changeType??'Change'),spec,location:manifest?.location??'—',parent:names.length>1?names.slice(0,-1).join(' / '):undefined}]
  })
}

function InfrastructureCode({pkg,mcpConnection,includeSearch=false}:{pkg?:GeneratedBicepPackage|null;resources?:Resource[];mcpConnection?:{name:string;version?:string;apimPath:string};includeSearch?:boolean}){
  const [file,setFile]=useState('main.bicep')
  const [view,setView]=useState<InfrastructureView>('plan')
  const [selectedResourceId,setSelectedResourceId]=useState('')
  const [subscriptionId]=useState(import.meta.env.VITE_AZURE_SUBSCRIPTION_ID??'')
  const [token,setToken]=useState('')
  const [result,setResult]=useState<unknown>()
  const [previewChanges,setPreviewChanges]=useState<unknown[]>([])
  const [deploymentProgress,setDeploymentProgress]=useState<DeploymentProgress>()
  const [stage,setStage]=useState<DeploymentStage>('checking')
  const [starterMode,setStarterMode]=useState<'source'|'jfrog'>('source')
  const [starterKit,setStarterKit]=useState<GeneratedAgentStarterKit>()
  const [starterFile,setStarterFile]=useState('README.md')
  const [starterError,setStarterError]=useState('')
  const [starterLoading,setStarterLoading]=useState(false)
  const [activeDeployment,setActiveDeployment]=useState<ActiveDeployment|null>(restoredActiveDeployment)
  const previewedPackage=useRef('')
  const selected=pkg?.files.find(item=>item.path===file)??pkg?.files[0]
  const bicepFiles=pkg?.files.filter(item=>item.path.endsWith('.bicep')||item.path.endsWith('.bicepparam'))??[]
  const evidenceFiles=pkg?.files.filter(item=>!bicepFiles.includes(item))??[]
  let packageLocation=''
  try{packageLocation=(JSON.parse(pkg?.files.find(item=>item.path==='deployment-manifest.json')?.content??'{}') as ArchitecturePackageRequest).location}catch{packageLocation=''}
  const resultRecord=result&&typeof result==='object'?result as Record<string,unknown>:undefined
  const deploymentName=typeof resultRecord?.deploymentName==='string'?resultRecord.deploymentName:''
  const changes=previewChanges
  const inventory=pkg?predictedResources(changes,pkg):[]
  const resourceStates=new Map((deploymentProgress?.resources??[]).map(resource=>[resource.resourceId.toLowerCase(),resource.state]))
  const deploymentStateFor=(resourceId:string)=>resourceStates.get(resourceId.toLowerCase())??(stage==='deploying'?'Queued':undefined)
  const completedResources=(deploymentProgress?.resources??[]).filter(resource=>resource.state==='Succeeded').length
  const selectedResource=inventory.find(item=>item.id===selectedResourceId)
  const maskSubscription=(value:string)=>subscriptionId?value.split(subscriptionId).join('••••••••-••••-••••-••••-••••••••••••'):value
  const creates=inventory.filter(item=>item.change.toLowerCase()==='create').length
  const modifications=inventory.filter(item=>item.change.toLowerCase()==='modify').length
  const deletions=inventory.filter(item=>item.change.toLowerCase()==='delete').length
  const inventoryGroups=[
    {title:'Microsoft Foundry',description:'AI platform, project, and model deployments',items:inventory.filter(item=>item.type.toLowerCase().startsWith('microsoft.cognitiveservices/'))},
    {title:'Knowledge & data',description:'Retrieval and application data services',items:inventory.filter(item=>['microsoft.search/','microsoft.storage/'].some(prefix=>item.type.toLowerCase().startsWith(prefix)))},
    {title:'Security & operations',description:'Environment, identity, networking, and monitoring',items:inventory.filter(item=>!item.type.toLowerCase().startsWith('microsoft.cognitiveservices/')&&!['microsoft.search/','microsoft.storage/'].some(prefix=>item.type.toLowerCase().startsWith(prefix)))},
  ].filter(group=>group.items.length)
  const runPreview=useCallback(async(force=false)=>{
    if(!pkg||!subscriptionId)return
    if(!force&&activeDeployment?.packageId===pkg.packageId&&activeDeployment.subscriptionId===subscriptionId)return
    const previewKey=`${pkg.packageId}:${subscriptionId}`
    if(!force&&previewedPackage.current===previewKey)return
    previewedPackage.current=previewKey
    setToken('')
    setResult(undefined)
    setDeploymentProgress(undefined)
    setStage('checking')
    try{
      const response=await runPackageWhatIf(pkg.packageId,subscriptionId)
      setToken(response.confirmationToken)
      setResult(response.result)
      setPreviewChanges(Array.isArray(response.result.changes)?response.result.changes:[])
      setStage('checked')
    }catch(error){setToken('');setResult({error:error instanceof Error?error.message:'Request failed'});setStage('error')}
  },[pkg,subscriptionId,activeDeployment])
  useEffect(()=>{void runPreview()},[runPreview])
  useEffect(()=>{
    if(!pkg||!activeDeployment||activeDeployment.packageId!==pkg.packageId||activeDeployment.subscriptionId!==subscriptionId)return
    let cancelled=false
    let transientFailures=0
    let pollCount=0
    setStage('deploying')
    const poll=async()=>{
      for(;;){
        if(cancelled)return
        const delay=pollCount<2?5000:pollCount<5?10000:pollCount<10?15000:30000
        await new Promise(resolve=>setTimeout(resolve,delay))
        if(cancelled)return
        try{
          const progress=await getPackageDeploymentStatus(activeDeployment.packageId,activeDeployment.deploymentName,activeDeployment.subscriptionId)
          transientFailures=0
          pollCount+=1
          setDeploymentProgress(progress)
          setResult(progress)
          if(progress.state==='Succeeded'){setStage('deployed');return}
          if(['Failed','Canceled'].includes(progress.state))throw new Error(JSON.stringify(progress.error??`Azure deployment ${progress.state.toLowerCase()}`))
        }catch(error){
          transientFailures+=1
          if(transientFailures>=3)throw error
        }
      }
    }
    void poll().catch(error=>{
      if(cancelled)return
      try{sessionStorage.removeItem(activeDeploymentKey)}catch{/* Ignore unavailable storage. */}
      setActiveDeployment(null)
      setToken('')
      setResult({error:error instanceof Error?error.message:'Request failed'})
      setStage('error')
    })
    return()=>{cancelled=true}
  },[pkg,subscriptionId,activeDeployment])
  const runDeploy=async()=>{
    if(!pkg||!subscriptionId||!token)return
    setStage('deploying')
    try{
      const submitted=await deployPackage(pkg.packageId,subscriptionId,token)
      setResult(submitted)
      setToken('')
      const deployment={packageId:pkg.packageId,deploymentName:submitted.deploymentName,subscriptionId}
      try{sessionStorage.setItem(activeDeploymentKey,JSON.stringify(deployment))}catch{/* Continue even when storage is unavailable. */}
      setActiveDeployment(deployment)
    }catch(error){setToken('');setResult({error:error instanceof Error?error.message:'Request failed'});setStage('error')}
  }
  const generateStarter=async()=>{
    if(!pkg)return
    setStarterLoading(true)
    setStarterError('')
    try{
      const kit=await createAgentStarterKit(pkg.packageId,{agentName:'quality-event-summarizer',deploymentMode:starterMode,mcpConnection,includeSearch})
      setStarterKit(kit)
      setStarterFile('README.md')
    }catch(error){setStarterError(error instanceof Error?error.message:'Starter kit generation failed')}
    finally{setStarterLoading(false)}
  }
  if(!pkg||!selected)return <WorkspacePage kicker="INFRASTRUCTURE & DEPLOYMENT" title="Generating your deployment package" description="The approved architecture is being converted into validated Bicep."><div className="package-loading"><i>✦</i><strong>Building governed infrastructure</strong><span>Generating parameters and compiling the Bicep package…</span></div></WorkspacePage>
  return <WorkspacePage kicker="INFRASTRUCTURE & DEPLOYMENT" title="Review and deploy your infrastructure" description="See the deployment plan first. Inspect code or Azure validation details only when needed.">
    <section className="deployment-overview solution-card"><div className="overview-package"><i>✓</i><span><small>PACKAGE READY</small><strong>{pkg.packageId}</strong><em>SHA-256 {pkg.sha256.slice(0,10)}…{pkg.sha256.slice(-6)}</em></span></div><div className="overview-facts"><span><small>AZURE STATUS</small><strong className={stage==='error'?'status-error':stage==='checking'||stage==='deploying'?'status-checking':'status-ready'}>{stage==='error'?'Validation failed':stage==='checking'?'Validating…':stage==='deploying'?'Deploying…':stage==='deployed'?'Deployment succeeded':'Validated'}</strong></span><span><small>TARGET</small><strong>{subscriptionId?`${subscriptionId.slice(0,8)}••••${subscriptionId.slice(-4)}`:'Not configured'}</strong></span><span><small>REGION</small><strong>{regionLabels[packageLocation]||packageLocation||'—'}</strong></span><span><small>CHANGES</small><strong>{stage==='checking'?'—':`${inventory.length} resources`}</strong></span></div></section>
    <nav className="infrastructure-tabs" aria-label="Infrastructure views"><button className={view==='plan'?'active':''} onClick={()=>setView('plan')}>Deployment plan</button><button className={view==='code'?'active':''} onClick={()=>setView('code')}>Infrastructure code</button><button className={view==='validation'?'active':''} onClick={()=>setView('validation')}>Azure validation {stage==='checked'||stage==='deployed'?<i>✓</i>:stage==='error'?<i className="tab-error">!</i>:null}</button></nav>
    {view==='plan'&&<section className="deployment-plan-view">
      {stage==='checking'&&<div className="solution-card inventory-progress"><i></i><span><strong>Building the Azure deployment plan</strong><small>Resolving names and checking changes without creating resources.</small></span></div>}
      {stage==='error'&&<div className="solution-card plan-error"><b>!</b><span><strong>Azure validation could not complete</strong><small>{String(resultRecord?.error??'Review the request and retry validation.')}</small></span></div>}
      {stage==='deploying'&&<div className="solution-card deployment-live"><header><i></i><span><small>LIVE AZURE DEPLOYMENT</small><strong>{completedResources} of {inventory.length} resources completed</strong><em>{deploymentProgress?.deploymentName??'Submitting deployment to Azure Resource Manager'}</em></span></header><div>{inventory.map(item=>{const state=deploymentStateFor(item.id)??'Queued';return <span key={item.id}><i className={`provision-${state.toLowerCase()}`}>{state==='Succeeded'?'✓':state==='Failed'?'!':state==='Running'?'◌':'·'}</i><span><strong>{item.label}</strong><small>{item.name}</small></span><em>{state}</em></span>})}</div></div>}
      {stage==='deployed'&&<div className="solution-card deployment-success"><i>✓</i><span><small>AZURE DEPLOYMENT COMPLETE</small><strong>Infrastructure deployed successfully</strong><em>{deploymentName||'Azure confirmed successful completion'} · {regionLabels[packageLocation]||packageLocation}</em></span></div>}
      {stage==='deployed'&&<section className="solution-card agent-activation"><header><div><span>DEVELOPER HANDOFF</span><h2>Build your governed hosted agent</h2><p>Generate a Python starter linked to this infrastructure package. Verified non-secret endpoints and resource IDs from this Azure deployment are included automatically without embedding credentials.</p></div><b>Next phase</b></header><div className="activation-layout"><div className="activation-config"><h3>Choose the deployment path</h3><button className={starterMode==='source'?'selected':''} onClick={()=>{setStarterMode('source');setStarterKit(undefined)}}><i>⌘</i><span><strong>Deploy from source</strong><small>Recommended · Foundry remote build · no container registry</small></span><b>{starterMode==='source'?'✓':''}</b></button><button className={starterMode==='jfrog'?'selected':''} onClick={()=>{setStarterMode('jfrog');setStarterKit(undefined)}}><i>JF</i><span><strong>Deploy a JFrog image</strong><small>OIDC token exchange · CustomKeys registry connection · no ACR bridge</small></span><b>{starterMode==='jfrog'?'✓':''}</b></button><div className="activation-connections"><strong>Governed references</strong><span><i>✦</i> Deployed Foundry project and {packageLocation} model</span>{mcpConnection&&<span><i>⚡</i> {mcpConnection.name} {mcpConnection.version??''} through APIM</span>}{includeSearch&&<span><i>⌕</i> Deployed Azure AI Search endpoint</span>}<span><i>◇</i> Post-creation agent identity access request</span></div><button className="solution-primary" disabled={starterLoading} onClick={()=>void generateStarter()}>{starterLoading?'Generating…':starterKit?'↻ Regenerate starter kit':'Generate starter kit →'}</button>{starterError&&<p className="starter-error">{starterError}</p>}</div><div className="activation-output">{!starterKit?<div className="starter-empty"><i>⌘</i><strong>Developer-owned implementation</strong><p>The generated baseline automatically includes verified deployment configuration. Only external resources not created by this package remain placeholders.</p></div>:<><div className="starter-ready"><span><small>STARTER KIT READY</small><strong>{starterKit.kitId}</strong><em>{starterKit.configurationSource==='verified-azure-deployment'?'Verified Azure connections':'Package-plan configuration'} · SHA-256 {starterKit.sha256.slice(0,12)}… · {starterKit.files.length} files</em></span><a className="solution-primary" href={starterKit.downloadUrl}>Download .zip</a></div><div className="starter-browser"><aside>{starterKit.files.map(item=><button className={starterFile===item.path?'active':''} onClick={()=>setStarterFile(item.path)} key={item.path}>{item.path}</button>)}</aside><pre>{starterKit.files.find(item=>item.path===starterFile)?.content}</pre></div></>}</div></div></section>}
      {(stage==='checked'||stage==='deploying'||stage==='deployed')&&inventory.length===0&&<div className="solution-card inventory-empty">Azure predicts no resource changes for this package.</div>}
      {inventory.length>0&&<div className={`resource-plan-layout ${selectedResource?'has-details':''}`}><div className="resource-groups">{inventoryGroups.map(group=><section className="solution-card resource-group-card" key={group.title}><header><span><h2>{group.title}</h2><p>{group.description}</p></span><b>{group.items.length}</b></header><div>{group.items.map(item=><button className={selectedResourceId===item.id?'selected':''} key={item.id} onClick={()=>setSelectedResourceId(item.id)}><span className="resource-plan-icon">{item.label.includes('Foundry')||item.label.includes('model')?'✦':item.label.includes('Search')?'⌕':item.label.includes('Storage')?'▤':item.label.includes('network')?'◎':item.label.includes('identity')?'◇':item.label.includes('Resource group')?'▦':'↗'}</span><span className="resource-plan-name"><strong>{item.label}</strong><small>{item.name}</small></span><span className="resource-plan-spec">{item.spec.split(' · ').slice(0,2).join(' · ')}</span><em className={`change-${item.change.toLowerCase()}`}>{item.change}</em><i>›</i></button>)}</div></section>)}</div>{selectedResource&&<aside className="solution-card resource-detail"><header><span>RESOURCE DETAILS</span><button onClick={()=>setSelectedResourceId('')} aria-label="Close resource details">×</button></header><div className="resource-detail-title"><i>✦</i><span><h2>{selectedResource.label}</h2><code>{selectedResource.name}</code></span></div><dl><div><dt>Deployment action</dt><dd><em className={`change-${selectedResource.change.toLowerCase()}`}>{selectedResource.change}</em></dd></div><div><dt>Azure resource type</dt><dd>{selectedResource.type}</dd></div><div><dt>Region</dt><dd>{selectedResource.location}</dd></div>{selectedResource.parent&&<div><dt>Parent resource</dt><dd>{selectedResource.parent}</dd></div>}<div><dt>Configuration</dt><dd>{selectedResource.spec}</dd></div><div><dt>Resource ID</dt><dd className="detail-resource-id">{maskSubscription(selectedResource.id)}</dd></div></dl><small>Configuration comes from the immutable package validated by Azure.</small></aside>}</div>}
    </section>}
    {view==='code'&&<section className="template-studio solution-card code-tab-view"><header className="studio-header"><div><span>READ-ONLY PACKAGE</span><h2>Generated Bicep</h2><p>These are the exact files Azure will receive.</p></div><div className="package-hash"><small>SHA-256</small><code>{pkg.sha256.slice(0,12)}…{pkg.sha256.slice(-8)}</code></div></header><div className="studio-body"><aside className="file-explorer"><label>DEPLOYMENT TEMPLATES</label>{bicepFiles.map(item=><button key={item.path} className={item.path===selected.path?'active':''} onClick={()=>setFile(item.path)}><i>{item.path.endsWith('.bicepparam')?'P':'B'}</i><span>{item.path}<small>{item.content.split('\n').length} lines</small></span><b>›</b></button>)}<label>PACKAGE EVIDENCE</label>{evidenceFiles.map(item=><button key={item.path} className={item.path===selected.path?'active':''} onClick={()=>setFile(item.path)}><i className="json-icon">&#123;&#125;</i><span>{item.path}<small>Generated record</small></span><b>›</b></button>)}</aside><div className="code-editor"><div className="editor-toolbar"><span><i className={selected.path.endsWith('.json')?'json-icon':''}>{selected.path.endsWith('.json')?'{}':selected.path.endsWith('.bicepparam')?'P':'B'}</i>{selected.path}</span><div><em>Read only</em><button title="Copy file" onClick={()=>void navigator.clipboard.writeText(selected.content)}>Copy</button></div></div><div className="code-scroll"><code>{selected.content.split('\n').map((line,index)=><span className="code-line" key={index}><b>{index+1}</b><i className={line.trim().startsWith('//')?'comment':line.trim().startsWith('@')?'decorator':line.includes('resource ')||line.includes('module ')?'resource-line':''}>{line||' '}</i></span>)}</code></div></div></div></section>}
    {view==='validation'&&<section className="validation-view"><div className={`solution-card validation-summary ${stage==='error'?'failed':''}`}><i>{stage==='error'?'!':stage==='checking'?'…':'✓'}</i><span><small>AZURE WHAT-IF</small><h2>{stage==='error'?'Validation failed':stage==='checking'?'Validation in progress':'Azure validation passed'}</h2><p>{stage==='error'?String(resultRecord?.error??'Azure could not validate this package.'):stage==='checking'?'Azure is safely calculating the expected changes.':`${creates} creates · ${modifications} modifications · ${deletions} deletions`}</p></span></div><div className="solution-card validation-details"><header><div><span>VALIDATION EVIDENCE</span><h2>Change safety summary</h2></div></header><div className="change-summary"><span className="creates"><b>{creates}</b><small>Creates</small></span><span className="modifies"><b>{modifications}</b><small>Modifications</small></span><span className="deletes"><b>{deletions}</b><small>Deletions</small></span></div>{result!==undefined&&stage!=='error'&&<details className="raw-result"><summary>Advanced · View raw Azure response</summary><pre>{maskSubscription(JSON.stringify(result,null,2))}</pre></details>}</div></section>}
    <footer className="deployment-action-bar solution-card"><div><i>{stage==='error'?'!':stage==='checking'?'◌':'✓'}</i><span><strong>{stage==='error'?'Azure validation needs attention':stage==='checking'?'Validating package with Azure':stage==='deploying'?'Azure deployment in progress':stage==='deployed'?'Deployment completed successfully':`${inventory.length} resources ready to deploy`}</strong><small>{stage==='checked'?deletions?`${deletions} deletions require review`:'No modifications or deletions predicted':stage==='checking'?'No resources are being created yet':stage==='deploying'?'Keep this page open while Azure provisions the resources':stage==='deployed'?deploymentName||'Azure reported successful completion':'Exact SHA-256 package guarantee'}</small></span></div><div>{stage==='error'&&<button className="solution-secondary" disabled={!subscriptionId} onClick={()=>void runPreview(true)}>Retry validation</button>}<button className="solution-primary" disabled={!token||stage==='deploying'||stage==='deployed'} onClick={()=>void runDeploy()}>{stage==='checking'?'Validating…':stage==='deploying'?'Deploying…':stage==='deployed'?'✓ Deployment complete':'Deploy environment →'}</button></div></footer>
  </WorkspacePage>
}

export default function SolutionBuilder({ exit }: { exit: () => void }) {
  const [screen, setScreen] = useState<WorkspaceScreen>(restoredWorkspaceScreen)
  navigateWorkspace=setScreen
  const [selected, setSelected] = useState<Capability[]>(approvedCapabilities)
  const [selectedAssets, setSelectedAssets] = useState<string[]>([])
  const [requestedAssets,setRequestedAssets]=useState<string[]>([])
  const [requestAsset,setRequestAsset]=useState<CatalogAsset|null>(null)
  const [dataConfiguration,setDataConfiguration]=useState<DataConfiguration>(initialDataConfiguration)
  const [channelConfiguration,setChannelConfiguration]=useState<ChannelConfiguration>(initialChannelConfiguration)
  const [governanceConfiguration,setGovernanceConfiguration]=useState<GovernanceConfiguration>(initialGovernanceConfiguration)
  const [memorySelections,setMemorySelections]=useState<string[]>([])
  const [requirementsState, setRequirements] = useState<Requirements>(initialRequirements)
  const [modelOverride,setModelOverride]=useState<ModelId|''>('')
  const [modelConfirmed,setModelConfirmed]=useState(false)
  const [embeddingModel,setEmbeddingModel]=useState<EmbeddingModelId|''>('')
  const [embeddingCapacity,setEmbeddingCapacity]=useState(10)
  const [generatedPackage,setGeneratedPackage]=useState<GeneratedBicepPackage|null>(restoredGeneratedPackage)
  const requirements:Requirements={...requirementsState,privateNetwork:true}
  const [addedResources,setAddedResources]=useState<string[]>([])
  const [removedResources,setRemovedResources]=useState<Record<string,string>>({})
  const connectors=[...new Set(catalogAssets.filter(asset=>selectedAssets.includes(asset.id)).map(asset=>asset.connector))]
  const [modelRecommendation,setModelRecommendation]=useState<ModelRecommendation>(()=>initialModelRecommendation(approvedCapabilities,initialDataConfiguration,[],[],initialRequirements))
  useEffect(()=>{
    let active=true
    const timer=window.setTimeout(()=>{
      void requestModelRecommendation({capabilities:selected,dataTypes:dataConfiguration.types,dataUses:dataConfiguration.uses,connectors,memory:memorySelections,regulated:requirements.regulated,scale:requirements.scale})
        .then(result=>{if(active)setModelRecommendation(result)})
        .catch(()=>{/* Keep the last valid recommendation while the API is unavailable. */})
    },200)
    return()=>{active=false;window.clearTimeout(timer)}
  },[selected.join(','),dataConfiguration.types.join(','),dataConfiguration.uses.join(','),connectors.join(','),memorySelections.join(','),requirements.regulated,requirements.scale])
  const selectedModel=foundryModels.find(model=>model.id===(modelOverride||modelRecommendation.model.id))!
  const inferredResources=resourcesFor(selected,requirements,connectors,dataConfiguration,memorySelections)
  const channelResources:Resource[]=[...(channelConfiguration.m365==='yes'?[{name:'Azure Bot Service',type:'Channel registration',purpose:'Bridge the Foundry agent to Teams and Microsoft 365 Copilot',reason:'Required for the Foundry custom engine agent publishing path',icon:'B',required:true},{name:'Microsoft Entra App Registration',type:'Identity registration',purpose:'Provide the agent identity and channel authentication',reason:'Required for Teams and Microsoft 365 Copilot integration',icon:'E',required:true}]:[])]
  const modelResource:Resource={name:`Foundry model deployment: ${selectedModel.name}`,type:'Model deployment',purpose:'Provide the selected language and reasoning model',reason:`${modelRecommendation.level} application complexity · ${modelRecommendation.capacity} planned capacity`,icon:'✦',required:true}
  const requiresEmbedding=inferredResources.some(resource=>resource.name==='Azure AI Search')||addedResources.includes('Azure AI Search')
  const selectedMcpAsset=catalogAssets.find(asset=>selectedAssets.includes(asset.id)&&asset.kind==='MCP server')
  const starterMcpConnection=selectedMcpAsset?{name:selectedMcpAsset.name,version:selectedMcpAsset.version,apimPath:selectedMcpAsset.detail.split('·').slice(-1)[0]?.trim()||`/mcp/${selectedMcpAsset.id}`} : undefined
  const selectedEmbeddingModel=embeddingModels.find(model=>model.id===embeddingModel)
  const embeddingResource:Resource|undefined=selectedEmbeddingModel?{name:`Foundry embedding model deployment: ${selectedEmbeddingModel.name}`,type:'Model deployment',purpose:'Create vector representations for semantic retrieval',reason:'Selected for Azure AI Search vector and hybrid retrieval',icon:'✦',required:true}:undefined
  const resources=[...inferredResources.filter(resource=>resource.required||!removedResources[resource.name]),...(modelConfirmed?[modelResource]:[]),...(modelConfirmed&&embeddingResource?[embeddingResource]:[]),...channelResources.filter(resource=>!inferredResources.some(item=>item.name===resource.name)),...optionalResources.filter(resource=>addedResources.includes(resource.name)&&!inferredResources.some(item=>item.name===resource.name)&&!channelResources.some(item=>item.name===resource.name))]
  useEffect(()=>{try{sessionStorage.setItem(workspaceScreenKey,screen)}catch{/* Ignore unavailable storage. */}},[screen])
  useEffect(()=>{try{if(generatedPackage)sessionStorage.setItem(generatedPackageKey,JSON.stringify(generatedPackage));else sessionStorage.removeItem(generatedPackageKey)}catch{/* Ignore unavailable storage. */}},[generatedPackage])
  workingResources=resources
  const profile=[...selected.map(id=>capabilityOptions.find(option=>option.id===id)?.title).filter((item):item is string=>Boolean(item)),...dataConfiguration.types.map(type=>({documents:'Document knowledge',analytics:'Analytical data',operational:'Live operational records',uploads:'User-uploaded files'}[type]||type)),...memorySelections,...(selectedAssets.length?[`${selectedAssets.length} governed ${selectedAssets.length===1?'tool':'tools'}`]:[]),...(requirements.privateNetwork?['Private networking']:[]),...(requirements.regulated?['Regulated workload controls']:[])]
  if(dataConfiguration.access==='no')profile.push('No external data access')
  if(channelConfiguration.m365==='no')profile.push('Standalone application channel')
  if(channelConfiguration.surfaces.includes('teams'))profile.push('Microsoft Teams channel')
  if(channelConfiguration.surfaces.includes('copilot'))profile.push('Microsoft 365 Copilot channel')
  if(channelConfiguration.agentStore==='yes')profile.push('Organizational Agent Store')
  if(modelConfirmed)profile.push(`${selectedModel.name} model deployment`)
  const setRequirement = <K extends keyof Requirements>(key:K,value:Requirements[K]) => setRequirements(current=>({...current,[key]:value}))
  const deploymentKeys=deploymentKeysFor(resources.map(resource=>resource.name))
  // The target architecture retains private networking, but POC packages use public endpoints.
  const pocDeploymentKeys=deploymentKeys.filter(key=>key!=='private-network')
  const chatDeployment:ArchitecturePackageRequest['chatModel']={name:selectedModel.id,version:modelVersions[selectedModel.id],sku:'GlobalStandard',capacity:Number.parseInt(modelRecommendation.capacity)}
  const embeddingDeployment:ArchitecturePackageRequest['embeddingModel']=pocDeploymentKeys.includes('embedding-model')&&embeddingModel?{name:embeddingModel,version:'1',sku:'GlobalStandard',capacity:embeddingCapacity}:undefined
  const approveArchitecture=async()=>{
    if(requiresEmbedding&&!embeddingModel){setScreen('model');window.alert('Choose an embedding model before generating the deployment package.');return}
    const location=azureRegionCode(requirements.region)
    const request:ArchitecturePackageRequest={applicationId:'AI-2026-0118',location,resourceGroupName:`rg-quality-rag-poc-${regionSuffixes[location]??location}`,workloadName:'quality-rag-poc',resources:pocDeploymentKeys,chatModel:chatDeployment,embeddingModel:embeddingDeployment,operationalRequirements:operationalRequirements(requirements),tags:{applicationId:'AI-2026-0118',environment:'poc',networkProfile:'public-poc',productionNetwork:'private-required',expiresOn:'2026-09-30'}}
    try{setGeneratedPackage(await createBicepPackage(request));setScreen('iac')}catch(error){window.alert(error instanceof Error?error.message:'Bicep package generation failed')}
  }
  useEffect(()=>{if(screen==='architecture')setGeneratedPackage(null)},[screen])
  useEffect(()=>{if(screen==='iac'&&!generatedPackage)void approveArchitecture()},[screen,generatedPackage])
  const toggleConnector = (asset:CatalogAsset) => { if(asset.status!=='Approved'){setRequestAsset(asset);return} setSelectedAssets(current=>current.includes(asset.id)?current.filter(x=>x!==asset.id):[...current,asset.id]); if(asset.connector==='on-prem') setRequirements(current=>({...current,onPremises:true,privateNetwork:true})); if(['servicenow','internal-api','mcp'].includes(asset.connector)) setSelected(current=>current.includes('actions')?current:[...current,'actions']) }
  const submitAssetRequest=()=>{if(!requestAsset)return;setRequestedAssets(current=>current.includes(requestAsset.id)?current:[...current,requestAsset.id]);setRequestAsset(null)}
  if (screen === 'ready') return <main className="configuration-ready"><div>✓</div><span>BLUEPRINT ACCEPTED</span><h1>Ready for access validation and provisioning</h1><p>Your capabilities, connectors, Foundry model deployment, Azure architecture, and generated Bicep package have been saved. The next workspace will validate model availability, quota, connector approvals, policy, generated code, and cost before provisioning.</p><button className="solution-primary" onClick={() => setScreen('architecture')}>Return to architecture</button><button className="solution-secondary" onClick={exit}>Back to applications</button></main>
  if(screen==='channels')return <div className="solution-shell"><div className="solution-top"><button onClick={exit}>← My applications</button><span>Quality Event Summarizer <b>AI-2026-0118</b></span><button className="solution-secondary">Save workspace</button></div><div className="solution-workspace"><WorkspaceNav screen={screen} resources={resources} profile={profile} navigate={setScreen}/><main className="solution-page workspace-content"><ChannelsDistribution channels={channelConfiguration} setChannels={setChannelConfiguration}/></main></div></div>
  if(String(screen)==='requirements')return <div className="solution-shell"><div className="solution-top"><button onClick={exit}>← My applications</button><span>Quality Event Summarizer <b>AI-2026-0118</b></span><button className="solution-secondary">Save workspace</button></div><div className="solution-workspace"><WorkspaceNav screen={screen} resources={resources} profile={profile} navigate={setScreen}/><main className="solution-page workspace-content"><ArchitectureNeeds requirements={requirements} setRequirement={setRequirement} capabilities={selected} connectors={connectors} data={dataConfiguration} memory={memorySelections} back={()=>setScreen('memory')} next={()=>setScreen('governance')}/></main></div></div>
  if(String(screen)==='model')return <div className="solution-shell"><div className="solution-top"><button onClick={exit}>← My applications</button><span>Quality Event Summarizer <b>AI-2026-0118</b></span><button className="solution-secondary">Save workspace</button></div><div className="solution-workspace"><WorkspaceNav screen={screen} resources={resources} profile={profile} navigate={setScreen}/><main className="solution-page workspace-content"><ModelSelection recommendation={modelRecommendation} selected={selectedModel.id} setSelected={setModelOverride} requiresEmbedding={requiresEmbedding} selectedEmbedding={embeddingModel} setSelectedEmbedding={setEmbeddingModel} embeddingCapacity={embeddingCapacity} setEmbeddingCapacity={setEmbeddingCapacity} next={()=>{setModelConfirmed(true);setScreen('region')}}/></main></div></div>
  if(String(screen)==='region')return <div className="solution-shell"><div className="solution-top"><button onClick={exit}>← My applications</button><span>Quality Event Summarizer <b>AI-2026-0118</b></span><button className="solution-secondary">Save workspace</button></div><div className="solution-workspace"><WorkspaceNav screen="model" resources={resources} profile={profile} navigate={setScreen}/><main className="solution-page workspace-content"><RegionReadiness resources={pocDeploymentKeys} chatModel={chatDeployment} embeddingModel={embeddingDeployment} back={()=>setScreen('model')} confirm={region=>{setRequirement('region',region);setScreen('architecture')}}/></main></div></div>
  if(String(screen)==='iac')return <div className="solution-shell"><div className="solution-top"><button onClick={exit}>← My applications</button><span>Quality Event Summarizer <b>AI-2026-0118</b></span><button className="solution-secondary">Save workspace</button></div><div className="solution-workspace"><WorkspaceNav screen={screen} resources={resources} profile={profile} navigate={setScreen}/><main className="solution-page workspace-content"><InfrastructureCode pkg={generatedPackage} mcpConnection={starterMcpConnection} includeSearch={requiresEmbedding}/></main></div></div>
  if(String(screen)==='governance')return <div className="solution-shell"><div className="solution-top"><button onClick={exit}>← My applications</button><span>Quality Event Summarizer <b>AI-2026-0118</b></span><button className="solution-secondary">Save workspace</button></div><div className="solution-workspace"><WorkspaceNav screen={screen} resources={resources} profile={profile} navigate={setScreen}/><main className="solution-page workspace-content"><GovernanceAssessment requirements={requirements} setRequirement={setRequirement} governance={governanceConfiguration} setGovernance={setGovernanceConfiguration} back={()=>setScreen('requirements')} next={()=>setScreen('model')}/></main></div></div>
  if(String(screen)==='provisioning')return <div className="solution-shell"><div className="solution-top"><button onClick={exit}>← My applications</button><span>Quality Event Summarizer <b>AI-2026-0118</b></span><button className="solution-secondary">Save workspace</button></div><div className="solution-workspace"><WorkspaceNav screen="iac" resources={resources} profile={profile} navigate={setScreen}/><main className="solution-page workspace-content"><InfrastructureCode pkg={generatedPackage} mcpConnection={starterMcpConnection} includeSearch={requiresEmbedding}/></main></div></div>
  return <div className="solution-shell"><div className="solution-top"><button onClick={exit}>← My applications</button><span>Quality Event Summarizer <b>AI-2026-0118</b></span><button className="solution-secondary">Save workspace</button></div><div className="solution-workspace"><WorkspaceNav screen={screen} resources={resources} profile={profile} navigate={setScreen}/><main className="solution-page workspace-content">{screen === 'overview' && <Overview begin={() => setScreen('design')}/>} {screen==='design'&&<DesignStart describe={()=>setScreen('describe')} guided={()=>setScreen('data')}/>} {screen==='describe'&&<DescribeApplication back={()=>setScreen('design')} apply={(caps,data,memory,inferredRequirements)=>{setSelected(caps);setDataConfiguration(data);setMemorySelections(memory);setRequirements(current=>({...current,...inferredRequirements}));setScreen('data')}}/>} {screen==='data'&&<DataKnowledge data={dataConfiguration} setData={setDataConfiguration}/>} {screen === 'connectors' && <ConnectorCatalog selected={selectedAssets} requested={requestedAssets} capabilities={selected} data={dataConfiguration} requirements={requirements} toggle={toggleConnector} back={() => setScreen('data')} next={() => setScreen('memory')}/>} {screen==='memory'&&<MemoryState memory={memorySelections} setMemory={setMemorySelections}/>} {screen === 'requirements' && <ArchitectureNeeds requirements={requirements} setRequirement={setRequirement} capabilities={selected} connectors={connectors} data={dataConfiguration} memory={memorySelections} back={() => setScreen('memory')} next={() => setScreen('architecture')}/>} {screen === 'architecture' && <Architecture resources={resources} requirements={requirements} addedResources={addedResources} addResource={name=>{setAddedResources(current=>[...new Set([...current,name])]);setRemovedResources(current=>{const next={...current};delete next[name];return next})}} removeResource={(name,reason)=>{setAddedResources(current=>current.filter(item=>item!==name));setRemovedResources(current=>({...current,[name]:reason}))}} back={() => setScreen('requirements')} next={() => setScreen('iac')}/>} {screen==='iac'&&<InfrastructureCode resources={resources}/>} {screen==='governance'&&<GovernancePage/>} {screen==='provisioning'&&<ProvisioningPage/>} {screen==='activity'&&<ActivityPage/>}</main></div>{requestAsset&&<AssetRequestModal asset={requestAsset} close={()=>setRequestAsset(null)} submit={submitAssetRequest}/>}</div>
}
