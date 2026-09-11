import {api} from './client'
import type {Catalog,ModelRecommendation,ModelRecommendationRequest} from './models'

export const getCatalog=()=>api<Catalog>('/api/catalog')
export const recommendModel=(request:ModelRecommendationRequest)=>api<ModelRecommendation>('/api/recommendations/model',{method:'POST',body:JSON.stringify(request)})
