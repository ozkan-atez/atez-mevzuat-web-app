import { describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../src/app'

describe('GET /api/health', () => {
  it('reports every required dependency as ready', async () => {
    const app = await buildApp({
      healthChecks: {
        database: vi.fn().mockResolvedValue(undefined),
        queue: vi.fn().mockResolvedValue(undefined),
        objectStore: vi.fn().mockResolvedValue(undefined),
      },
    })

    const response = await app.inject({ method: 'GET', url: '/api/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: 'ready',
      dependencies: { database: 'ready', queue: 'ready', objectStore: 'ready' },
    })
  })

  it('returns unavailable when a dependency cannot be reached', async () => {
    const app = await buildApp({
      healthChecks: {
        database: vi.fn().mockResolvedValue(undefined),
        queue: vi.fn().mockResolvedValue(undefined),
        objectStore: vi.fn().mockRejectedValue(new Error('S3 unavailable')),
      },
    })

    const response = await app.inject({ method: 'GET', url: '/api/health' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      status: 'unavailable',
      dependencies: { database: 'ready', queue: 'ready', objectStore: 'unavailable' },
    })
  })
})
