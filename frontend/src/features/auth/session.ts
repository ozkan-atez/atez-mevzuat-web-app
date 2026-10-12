export interface AuthSession {
  user: { id: string; email: string; name: string | null }
  workspace: { id: string; name: string }
  role: 'ADMIN' | 'EDITOR' | 'VIEWER'
  permissions: string[]
  csrfToken: string
}
export type AuthFailure = { status: 401 | 403 | 503; message: string }
let currentSession: AuthSession | null = null
const listeners = new Set<(failure: AuthFailure) => void>()
export function getSessionMemory() { return currentSession }
export function setSessionMemory(session: AuthSession | null) { currentSession = session }
export function subscribeAuthFailures(listener: (failure: AuthFailure) => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function reportAuthFailure(failure: AuthFailure) { if (failure.status === 401) currentSession = null; for (const listener of listeners) listener(failure) }
export const authMessages = { 401: 'Oturumunuz sona erdi. Devam etmek için yeniden giriş yapın.', 403: 'Bu işlem için yetkiniz bulunmuyor.', 503: 'Giriş hizmetine şu anda ulaşılamıyor. Biraz sonra yeniden deneyin.' }
export class AuthRequestError extends Error { readonly status:number; constructor(status: number, message: string) { super(message); this.status=status; this.name = 'AuthRequestError' } }
