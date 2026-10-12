import { AuthRequestError, authMessages, getSessionMemory, reportAuthFailure } from '../features/auth/session'
function headerRecord(headers?: HeadersInit): Record<string,string> {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return { ...headers }
}
export function prepareSessionRequest(input: RequestInfo | URL, init: RequestInit = {}): RequestInit {
  const target = new URL(input instanceof Request ? input.url : String(input), window.location.origin)
  if (target.origin !== window.location.origin) throw new AuthRequestError(400, 'Uygulama isteği aynı adrese gönderilmelidir.')
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const headers = headerRecord(init.headers ?? (input instanceof Request ? input.headers : undefined))
  for (const key of Object.keys(headers)) if (['authorization','x-csrf-token'].includes(key.toLowerCase())) delete headers[key]
  if (!['GET','HEAD','OPTIONS'].includes(method)) {
    const token = getSessionMemory()?.csrfToken
    if (!token) { reportAuthFailure({ status:401,message:authMessages[401] }); throw new AuthRequestError(401,authMessages[401]) }
    headers['X-CSRF-Token'] = token
  }
  return { ...init, credentials:'same-origin', headers }
}
/** One request only: POST, SSE and uploads retain caller cancellation and idempotency. */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}, options: { notifyAuth?: boolean } = {}): Promise<Response> {
  const response = await fetch(input, prepareSessionRequest(input,init))
  let authUnavailable = false
  if(response.status === 503) { const body = await response.clone().json().catch(()=>({})) as {code?:string;category?:string}; authUnavailable = /AUTH|SESSION|OIDC/.test(String(body.code??body.category??'')) }
  if (options.notifyAuth !== false && ([401,403].includes(response.status) || authUnavailable)) {
    const status = response.status as 401|403|503
    const failure = {status,message:authMessages[status]}
    reportAuthFailure(failure)
    throw new AuthRequestError(status,failure.message)
  }
  if (response.redirected && new URL(response.url,window.location.origin).pathname.startsWith('/api/auth/')) {
    const failure = {status:401 as const,message:authMessages[401]}; reportAuthFailure(failure); throw new AuthRequestError(401,failure.message)
  }
  return response
}
