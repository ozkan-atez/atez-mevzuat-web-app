import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { PrismaAssistantKnowledge } from '../../src/modules/chat/infrastructure/prisma-assistant-knowledge'

describe('assistant report search', () => {
  it('searches beyond the first hundred newest reports', async () => {
    const reports = Array.from({ length: 145 }, (_, index) => ({
      id: `report-${index}`, topicId: `topic-${index}`, scanRunId: `run-${index}`,
      revisions: [{ version: 1, createdAt: new Date('2026-09-21'), specObjectKey: `spec-${index}` }],
    }))
    const findMany = vi.fn(async ({ skip, take }: { skip: number; take: number }) => reports.slice(skip, skip + take))
    const spec = (index: number) => ({
      schemaVersion: 1, templateFamily: 'bulten-v2', reportId: '210926-01', topicId: '123e4567-e89b-42d3-a456-426614174000', card: 'K1',
      documentTitle: 'İthalat Kararı', issueNumber: '33377', displayDate: '21 Eylül 2026', typeLabel: 'Karar',
      title: index === 120 ? 'Aranan eski gümrük kararı' : 'Günlük karar', documentNumber: '1',
      summary: 'Özet', affectedParties: [], dates: [], note: null,
      source: { label: 'Resmî Gazete', url: 'https://www.resmigazete.gov.tr/' }, blocks: ['B1'],
    })
    const knowledge = new PrismaAssistantKnowledge({ topicReport: { findMany } } as unknown as PrismaClient, {
      getContent: async (key) => Buffer.from(JSON.stringify(spec(Number(key.slice(5))))),
    })
    const result = await knowledge.searchReports({ query: 'eski gümrük', limit: 5 })
    expect(result).toMatchObject([{ reportId: 'report-120', title: 'Aranan eski gümrük kararı' }])
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 100, take: 100 }))
  })
})
