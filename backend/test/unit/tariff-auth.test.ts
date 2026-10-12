import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTariffToken, getTariffAccessToken, tariffCredentialsFromEnv } from '../../src/modules/managed-sources/tariff-auth'

beforeEach(() => clearTariffToken())

describe('TARIFF account login', () => {
  it('keeps an incomplete or disabled account unavailable', () => {
    expect(tariffCredentialsFromEnv({ TARIFF_ENABLED: 'false', TARIFF_USERNAME: 'user@example.test', TARIFF_PASSWORD: 'placeholder' } as NodeJS.ProcessEnv)).toBeNull()
    expect(tariffCredentialsFromEnv({ TARIFF_ENABLED: 'true', TARIFF_USERNAME: 'user@example.test' } as NodeJS.ProcessEnv)).toBeNull()
  })

  it('posts a form to the verified public Keycloak client and caches the token', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_in: 300 }), { status: 200 })) as unknown as typeof fetch
    const credentials = { username: 'user@example.test', password: 'placeholder' }
    expect(await getTariffAccessToken(credentials, fetcher)).toBe('test-access-token')
    expect(await getTariffAccessToken(credentials, fetcher)).toBe('test-access-token')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, options] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://login.singlewindow.io/auth/realms/agsw/protocol/openid-connect/token')
    expect(new URLSearchParams(options.body as string).get('grant_type')).toBe('password')
    expect(new URLSearchParams(options.body as string).get('client_id')).toBe('tarife')
  })

  it('isolates concurrent sessions for different accounts',async()=>{
    const fetcher=vi.fn(async(_url:unknown,options?:RequestInit)=>{
      const user=new URLSearchParams(options?.body as string).get('username')
      await new Promise(resolve=>setTimeout(resolve,user==='alice'?15:1))
      return new Response(JSON.stringify({access_token:`token-${user}`,expires_in:300}),{status:200})
    }) as unknown as typeof fetch
    const [a,b,a2]=await Promise.all([getTariffAccessToken({username:'alice',password:'a'},fetcher),getTariffAccessToken({username:'bob',password:'b'},fetcher),getTariffAccessToken({username:'alice',password:'a'},fetcher)])
    expect([a,b,a2]).toEqual(['token-alice','token-bob','token-alice']);expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('classifies rejected credentials without returning the provider body', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error_description: 'internal detail' }), { status: 400 })) as unknown as typeof fetch
    await expect(getTariffAccessToken({ username: 'user@example.test', password: 'placeholder' }, fetcher)).rejects.toThrow('TARIFF kullanıcı adı veya şifresi kabul edilmedi.')
  })
})
