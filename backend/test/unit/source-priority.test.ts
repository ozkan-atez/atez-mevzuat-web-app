import { describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { sourcePriority } from '../../src/modules/managed-sources/source-priority'

describe('source priority', () => {
  it('places official sources before professional and commercial references', async () => {
    const prisma = { sourceEndpoint: { findMany: async () => [
      { managedSourceId: 'commercial', url: 'https://commercial.example/', source: { authorityType: 'COMMERCIAL' } },
      { managedSourceId: 'official', url: 'https://official.example/', source: { authorityType: 'OFFICIAL' } },
      { managedSourceId: 'professional', url: 'https://professional.example/', source: { authorityType: 'PROFESSIONAL' } },
    ] } } as unknown as PrismaClient
    const ranks = await sourcePriority(prisma, [
      { id: 'commercial', url: 'https://commercial.example/' },
      { id: 'official', url: 'https://official.example/' },
      { id: 'professional', url: 'https://professional.example/' },
    ])
    expect(ranks.get('official')).toBeLessThan(ranks.get('professional')!)
    expect(ranks.get('professional')).toBeLessThan(ranks.get('commercial')!)
  })

  it('does not keep official rank after the linked page URL changes', async () => {
    const prisma = { sourceEndpoint: { findMany: async () => [
      { managedSourceId: 'changed', url: 'https://official.example/', source: { authorityType: 'OFFICIAL' } },
    ] } } as unknown as PrismaClient
    const ranks = await sourcePriority(prisma, [{ id: 'changed', url: 'https://other.example/' }])
    expect(ranks.has('changed')).toBe(false)
  })
})
