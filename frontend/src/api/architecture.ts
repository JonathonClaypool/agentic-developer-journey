import {api} from './client'
import type {ArchitecturePlan,DeploymentResourceKey,OperationalRequirements} from './models'

export const planArchitecture=(request:{resources:DeploymentResourceKey[];primaryRegion?:string;operationalRequirements:OperationalRequirements})=>api<ArchitecturePlan>('/api/architecture/plan',{method:'POST',body:JSON.stringify(request)})