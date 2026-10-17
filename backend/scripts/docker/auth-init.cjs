// Docker yerel profili için Keycloak realm'i, test hesapları ve oturum ayarlarını bir kez üretir.
// Çıktı /out (host'ta .local/docker-auth, Git'e girmez) içine yazılır; varsa korunur. Sır yazdırmaz.
const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')

const out = process.env.AUTH_OUT_DIR ?? '/out'
const webPort = process.env.WEB_PORT ?? '8890'
const keycloakPort = process.env.KEYCLOAK_PORT ?? '48080'
const file = path.join(out, 'auth.env')
fs.mkdirSync(path.join(out, 'realm'), { recursive: true })
if (fs.existsSync(file)) {
  console.log('Docker kimlik ayarları zaten var; hesaplar ve anahtarlar korundu.')
  process.exit(0)
}
const secret = () => randomBytes(32).toString('hex')
const origin = `http://localhost:${webPort}`
const config = {
  AUTH_PROFILE: 'local',
  APP_PUBLIC_ORIGIN: origin,
  OIDC_ISSUER_URL: `http://localhost:${keycloakPort}/realms/atez-docker`,
  OIDC_CLIENT_ID: 'atez-mevzuat-web',
  OIDC_CLIENT_SECRET: secret(),
  OIDC_REDIRECT_URI: `${origin}/api/auth/callback`,
  OIDC_POST_LOGOUT_REDIRECT_URI: `${origin}/login`,
  SESSION_ENCRYPTION_KEY: secret(),
  SESSION_IDLE_TTL_SECONDS: '1800',
  SESSION_ABSOLUTE_TTL_SECONDS: '28800',
  AUTH_WORKSPACE_KEY: 'atez',
}
const users = ['admin', 'editor', 'viewer'].map((username, index) => ({
  username,
  subject: `a7e2d000-0000-4000-8000-00000000000${index + 1}`,
  userId: `a7e2d000-1000-4000-8000-00000000000${index + 1}`,
  password: randomBytes(9).toString('base64url'),
  email: `${username}@docker.atez.invalid`,
  role: username === 'admin' ? 'ADMIN' : username === 'editor' ? 'EDITOR' : 'VIEWER',
}))
const realm = {
  realm: 'atez-docker', enabled: true, sslRequired: 'none', registrationAllowed: false, resetPasswordAllowed: false,
  accessTokenLifespan: 300, ssoSessionIdleTimeout: 1800, revokeRefreshToken: true, refreshTokenMaxReuse: 0,
  clients: [{
    clientId: config.OIDC_CLIENT_ID, secret: config.OIDC_CLIENT_SECRET, publicClient: false,
    standardFlowEnabled: true, implicitFlowEnabled: false, directAccessGrantsEnabled: false,
    redirectUris: [config.OIDC_REDIRECT_URI], webOrigins: [origin],
    attributes: { 'post.logout.redirect.uris': config.OIDC_POST_LOGOUT_REDIRECT_URI, 'pkce.code.challenge.method': 'S256' },
  }],
  users: users.map((u) => ({
    id: u.subject, username: u.username, enabled: true, emailVerified: true, firstName: u.username, lastName: 'Docker', email: u.email,
    credentials: [{ type: 'password', value: u.password, temporary: false }],
  })),
}
// Keycloak container'ı (uid 1000) okuyabilsin diye realm 0644; dizin Git dışı ve yalnızca yerel.
fs.writeFileSync(path.join(out, 'realm', 'atez-docker.json'), JSON.stringify(realm, null, 2), { mode: 0o644 })
fs.writeFileSync(path.join(out, 'accounts.json'), JSON.stringify(users.map(({ username, password, role }) => ({ username, password, role })), null, 2), { mode: 0o600 })
fs.writeFileSync(path.join(out, 'users.json'), JSON.stringify(users.map(({ password, ...u }) => u), null, 2), { mode: 0o644 })
fs.writeFileSync(file, Object.entries(config).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o644 })
console.log('Docker Keycloak realm ve test hesapları oluşturuldu (.local/docker-auth/accounts.json).')
