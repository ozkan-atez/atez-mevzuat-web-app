import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { loadAuthConfig } from '../src/modules/auth/config'

// Explicit provisioning for company identities. No first-login/email association.
// Defaults to a read-only review; --apply is required to change membership.
const args = process.argv.slice(2)
const value = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const config = loadAuthConfig()
const input = z.object({ userId: z.uuid(), email: z.email(), name: z.string().min(1).max(200), subject: z.string().min(1).max(300), role: z.enum(['ADMIN','EDITOR','VIEWER']) }).parse({ userId: value('--user-id'), email: value('--email'), name: value('--name'), subject: value('--subject'), role: value('--role') })
const db = new PrismaClient()
async function provision() {
  const workspace = await db.workspace.findUnique({ where: { key: config.workspaceKey } })
  if (!workspace) throw new Error('Çalışma alanını önce açıkça oluşturun.')
  const identity = await db.externalIdentity.findUnique({ where: { issuer_subject: { issuer: config.issuer, subject: input.subject } } })
  if (identity && identity.userId !== input.userId) throw new Error('Subject farklı kullanıcıya bağlı; otomatik hesap birleştirme yapılmaz.')
  if (!args.includes('--apply')) { console.log(JSON.stringify({ mode: 'DRY_RUN', existingIdentity: Boolean(identity), role: input.role, workspaceKey: config.workspaceKey })); return }
  await db.$transaction(async tx => {
    await tx.user.upsert({ where: { id: input.userId }, create: { id: input.userId, email: input.email, name: input.name, role: input.role }, update: { email: input.email, name: input.name } })
    await tx.externalIdentity.upsert({ where: { issuer_subject: { issuer: config.issuer, subject: input.subject } }, create: { issuer: config.issuer, subject: input.subject, userId: input.userId }, update: {} })
    await tx.workspaceMembership.upsert({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: input.userId } }, create: { workspaceId: workspace.id, userId: input.userId, role: input.role, active: true }, update: { role: input.role, active: true, permissions: [] } })
    await tx.authSession.updateMany({ where: { userId: input.userId, workspaceId: workspace.id, revoked: false }, data: { revoked: true, revokedAt: new Date(), reason: 'PROVISIONING_CHANGED', encryptedTokens: null, version: { increment: 1 } } })
  })
  console.log('Kimlik bağlantısı ve üyelik açıkça güncellendi; önceki oturumlar iptal edildi.')
}
provision().catch(() => { console.error('Kimlik provision işlemi tamamlanamadı; yapılandırma, benzersiz email ve açık subject bağlantısını kontrol edin.'); process.exitCode = 1 }).finally(() => db.$disconnect())
