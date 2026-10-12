import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTariffToken } from '../../src/modules/managed-sources/tariff-auth'
import { inForceOn, normalizeGtip, parseTariffMeasures, SingleWindowTariffLookup } from '../../src/modules/tariff/tariff-lookup'
import { runChatTool } from '../../src/modules/chat/application/chat-tools'
import type { AssistantKnowledge } from '../../src/modules/chat/application/assistant-knowledge'

function measure(value: string, from: string, to = '4000-01-01') {
  return { measureType: { measure_type_code: 'TRC057', measure_type_description: 'Gözetim' }, base_duty_formatted: value,
    effective_start_date: from, effective_end_date: to, areaDetails: { geographical_area_code: 'CN' },
    legalActViews: [{ regulation_url: 'https://www.resmigazete.gov.tr/example.htm' }], conditions: [] }
}

beforeEach(() => clearTariffToken())

describe('Tariff GTİP lookup', () => {
  it('normalizes the code and filters future rows even when the API includes them', () => {
    expect(normalizeGtip('6910.90')).toBe('691090000000')
    expect(() => normalizeGtip('21.09.2026')).toThrow()
    expect(() => normalizeGtip('6910901')).toThrow()
    expect(inForceOn(parseTariffMeasures({ measures: [measure('5,500 USD', '2026-08-10')] }), '2026-08-09')).toEqual([])
  })

  it('gets product name and compares the same measure and origin with its previous day', async () => {
    const requested: string[] = []
    const fetcher = vi.fn(async (url: string) => {
      requested.push(url)
      if (url.includes('login.singlewindow')) return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 })
      if (url.includes('/api/v1-0/mcp')) return new Response(JSON.stringify({ result: { content: [{ text: JSON.stringify({ success: true, data: { description: 'Seramik lavabo' } }) }] } }), { status: 200 })
      const date = new URL(url).searchParams.get('queryDate')
      return new Response(JSON.stringify({ measures: date === '2026-08-09'
        ? [measure('4,500 USD', '2026-01-01', '2026-08-09'), measure('4,500 USD', '2026-08-10')]
        : [measure('5,500 USD', '2026-08-10')] }), { status: 200 })
    }) as unknown as typeof fetch
    const lookup = new SingleWindowTariffLookup({ username: 'user', password: 'secret' }, fetcher)
    const result = await lookup.lookup({ code: '6910.90', date: '2026-09-23', origin: 'CN' })
    expect(result.description).toBe('Seramik lavabo')
    expect(result.comparisons[0]).toMatchObject({ status: 'changed', previousDate: '2026-08-09', current: [{ value: '5,500 USD' }], previous: [{ value: '4,500 USD' }] })
    expect(requested.some((url) => url.includes('queryDate=2026-08-09'))).toBe(true)
    expect(result.classification).toBe('SUPPORTING_NON_AUTHORITATIVE')
  })

  it('detects a measure withdrawn on the selected day', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('login.singlewindow')) return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 })
      if (url.includes('/api/v1-0/mcp')) return new Response('{}', { status: 404 })
      const date = new URL(url).searchParams.get('queryDate')
      return new Response(JSON.stringify({ measures: date === '2026-09-22' ? [measure('4,500 USD', '2026-01-01', '2026-09-22')] : [] }), { status: 200 })
    }) as unknown as typeof fetch
    const result = await new SingleWindowTariffLookup({ username: 'user', password: 'secret' }, fetcher).lookup({ code: '691090000000', date: '2026-09-23' })
    expect(result.comparisons[0]).toMatchObject({ status: 'withdrawn', previousDate: '2026-09-22' })
  })

  it('offers the same lookup to chat without exposing credentials', async () => {
    const lookup = { lookup: vi.fn(async () => ({ code: '691090000000', date: '2026-09-23', description: null, source: 'https://tariff.singlewindow.io/', fetchedAt: '2026-09-23T00:00:00Z', classification: 'SUPPORTING_NON_AUTHORITATIVE' as const, comparisons: [], notes: [] })) }
    await runChatTool('gtip_tariff_sorgula', { gtip: '6910.90', tarih: '2026-09-23', mense: 'CN' }, {} as AssistantKnowledge, { tariffLookup: lookup })
    expect(lookup.lookup).toHaveBeenCalledWith({ code: '691090000000', date: '2026-09-23', origin: 'CN' })
  })
})
