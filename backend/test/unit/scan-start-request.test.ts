import { DateTime } from 'luxon'
import { describe, expect, it, vi } from 'vitest'
import { requestedScanDate, scanStartRequestKey } from '../../src/modules/chat/application/scan-start-request'
import { runChatTool } from '../../src/modules/chat/application/chat-tools'
import type { AssistantKnowledge } from '../../src/modules/chat/application/assistant-knowledge'

const now = DateTime.fromISO('2026-09-21T12:00:00', { zone: 'Europe/Istanbul' })

describe('chat scan start authorization', () => {
  it('resolves the requested Turkish date in the current year', () => {
    expect(requestedScanDate("28 Temmuz'a ait rapor oluşturma işlemi başlat", now)).toBe('2026-07-28')
    expect(requestedScanDate('2026-07-28 tarihli taramayı çalıştır', now)).toBe('2026-07-28')
  })

  it('does not authorize lookup requests, invalid dates, or future dates', () => {
    expect(requestedScanDate('28 Temmuz raporunu göster', now)).toBeNull()
    expect(requestedScanDate('31 Şubat raporunu başlat', now)).toBeNull()
    expect(requestedScanDate('28 Aralık raporunu başlat', now)).toBeNull()
    expect(requestedScanDate('28 Temmuz taramasını başlatma', now)).toBeNull()
  })

  it('uses one stable idempotency key per chat message', () => {
    const key = scanStartRequestKey('session-1', 'message-1')
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(scanStartRequestKey('session-1', 'message-1')).toBe(key)
    expect(scanStartRequestKey('session-1', 'message-2')).not.toBe(key)
  })

  it('rejects a model-selected date different from the date the user authorized', async () => {
    const startRun = vi.fn()
    await expect(runChatTool('tarihli_tarama_baslat', { tarih: '2026-07-29' }, {} as AssistantKnowledge, {
      authorizedRun: { targetDate: '2026-07-28', requestKey: scanStartRequestKey('s', 'm') }, startRun,
    })).rejects.toThrow('açıkça bulunmuyor')
    expect(startRun).not.toHaveBeenCalled()
  })
})
