import { describe, expect, it, vi } from 'vitest'
import { checkReportDuplicates } from '../../src/modules/managed-sources/check-report-duplicates'

describe('report duplicate check', () => {
  it('keeps only model groups that reference known reports', async () => {
    const updates: Array<Record<string, unknown>> = []
    const prisma = {
      scanRun: {
        findUnique: vi.fn().mockResolvedValue({
          topicReports: [{ id: 'gazette-1', title: '41 Sayılı Karar', card: 'K1', topic: { document: { title: 'Biyogüvenlik Kurulunun 41 Sayılı Kararı', sourceUrl: 'https://resmigazete.gov.tr/41.pdf' } } }],
          sourceRuns: [{ id: 'source-1', reportHtml: '<html>', source: { name: 'Mevzuat.Net', key: 'mevzuat-net' }, documents: [{ title: '41 Sayılı Karar hakkında açıklama', url: 'https://mevzuat.net/41', contentText: 'Resmî Gazete kararının özeti' }] }],
        }),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { updates.push(data) }),
      },
    }
    const aiModel = { generateStructured: vi.fn().mockResolvedValue({ json: { groups: [
      { reportIds: ['report:gazette-1', 'source:source-1'], reason: 'Aynı 41 sayılı kararın aslı ve yorumu.' },
      { reportIds: ['report:gazette-1', 'invented'], reason: 'Geçersiz kimlik.' },
    ] }, providerRequestId: null, usage: { inputTokens: null, outputTokens: null } }) }

    await checkReportDuplicates(prisma as never, 'run-1', aiModel, 'gemini-test')

    expect(aiModel.generateStructured).toHaveBeenCalledOnce()
    expect(updates.at(-1)).toMatchObject({ reportDuplicateStatus: 'COMPLETED', reportDuplicateGroups: [{ reportIds: ['report:gazette-1', 'source:source-1'], reason: 'Aynı 41 sayılı kararın aslı ve yorumu.' }] })
  })
})
