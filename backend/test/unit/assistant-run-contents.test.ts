import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { PrismaAssistantKnowledge } from '../../src/modules/chat/infrastructure/prisma-assistant-knowledge'
import { runChatTool } from '../../src/modules/chat/application/chat-tools'

describe('run contents for the chat assistant', () => {
  it('links a no-change report and returns only documents that passed the filter', async () => {
    const findUnique = vi.fn(async () => ({
      id: 'run-1', targetDate: new Date('2026-09-21T00:00:00Z'), status: 'COMPLETED',
      topicReports: [{ id: 'report-1', title: 'Değişiklik Yok', topic: null, revisions: [{ version: 1, status: 'VALIDATED' }] }],
      editions: [{ indexUrl: 'https://www.resmigazete.gov.tr/21.09.2026', documents: [
        { id: 'doc-1', title: 'Gümrük Tebliği', sourceUrl: 'https://www.resmigazete.gov.tr/teblig.htm', filterDecisions: [{ id: 'decision-1' }] },
        { id: 'doc-2', title: 'İlgisiz Karar', sourceUrl: 'https://www.resmigazete.gov.tr/karar.htm', filterDecisions: [] },
      ] }],
    }))
    const prisma = { scanRun: { findUnique } } as unknown as PrismaClient
    const knowledge = new PrismaAssistantKnowledge(prisma, { getContent: async () => Buffer.alloc(0) })

    const result = await runChatTool('tarama_icerigi_getir', { runId: 'run-1' }, knowledge) as { calisma: {
      reports: Array<{ reportUrl: string }>
      relevantDocuments: Array<{ sourceUrl: string }>
      totalDocuments: number
    } }

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'run-1' } }))
    expect(result.calisma.reports[0]?.reportUrl).toBe('/runs/run-1/reports/report-1')
    expect(result.calisma.relevantDocuments).toEqual([{ documentId: 'doc-1', title: 'Gümrük Tebliği', sourceUrl: 'https://www.resmigazete.gov.tr/teblig.htm' }])
    expect(result.calisma.totalDocuments).toBe(2)
  })
})
