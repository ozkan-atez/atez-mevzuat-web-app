import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getActorContext } from '../../src/platform/actor-context'
import { withJobActor, WorkerAuthorizationError } from '../../src/platform/worker-actor'

afterEach(() => vi.unstubAllEnvs())
const database = (role: string | null) => ({
  externalIdentity: { findFirst: vi.fn(async ({where}: any) => ({ id: `identity-${where.userId}`, userId: where.userId, issuer: 'https://identity.invalid/realms/atez', subject: where.userId })) },
  workspaceMembership: { findFirst: vi.fn(async () => role ? { role, permissions: [] } : null) },
}) as unknown as PrismaClient

describe('durable job authorization', () => {
  it('rejects a queued analysis after the initiator is demoted or loses membership', async () => {
    vi.stubEnv('OIDC_ISSUER_URL', 'https://identity.invalid/realms/atez')
    for (const role of ['VIEWER', null]) {
      const execute = vi.fn()
      await expect(withJobActor(database(role), {workspaceId:'atez',initiatorUserId:'alice'}, 'analysis.run', execute)).rejects.toBeInstanceOf(WorkerAuthorizationError)
      expect(execute).not.toHaveBeenCalled()
    }
  })
  it('rehydrates the initiator independently for concurrent worker jobs', async () => {
    vi.stubEnv('OIDC_ISSUER_URL', 'https://identity.invalid/realms/atez')
    const db = database('EDITOR')
    const results = await Promise.all(['alice','bob'].map(userId => withJobActor(db,{workspaceId:'atez',initiatorUserId:userId},'analysis.run',async()=>{
      await new Promise(resolve=>setTimeout(resolve,5))
      return getActorContext()?.userId
    })))
    expect(results).toEqual(['alice','bob'])
    expect(getActorContext()).toBeUndefined()
  })
  it('preserves executor errors without misclassifying them as authorization failures', async () => {
    vi.stubEnv('OIDC_ISSUER_URL', 'https://identity.invalid/realms/atez')
    const failure = new Error('provider unavailable')
    await expect(withJobActor(database('EDITOR'),{workspaceId:'atez',initiatorUserId:'alice'},'analysis.run',async()=>{throw failure})).rejects.toBe(failure)
  })
})
