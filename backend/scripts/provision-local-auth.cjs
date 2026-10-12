// Local fixture provisioning is explicit and independent of login callbacks.
// Existing users, disabled memberships, and changed roles are preserved on rerun.
const fs = require('node:fs')
const path = require('node:path')
const { PrismaClient } = require('@prisma/client')
const { parse } = require('dotenv')
const root = path.resolve(__dirname, '../..')
const config = parse(fs.readFileSync(path.join(root, '.local/auth/auth.env')))
if (config.AUTH_PROFILE !== 'local' || config.OIDC_ISSUER_URL !== 'http://localhost:45881/realms/atez-web-local') throw new Error('Local auth fixture configuration required.')
const target = process.env.DATABASE_URL
if (!target) throw new Error('Explicit DATABASE_URL required.')
const dbUrl = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname) || !['5432','45432'].includes(dbUrl.port) || (dbUrl.pathname !== '/atez_db' && !dbUrl.pathname.endsWith('_test'))) throw new Error('Only the application localhost database or an explicit isolated test database is allowed.')
const accounts = JSON.parse(fs.readFileSync(path.join(root, '.local/auth/accounts.json'), 'utf8'))
const db = new PrismaClient()
async function provision() {
  const workspace = await db.workspace.upsert({ where: { key: 'atez' }, create: { id: 'a7e20000-2000-4000-8000-000000000001', key: 'atez', name: 'ATEZ Ekibi' }, update: {} })
  // A cron principal has no Keycloak identity or browser login credentials.
  await db.user.upsert({ where: { id: 'a7e20000-1000-4000-8000-000000000005' }, create: { id: 'a7e20000-1000-4000-8000-000000000005', email: 'service-cron@local.atez.invalid', name: 'Otomasyon servisi', role: 'VIEWER' }, update: {} })
  for (const account of accounts) {
    if (account.username === 'outsider') continue
    await db.$transaction(async tx => {
      await tx.user.upsert({ where: { id: account.userId }, create: { id: account.userId, email: account.email, name: `Yerel ${account.username}`, role: account.role }, update: {} })
      const identity = await tx.externalIdentity.upsert({ where: { issuer_subject: { issuer: config.OIDC_ISSUER_URL, subject: account.subject } }, create: { issuer: config.OIDC_ISSUER_URL, subject: account.subject, userId: account.userId }, update: {} })
      if (identity.userId !== account.userId) throw new Error('Existing subject binding differs; explicit review required.')
      await tx.workspaceMembership.upsert({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: account.userId } }, create: { workspaceId: workspace.id, userId: account.userId, role: account.role, permissions: account.role === 'ADMIN' ? ['delivery.send'] : [] }, update: {} })
    })
  }
  console.log('Local ADMIN, EDITOR and VIEWER identities explicitly provisioned. Outsider has no membership. Existing roles were preserved.')
}
provision().catch(() => { console.error('Local provisioning failed; no credentials or database URL were logged.'); process.exitCode = 1 }).finally(() => db.$disconnect())
