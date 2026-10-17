// Docker yerel profili: Keycloak test hesaplarını uygulama kullanıcısı + çalışma alanı üyeliği olarak
// bağlar (idempotent; mevcut roller korunur). Yalnızca AUTH_PROFILE=local ve atez-docker realm'inde çalışır.
const fs = require('node:fs')
const { PrismaClient } = require('@prisma/client')

if (process.env.AUTH_PROFILE !== 'local' || !/\/realms\/atez-docker$/.test(process.env.OIDC_ISSUER_URL ?? '')) {
  console.log('Docker yerel kimlik profili değil; provisioning atlandı.')
  process.exit(0)
}
const users = JSON.parse(fs.readFileSync('/auth/users.json', 'utf8'))
const db = new PrismaClient()
async function provision() {
  const workspace = await db.workspace.upsert({ where: { key: 'atez' }, create: { id: 'a7e2d000-2000-4000-8000-000000000001', key: 'atez', name: 'ATEZ Ekibi' }, update: {} })
  await db.user.upsert({ where: { id: 'a7e2d000-1000-4000-8000-000000000009' }, create: { id: 'a7e2d000-1000-4000-8000-000000000009', email: 'service-cron@docker.atez.invalid', name: 'Otomasyon servisi', role: 'VIEWER' }, update: {} })
  for (const u of users) {
    await db.$transaction(async (tx) => {
      await tx.user.upsert({ where: { id: u.userId }, create: { id: u.userId, email: u.email, name: `Docker ${u.username}`, role: u.role }, update: {} })
      const identity = await tx.externalIdentity.upsert({ where: { issuer_subject: { issuer: process.env.OIDC_ISSUER_URL, subject: u.subject } }, create: { issuer: process.env.OIDC_ISSUER_URL, subject: u.subject, userId: u.userId }, update: {} })
      if (identity.userId !== u.userId) throw new Error('Subject başka kullanıcıya bağlı.')
      await tx.workspaceMembership.upsert({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: u.userId } }, create: { workspaceId: workspace.id, userId: u.userId, role: u.role, permissions: u.role === 'ADMIN' ? ['delivery.send'] : [] }, update: {} })
    })
  }
  console.log('Docker ADMIN / EDITOR / VIEWER hesapları uygulamaya bağlandı.')
}
provision().catch(() => { console.error('Docker kimlik provisioning başarısız.'); process.exitCode = 1 }).finally(() => db.$disconnect())
