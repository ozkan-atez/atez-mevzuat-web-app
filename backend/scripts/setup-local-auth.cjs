const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const directory = path.join(root, '.local/auth')
fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
fs.chmodSync(path.join(root, '.local'), 0o700)
fs.chmodSync(directory, 0o700)
const file = path.join(directory, 'auth.env')
if (fs.existsSync(file)) {
  console.log('Yerel Keycloak ayarları zaten var; hesap ve anahtarlar korundu.')
  process.exit(0)
}
const secret = () => randomBytes(32).toString('hex')
const config = {
  AUTH_PROFILE: 'local', APP_PUBLIC_ORIGIN: 'http://localhost:5173',
  OIDC_ISSUER_URL: 'http://localhost:45881/realms/atez-web-local',
  OIDC_CLIENT_ID: 'atez-mevzuat-web', OIDC_CLIENT_SECRET: secret(),
  OIDC_REDIRECT_URI: 'http://localhost:5173/api/auth/callback',
  OIDC_POST_LOGOUT_REDIRECT_URI: 'http://localhost:5173/login',
  SESSION_ENCRYPTION_KEY: secret(), SESSION_IDLE_TTL_SECONDS: '1800', SESSION_ABSOLUTE_TTL_SECONDS: '28800',
  AUTH_WORKSPACE_KEY: 'atez', AUTH_DB_PASSWORD: secret(), KC_ADMIN_PASSWORD: secret(),
  AUTH_RELAY_KEY: secret(),
}
const users = ['admin', 'editor', 'viewer', 'outsider'].map((username, index) => ({
  username, subject: `a7e20000-0000-4000-8000-00000000000${index + 1}`,
  userId: `a7e20000-1000-4000-8000-00000000000${index + 1}`, password: secret(),
  email: `${username}@local.atez.invalid`, role: username === 'admin' ? 'ADMIN' : username === 'editor' ? 'EDITOR' : 'VIEWER',
}))
const realm = {
  realm: 'atez-web-local', enabled: true, sslRequired: 'none', registrationAllowed: false,
  resetPasswordAllowed: false, accessTokenLifespan: 300, ssoSessionIdleTimeout: 1800,
  revokeRefreshToken: true, refreshTokenMaxReuse: 0,
  clients: [{ clientId: config.OIDC_CLIENT_ID, secret: config.OIDC_CLIENT_SECRET, publicClient: false,
    standardFlowEnabled: true, implicitFlowEnabled: false, directAccessGrantsEnabled: false,
    redirectUris: [config.OIDC_REDIRECT_URI], webOrigins: [config.APP_PUBLIC_ORIGIN],
    attributes: { 'post.logout.redirect.uris': config.OIDC_POST_LOGOUT_REDIRECT_URI,
      'pkce.code.challenge.method': 'S256',
      'backchannel.logout.url': 'http://backchannel:8080/api/auth/backchannel-logout',
      'backchannel.logout.session.required': 'true' } }],
  users: users.map(user => ({ id: user.subject, username: user.username, enabled: true, emailVerified: true,
    firstName: user.username, lastName: 'Yerel', email: user.email,
    credentials: [{ type: 'password', value: user.password, temporary: false }] })),
}
fs.writeFileSync(path.join(directory, 'realm.json'), JSON.stringify(realm, null, 2), { mode: 0o600 })
fs.writeFileSync(path.join(directory, 'accounts.json'), JSON.stringify(users, null, 2), { mode: 0o600 })
fs.writeFileSync(file, Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 })
console.log('Yerel Keycloak realm ve test hesapları oluşturuldu; secret değerleri yalnız .local/auth/ içinde saklandı.')
