import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'

const prisma = new PrismaClient()
const repository = new PrismaScanRepository(prisma)

describe('manual scan persistence', () => {
  beforeAll(async () => {
    await prisma.scanOutbox.deleteMany()
    await prisma.scanRun.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('returns one run and one outbox row for the same request key', async () => {
    const input = { requestKey: '55a7f2ac-2f19-4e1b-b46d-3ca1f1be3d42', targetDate: '2026-07-11' }
    const first = await repository.createManualRun(input)
    const second = await repository.createManualRun(input)

    expect(second.id).toBe(first.id)
    expect(first.targetDate).toBe('2026-07-11')
    expect(await prisma.scanOutbox.count({ where: { scanRunId: first.id } })).toBe(1)
  })

  it('claims only available undispatched outbox rows', async () => {
    const run = await repository.createManualRun({
      requestKey: 'bb6e266d-da15-4706-9983-fba8528f4585',
      targetDate: '2026-07-12',
    })

    const claimed = await repository.claimPendingOutbox(10)

    expect(claimed.some((row) => row.scanRunId === run.id)).toBe(true)
  })

  it('leases an outbox command to only one concurrent dispatcher', async () => {
    const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-09-11' })
    const [first, second] = await Promise.all([repository.claimPendingOutbox(10), repository.claimPendingOutbox(10)])
    expect([...first, ...second].filter((row) => row.scanRunId === run.id)).toHaveLength(1)
  })

  it('persists repeated discovery delivery idempotently', async () => {
    const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-09-11' })
    const editions = [{ type: 'MAIN' as const, supplementNo: null, indexUrl: 'https://example.test/index', discoveryOrder: 0, documents: [{ title: 'Tebliğ', sourceUrl: 'https://example.test/doc', publicationOrder: 0 }] }]
    await repository.saveEditions(run.id, run.targetDate, editions)
    await repository.saveEditions(run.id, run.targetDate, editions)
    expect(await prisma.gazetteEdition.count({ where: { scanRunId: run.id } })).toBe(1)
    expect(await prisma.collectedDocument.count({ where: { edition: { scanRunId: run.id } } })).toBe(1)
  })
})
