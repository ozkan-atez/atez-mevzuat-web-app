import { describe, expect, it, vi } from 'vitest'
import { DateTime } from 'luxon'
import { resolveTurkishDate } from '../../src/modules/chat/application/resolve-date'
import { answerWorkspaceQuery } from '../../src/modules/chat/application/workspace-query'
import type { AssistantKnowledge } from '../../src/modules/chat/application/assistant-knowledge'

const now = DateTime.fromISO('2026-10-11T23:30:00', { zone: 'Europe/Istanbul' })
describe('shared Turkish date and automation queries', () => {
  it('resolves Turkish dates without rollover or future implied year', () => {
    expect(resolveTurkishDate('12 Ekim raporları', now)).toEqual({ date: '2025-10-12' })
    expect(resolveTurkishDate('28 Şubat 2026 taraması', now)).toEqual({ date: '2026-02-28' })
    expect(resolveTurkishDate('31.02.2026', now)).toHaveProperty('error')
    expect(resolveTurkishDate('dünkü belgeler', now)).toEqual({ date: '2026-10-10' })
    expect(resolveTurkishDate('bugünün raporları', now)).toEqual({ date: '2026-10-11' })
  })
  it('answers step errors from stored data without invoking AI or creating a scan', async () => {
    const listAutomations = vi.fn().mockResolvedValue([{ id: 'a', name: 'Günlük', isActive: true, times: ['08:00'], timezone: 'Europe/Istanbul', lastError: null, runs: [{ runId: 'r', targetDate: '2026-10-10', status: 'FAILED', errorSummary: null, stages: [{ stage: 'FILTER', source: 'Tariff', status: 'FAILED', error: 'Google erişimi reddedildi.' }] }] }])
    const knowledge = { listAutomations } as unknown as AssistantKnowledge
    const answer = await answerWorkspaceQuery('10 Ekim 2026 otomasyonu neden çalışmadı?', knowledge)
    expect(listAutomations).toHaveBeenCalledWith({ date: '2026-10-10', limit: 20 })
    expect(answer).toContain('Tariff / FILTER')
    expect(answer).toContain('/runs/r')
    expect(answer).toContain('Google erişimi reddedildi.')
    expect(await answerWorkspaceQuery('otomasyonu başlat', knowledge)).toBeNull()
    expect(listAutomations).toHaveBeenCalledTimes(1)
  })
})
