import axios from 'axios'
import { prepareSessionRequest } from './apiFetch'
import { authMessages, reportAuthFailure } from '../features/auth/session'
export const api = axios.create({ baseURL:'/api',withCredentials:true })
api.interceptors.request.use(config=>{
  const prepared=prepareSessionRequest(config.url??'/api',{method:config.method,headers:config.headers.toJSON() as Record<string,string>})
  config.headers.clear()
  for(const [key,value] of Object.entries(prepared.headers??{}))config.headers.set(key,value)
  return config
})
api.interceptors.response.use(response=>response,error=>{
  const status=error.response?.status as 401|403|503|undefined
  if(status&&([401,403].includes(status)||(status===503&&/AUTH|SESSION|OIDC/.test(String(error.response?.data?.code??error.response?.data?.category??'')))))reportAuthFailure({status,message:authMessages[status]})
  return Promise.reject(error)
})
