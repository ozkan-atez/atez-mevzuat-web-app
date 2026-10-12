import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
import { createSourceRun } from '../../src/modules/managed-sources/source-scan-run'
const prisma = new PrismaClient()
const repository = new PrismaScanRepository(prisma)
const runIds: string[] = []
const sourceIds: string[] = []
afterAll(async () => {
  await prisma.scanRun.deleteMany({ where: { id: { in: runIds } } })
  await prisma.sourceScanRun.deleteMany({ where: { sourceId: { in: sourceIds } } })
  await prisma.source.deleteMany({ where: { id: { in: sourceIds } } })
  await prisma.$disconnect()
})
describe('concurrent job creation', () => {
  it('creates exactly one manual run and outbox under concurrent retries', async () => {
    const requestKey = crypto.randomUUID()
    const runs = await Promise.all(Array.from({ length: 12 }, () => repository.createManualRun({ requestKey, targetDate: '2026-09-11' })))
    runIds.push(runs[0]!.id)
    expect(new Set(runs.map(run => run.id)).size).toBe(1)
    expect(await prisma.scanOutbox.count({ where: { scanRunId: runs[0]!.id } })).toBe(1)
  })
  it('creates cron source selection atomically and reuses the same scheduled run', async () => {
    const targetDate = '2026-08-19'
    const runs = await Promise.all(Array.from({ length: 12 }, () => repository.createScheduledRun({ targetDate, slotKey: 'ANA_SAYI', sourceKeys: ['igmd'] })))
    runIds.push(runs[0]!.id)
    expect(new Set(runs.map(run => run.id)).size).toBe(1)
    expect(runs.filter(run => run.created)).toHaveLength(1)
    expect((await prisma.scanRun.findUniqueOrThrow({ where: { id: runs[0]!.id }, include: { outbox: true } }))).toMatchObject({ sourceKeys: ['igmd'], outbox: [expect.anything()] })
  })
  it('creates exactly one standalone source job for concurrent requests', async () => {
    const source = await prisma.source.create({ data: { key: crypto.randomUUID(), name: 'fixture', baseUrl: 'https://example.com', authorityType: 'REFERENCE', endpoints: { create: { url: 'https://example.com/feed', title: 'fixture', status: 'ACTIVE', adapter: 'GENERIC' } } } })
    sourceIds.push(source.id)
    const requestKey = crypto.randomUUID()
    const runs = await Promise.all(Array.from({ length: 12 }, () => createSourceRun(prisma, { sourceId: source.id, targetDate: '2026-09-11', requestKey, trigger: 'MANUAL' })))
    expect(new Set(runs.map(run => run.id)).size).toBe(1)
  })
})
