import { z } from 'zod'

/**
 * İş yalnızca kimlik taşır; yetki iş başında yeniden doğrulanır (Ek B.2, actor-context).
 * Keycloak bağlanana kadar `userId` null olabilir (sistem işleri).
 */
export const Actor = z.object({
  kind: z.enum(['system', 'user']),
  workspaceId: z.string().min(1),
  userId: z.string().min(1).nullable(),
})
export type Actor = z.infer<typeof Actor>

export const SYSTEM_ACTOR: Actor = { kind: 'system', workspaceId: 'default', userId: null }
