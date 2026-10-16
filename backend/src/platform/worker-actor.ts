import type { PrismaClient } from '@prisma/client'
import { hasPermission, permissionsForRole, resolveActorContext, runWithActorContext, type ActorContext } from './actor-context'
export class WorkerAuthorizationError extends Error {}

/** Jobs carry identifiers only. Authorization is resolved again from current membership. */
export async function withJobActor<T>(db: PrismaClient, input: { workspaceId?: string | null; initiatorUserId?: string | null }, permission: string, action: () => Promise<T>): Promise<T> {
  if (!input.initiatorUserId) return action() // Historical/cron jobs already run under the explicit service actor.
  if (!input.workspaceId) throw new WorkerAuthorizationError('İşin çalışma alanı doğrulanamadı.')
  const issuer = process.env.OIDC_ISSUER_URL
  if (!issuer) throw new WorkerAuthorizationError('İşin kimlik sağlayıcısı yapılandırılmamış.')
  const identity = await db.externalIdentity.findFirst({ where: { userId: input.initiatorUserId, issuer, user: { isActive: true } } })
  const actor = identity ? await resolveActorContext(db, { userId: input.initiatorUserId, identityId: identity.id, workspaceId: input.workspaceId }) : null
  if (!actor || !hasPermission(actor,permission)) throw new WorkerAuthorizationError('İşi başlatan kullanıcının geçerli işlem yetkisi bulunmuyor.')
  return runWithActorContext(actor, action)
}

export async function workerServiceActor(db: PrismaClient): Promise<ActorContext> {
  if (process.env.AUTH_PROFILE === 'company' && !process.env.WORKER_ACTOR_USER_ID) throw new Error('Şirket otomasyon servis aktörü açıkça yapılandırılmalıdır.')
  const workspace = await db.workspace.findUnique({ where: { key: process.env.AUTH_WORKSPACE_KEY ?? 'atez' } })
  const user = await db.user.findUnique({ where: { id: process.env.WORKER_ACTOR_USER_ID ?? 'a7e20000-1000-4000-8000-000000000005' } })
  if (!workspace || !user?.isActive) throw new Error('Otomasyon servis aktörü açıkça yapılandırılmalıdır.')
  return { userId: user.id, workspaceId: workspace.id, identityId: 'service-cron', issuer: 'urn:atez:service', subject: user.id, role: 'EDITOR', permissions: permissionsForRole('EDITOR'), serviceActor: true }
}
