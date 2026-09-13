import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'

const prisma = new PrismaClient()
const repository = new PrismaScanRepository(prisma)

describe('scan run HTTP contract', () => {
  beforeEach(() => prisma.scanRun.deleteMany())
  afterAll(() => prisma.$disconnect())

  it('accepts a valid manual scan and returns 202', async () => {
    const app = await buildApp({ scanRepository: repository })
    const response = await app.inject({
      method: 'POST', url: '/api/v1/scan-runs',
      headers: { 'idempotency-key': '55a7f2ac-2f19-4e1b-b46d-3ca1f1be3d42' },
      payload: { trigger: 'MANUAL', targetDate: '2026-07-11' },
    })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({ status: 'QUEUED', targetDate: '2026-07-11' })
    await app.close()
  })

  it('rejects an invalid calendar date', async () => {
    const app = await buildApp({ scanRepository: repository })
    const response = await app.inject({
      method: 'POST', url: '/api/v1/scan-runs',
      headers: { 'idempotency-key': crypto.randomUUID() },
      payload: { trigger: 'MANUAL', targetDate: '2026-02-30' },
    })
    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('returns a safe 404 for an unknown run', async () => {
    const app = await buildApp({ scanRepository: repository })
    const response = await app.inject({ method: 'GET', url: `/api/v1/scan-runs/${crypto.randomUUID()}` })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Tarama bulunamadı' })
    await app.close()
  })
})
