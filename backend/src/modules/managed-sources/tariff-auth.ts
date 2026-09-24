// TARIFF's public Keycloak configuration currently identifies this realm and
// public client. Credentials and tokens never enter reports or API responses.
const tokenUrl = 'https://login.singlewindow.io/auth/realms/agsw/protocol/openid-connect/token'
const clientId = 'tarife'

export interface TariffCredentials { username: string; password: string }
interface TokenState { accessToken: string; refreshToken: string | null; expiresAt: number }
let current: TokenState | null = null
let pending: Promise<string> | null = null

export function tariffCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): TariffCredentials | null {
  if (env.TARIFF_ENABLED !== 'true') return null
  const username = env.TARIFF_USERNAME?.trim()
  const password = env.TARIFF_PASSWORD
  return username && password ? { username, password } : null
}

export function clearTariffToken(): void { current = null }

export async function getTariffAccessToken(credentials: TariffCredentials, fetcher: typeof fetch = fetch): Promise<string> {
  if (current && current.expiresAt > Date.now() + 30_000) return current.accessToken
  if (pending) return pending
  pending = requestToken(credentials, fetcher).finally(() => { pending = null })
  return pending
}

async function requestToken(credentials: TariffCredentials, fetcher: typeof fetch): Promise<string> {
  const form = new URLSearchParams({
    client_id: clientId,
    grant_type: current?.refreshToken ? 'refresh_token' : 'password',
    ...(current?.refreshToken ? { refresh_token: current.refreshToken } : { username: credentials.username, password: credentials.password }),
  })
  let response = await fetcher(tokenUrl, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(), redirect: 'error', signal: AbortSignal.timeout(12_000),
  })
  // A refresh token can expire while the worker is idle; try the configured
  // credentials once, without emitting the provider's response body to logs.
  if (!response.ok && current?.refreshToken) {
    current = null
    response = await fetcher(tokenUrl, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, grant_type: 'password', username: credentials.username, password: credentials.password }).toString(),
      redirect: 'error', signal: AbortSignal.timeout(12_000),
    })
  }
  if (!response.ok) throw new Error(response.status === 400 || response.status === 401
    ? 'TARIFF kullanıcı adı veya şifresi kabul edilmedi.' : `TARIFF oturumu açılamadı (${response.status}).`)
  if (Number(response.headers.get('content-length') ?? 0) > 8_000) throw new Error('TARIFF oturum yanıtı beklenenden büyük.')
  const body = await response.text()
  if (body.length > 8_000) throw new Error('TARIFF oturum yanıtı beklenenden büyük.')
  let payload: unknown
  try { payload = JSON.parse(body) } catch { throw new Error('TARIFF oturum yanıtı okunamadı.') }
  if (!payload || typeof payload !== 'object' || !('access_token' in payload) || typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new Error('TARIFF erişim belirteci alınamadı.')
  }
  const expiresIn = 'expires_in' in payload && typeof payload.expires_in === 'number' ? payload.expires_in : 60
  const refreshToken = 'refresh_token' in payload && typeof payload.refresh_token === 'string' ? payload.refresh_token : null
  current = { accessToken: payload.access_token, refreshToken, expiresAt: Date.now() + Math.max(1, expiresIn) * 1_000 }
  return current.accessToken
}
