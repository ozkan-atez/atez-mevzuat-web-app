import { describe, expect, it, vi } from 'vitest'
import { DispatchConflictError, PrismaDeliveryRepository } from '../../src/modules/delivery/infrastructure/prisma-delivery-repository'

const input = {
  topicId: 'topic-1', reportVersion: 1, requestKey: 'send-1', recipients: ['user@example.test'],
  groupIds: [], subject: 'Bülten', bodyHtml: '<p>Bülten</p>', attachmentName: null,
}

describe('delivery approval gate', () => {
  it('refuses mail while a report revision is awaiting approval', async () => {
    const tx = {
      reportDraft: { count: vi.fn().mockResolvedValue(1) },
      emailDispatch: { create: vi.fn() },
    }
    const prisma = { $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx) }
    const repository = new PrismaDeliveryRepository(prisma as never)
    await expect(repository.startDispatch(input)).rejects.toBeInstanceOf(DispatchConflictError)
    expect(tx.emailDispatch.create).not.toHaveBeenCalled()
  })

  it('allows mail after the revision has been approved or cancelled', async () => {
    const tx = {
      reportDraft: { count: vi.fn().mockResolvedValue(0) },
      emailDispatch: { create: vi.fn().mockResolvedValue({ id: 'dispatch-1' }) },
    }
    const prisma = { $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx) }
    const repository = new PrismaDeliveryRepository(prisma as never)
    expect(await repository.startDispatch(input)).toEqual({ id: 'dispatch-1' })
  })
})
