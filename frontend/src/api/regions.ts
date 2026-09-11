import {api} from './client'
import type {ArchitecturePackageRequest,DeploymentResourceKey,RegionAssessment} from './models'

export const assessRegions=(request:{subscriptionId:string;preferredRegion?:string;candidateRegions:string[];resources:DeploymentResourceKey[];chatModel:ArchitecturePackageRequest['chatModel'];embeddingModel?:ArchitecturePackageRequest['embeddingModel']})=>api<RegionAssessment>('/api/regions/assess',{method:'POST',body:JSON.stringify(request)})
