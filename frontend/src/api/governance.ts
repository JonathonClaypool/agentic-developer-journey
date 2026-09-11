import {api} from './client'
import type {RiskAssessment,RiskAssessmentRequest} from './models'

export const assessRisk=(request:RiskAssessmentRequest)=>api<RiskAssessment>('/api/governance/risk-assessment',{method:'POST',body:JSON.stringify(request)})
