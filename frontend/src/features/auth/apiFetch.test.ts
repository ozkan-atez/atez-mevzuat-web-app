import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../../lib/apiFetch'
import { api } from '../../lib/api'
import { setSessionMemory, subscribeAuthFailures } from './session'
import { testSession } from '../../test/auth-fixture'
beforeEach(()=>setSessionMemory(testSession))
afterEach(()=>{vi.unstubAllGlobals();setSessionMemory(null)})
describe('session request transport',()=>{
  it('preserves SSE body, abort and idempotency while replacing bearer with csrf',async()=>{
    const signal=new AbortController().signal
    const fetcher=vi.fn(async()=>new Response('data: {}\n\n'));vi.stubGlobal('fetch',fetcher)
    await apiFetch('/api/v1/chat/messages',{method:'POST',signal,body:'{"content":"Sor"}',headers:{'Content-Type':'application/json','Idempotency-Key':'once','Authorization':'Bearer old'}})
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/v1/chat/messages',{method:'POST',signal,body:'{"content":"Sor"}',credentials:'same-origin',headers:{'Content-Type':'application/json','Idempotency-Key':'once','X-CSRF-Token':'test-csrf'}})
  })
  it('strips a caller bearer even when it was the only GET header',async()=>{
    const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response('{}'));vi.stubGlobal('fetch',fetcher)
    await apiFetch('/api/v1/reports',{headers:{Authorization:'Bearer never-forward'}})
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({})
  })
  it('keeps multipart boundaries browser generated',async()=>{
    const body=new FormData();body.append('file',new File(['metin'],'doc.txt'))
    const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response('{}'));vi.stubGlobal('fetch',fetcher)
    await apiFetch('/api/v1/documents/uploads',{method:'POST',body,headers:{'Idempotency-Key':'upload'}})
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(body)
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({'Idempotency-Key':'upload','X-CSRF-Token':'test-csrf'})
  })
  it('does not perform an unprotected mutation when the session is missing',async()=>{
    setSessionMemory(null);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    await expect(apiFetch('/api/v1/documents',{method:'POST'})).rejects.toMatchObject({status:401})
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('reports auth failures once without retrying a POST or consuming business 503 details',async()=>{
    const failed=vi.fn(),unsubscribe=subscribeAuthFailures(failed)
    const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:403})).mockResolvedValueOnce(new Response(JSON.stringify({message:'Gemini kapalı'}),{status:503})).mockResolvedValueOnce(new Response(JSON.stringify({category:'AUTH_SERVICE_UNAVAILABLE'}),{status:503}))
    vi.stubGlobal('fetch',fetcher)
    await expect(apiFetch('/api/v1/operations',{method:'POST'})).rejects.toMatchObject({status:403})
    const business=await apiFetch('/api/v1/chat',{method:'POST'});expect(await business.json()).toEqual({message:'Gemini kapalı'})
    await expect(apiFetch('/api/v1/operations')).rejects.toMatchObject({status:503})
    expect(fetcher).toHaveBeenCalledTimes(3);expect(failed).toHaveBeenCalledTimes(2);unsubscribe()
  })
  it('never forwards csrf or browser credentials to another origin',async()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    await expect(apiFetch('https://outside.example/api',{method:'POST'})).rejects.toMatchObject({status:400})
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('uses the same session contract for Axios without a mock Authorization header',async()=>{
    const original=api.defaults.adapter
    const adapter=vi.fn(async(config)=>({data:{},status:200,statusText:'OK',headers:{},config}))
    api.defaults.adapter=adapter
    try{await api.post('/v1/documents',{});const config=adapter.mock.calls[0]![0];expect(config.headers.get('X-CSRF-Token')).toBe('test-csrf');expect(config.headers.has('Authorization')).toBe(false);expect(config.withCredentials).toBe(true)}finally{api.defaults.adapter=original}
  })
})
