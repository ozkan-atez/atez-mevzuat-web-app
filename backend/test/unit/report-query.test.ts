import { DateTime } from 'luxon'
import { describe, expect, it, vi } from 'vitest'
import { answerReportQuery } from '../../src/modules/chat/application/report-query'
import type { AssistantKnowledge } from '../../src/modules/chat/application/assistant-knowledge'
const now = DateTime.fromISO('2026-10-10T00:30:00+03:00')
function database() {
  return { searchReports: vi.fn().mockResolvedValue([{ title: '–– İthalat Tebliği', gazetteDate: '2026-10-10', version: 2, summary: 'Kayıtlı özet', reportUrl: '/reports/t1?revision=2' }]), listScanRuns: vi.fn().mockResolvedValue([{ runId: 'run1', status: 'COMPLETED', documents: 18, relevantDocuments: 1, reports: 1 }]) }
}
describe('provider-independent report queries', () => {
  it('answers the screenshot request from actual records using the Istanbul calendar day', async () => {
    const db = database()
    const answer = await answerReportQuery('bugüne ait raporları inceler misin neler çıkmış', db as unknown as AssistantKnowledge, now)
    expect(db.searchReports).toHaveBeenCalledWith({ from: '2026-10-10', to: '2026-10-10', limit: 20 })
    expect(answer).toContain('Kayıtlı özet'); expect(answer).toContain('[Bülteni aç](/reports/t1?revision=2)')
    expect(answer).not.toContain('––')
    expect(answer).toContain('[Taramayı incele](/runs/run1)')
  })
  it('does not claim there were no changes when analysis has failed', async () => {
    const db = database(); db.searchReports.mockResolvedValue([]); db.listScanRuns.mockResolvedValue([{ runId: 'run1', status: 'AWAITING_RETRY', documents: 18, relevantDocuments: 0, reports: 0 }])
    const answer = await answerReportQuery('bugünkü raporları göster', db as unknown as AssistantKnowledge, now)
    expect(answer).toContain('Yeniden deneme bekliyor')
    expect(answer).toContain('mevzuat değişikliği olmadığı anlamına gelmez')
  })
  it('resolves yesterday across a calendar boundary and ignores editing requests', async () => {
    const db = database()
    await answerReportQuery('dünkü raporları göster', db as unknown as AssistantKnowledge, now)
    expect(db.searchReports).toHaveBeenCalledWith({ from: '2026-10-09', to: '2026-10-09', limit: 20 })
    expect(await answerReportQuery('son raporu düzenle', db as unknown as AssistantKnowledge, now)).toBeNull()
  })
  it('answers scan status without reading report content or starting any new scan', async () => {
    const db = database()
    const answer = await answerReportQuery('bugünkü taramalar ne durumda', db as unknown as AssistantKnowledge, now)
    expect(db.searchReports).not.toHaveBeenCalled()
    expect(db.listScanRuns).toHaveBeenCalledWith({ date: '2026-10-10', limit: 10 })
    expect(answer).toContain('/runs/run1')
  })

})
