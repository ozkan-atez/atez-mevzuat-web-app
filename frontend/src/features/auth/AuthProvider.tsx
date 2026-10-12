import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { apiFetch } from '../../lib/apiFetch'
import { AuthRequestError, authMessages, setSessionMemory, subscribeAuthFailures, type AuthSession } from './session'
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'forbidden' | 'unavailable'
export interface AuthState {
  status: AuthStatus; session: AuthSession | null; error: string | null; expired: boolean
  can: (permission: string) => boolean; reload: () => Promise<void>; logout: () => Promise<void>; clearForbidden: () => void
}
export const AuthContext = createContext<AuthState | null>(null)
export function useAuth(): AuthState { const state=useContext(AuthContext); if(!state) throw new Error('AuthProvider gerekli.'); return state }
export function useCan(permission: string) { return useAuth().can(permission) }
function validSession(value: unknown): value is AuthSession {
  const candidate = value as Partial<AuthSession> | null
  return !!candidate?.user?.id && !!candidate?.workspace?.id && ['ADMIN','EDITOR','VIEWER'].includes(String(candidate.role)) && Array.isArray(candidate.permissions) && candidate.permissions.every(permission=>typeof permission==='string') && typeof candidate.csrfToken==='string' && candidate.csrfToken.length>0
}
export function AuthProvider({ children }: {children:ReactNode}) {
  const [status,setStatus]=useState<AuthStatus>('loading'),[session,setSession]=useState<AuthSession|null>(null),[error,setError]=useState<string|null>(null),[expired,setExpired]=useState(false)
  const request=useRef<AbortController|null>(null)
  const generation=useRef(0)
  const reload=useCallback(async()=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;const attempt=++generation.current
    setStatus('loading');setError(null)
    try {
      const response=await apiFetch('/api/auth/me',{signal:controller.signal},{notifyAuth:false})
      if(controller.signal.aborted||attempt!==generation.current)return
      if(response.status===401){setSessionMemory(null);setSession(null);setStatus('anonymous');return}
      if(response.status===403){setSessionMemory(null);setSession(null);setStatus('forbidden');setError('Bu çalışma alanına erişim yetkiniz yok.');return}
      if(!response.ok)throw new AuthRequestError(response.status,authMessages[503])
      const next:unknown=await response.json();if(!validSession(next))throw new Error(authMessages[503])
      if(controller.signal.aborted||attempt!==generation.current)return
      setSessionMemory(next);setSession(next);setStatus('authenticated');setExpired(false)
    }catch(e){if(controller.signal.aborted||attempt!==generation.current)return;setSessionMemory(null);setSession(null);setStatus('unavailable');setError(e instanceof AuthRequestError?e.message:authMessages[503])}
  },[])
  useEffect(()=>{void reload();return()=>{generation.current++;request.current?.abort();setSessionMemory(null)}},[reload])
  useEffect(()=>subscribeAuthFailures(failure=>{
    generation.current++;request.current?.abort();setError(failure.message)
    if(failure.status===401){setSession(null);setStatus('anonymous');setExpired(true)}else if(failure.status===403)setStatus('forbidden');else setStatus('unavailable')
  }),[])
  const logout=useCallback(async()=>{
    const response=await apiFetch('/api/auth/logout',{method:'POST'},{notifyAuth:false})
    if(!response.ok&&response.status!==401)throw new AuthRequestError(response.status,'Çıkış tamamlanamadı. Yeniden deneyin.')
    const result=await response.json().catch(()=>({})) as {logoutUrl?:string}
    generation.current++;request.current?.abort();setSessionMemory(null);setSession(null);setStatus('anonymous');setExpired(false)
    if(typeof result.logoutUrl==='string'){const target=new URL(result.logoutUrl,window.location.origin);if(['http:','https:'].includes(target.protocol))window.location.assign(target.href)}
  },[])
  const can=useCallback((permission:string)=>!!session&&session.permissions.includes(permission),[session])
  return <AuthContext.Provider value={{status,session,error,expired,can,reload,logout,clearForbidden:()=>{setError(null);setStatus(session?'authenticated':'anonymous')}}}>{children}</AuthContext.Provider>
}
