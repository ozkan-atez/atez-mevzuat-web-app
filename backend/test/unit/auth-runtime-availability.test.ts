import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { loadAuthConfig } from '../../src/modules/auth/config'
import { createAuthRuntime } from '../../src/modules/auth/runtime'
const discovery = vi.hoisted(() => vi.fn().mockRejectedValue(new Error('provider offline')))
vi.mock('../../src/modules/auth/provider', () => ({ createOidcProvider: discovery }))

describe('identity outage after API restart', () => {
  it('keeps local session services available without discovery and derives a token-free logout URL', async () => {
    const config = loadAuthConfig({ AUTH_PROFILE:'local', APP_PUBLIC_ORIGIN:'http://localhost:5173', OIDC_ISSUER_URL:'http://localhost:45881/realms/test', OIDC_CLIENT_ID:'app', OIDC_CLIENT_SECRET:'fixture-secret', OIDC_REDIRECT_URI:'http://localhost:5173/api/auth/callback', OIDC_POST_LOGOUT_REDIRECT_URI:'http://localhost:5173/login', SESSION_ENCRYPTION_KEY:'a'.repeat(64) })
    const runtime = await createAuthRuntime({ prisma: {} as PrismaClient, config })
    expect(discovery).not.toHaveBeenCalled()
    const logout = new URL(await runtime.provider.logoutUrl())
    expect(logout.pathname).toBe('/realms/test/protocol/openid-connect/logout')
    expect(logout.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:5173/login')
    expect(logout.searchParams.has('id_token_hint')).toBe(false)
    await expect(runtime.provider.authorizationUrl({state:'state',nonce:'nonce',verifier:'proof'})).rejects.toThrow('provider offline')
    expect(discovery).toHaveBeenCalledOnce()
    await expect(runtime.provider.authorizationUrl({state:'state',nonce:'nonce',verifier:'proof'})).rejects.toThrow('provider offline')
    expect(discovery).toHaveBeenCalledTimes(2)
  })
})
