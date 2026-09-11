export class ApiError extends Error {
  constructor(message:string,readonly status:number,readonly correlationId:string|null){super(message);this.name='ApiError'}
}

function formatDetail(detail:unknown):string{
  if(typeof detail==='string')return detail
  if(Array.isArray(detail))return detail.map(item=>{
    if(typeof item!=='object'||item===null)return String(item)
    const value=item as {loc?:unknown[];msg?:unknown}
    const field=value.loc?.filter(part=>part!=='body').join(' → ')
    return `${field?`${field}: `:''}${String(value.msg??'Invalid value')}`
  }).join('; ')
  if(typeof detail==='object'&&detail!==null)return JSON.stringify(detail)
  return String(detail)
}

export async function api<T>(path:string,init:RequestInit={method:'GET'}):Promise<T>{
  let response:Response
  try{
    response=await fetch(path,{...init,headers:{'Content-Type':'application/json',...init.headers}})
  }catch{
    throw new ApiError('The API is unavailable. Confirm that the backend is running on port 3001.',0,null)
  }
  const correlationId=response.headers.get('X-Correlation-ID')
  let body:unknown
  try{body=await response.json()}catch{throw new ApiError(`The API returned an invalid response (${response.status}).`,response.status,correlationId)}
  if(!response.ok){
    const detail=typeof body==='object'&&body!==null&&'detail' in body?formatDetail(body.detail):`API returned ${response.status}`
    throw new ApiError(`${detail}${correlationId?` [Correlation ID: ${correlationId}]`:''}`,response.status,correlationId)
  }
  return body as T
}
