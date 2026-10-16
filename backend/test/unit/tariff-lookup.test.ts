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

  it('queries only the selected date for a snapshot, never substitutes an earlier value', async () => {
    const urls: string[] = []
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url)
      if (url.includes('login.singlewindow')) return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }))
      if (url.includes('/mcp')) return new Response('{}', { status: 404 })
      return new Response(JSON.stringify({ measures: [measure('5,500 USD', '2026-08-10')] }))
    }) as unknown as typeof fetch
    const result = await new SingleWindowTariffLookup({ username: 'u', password: 'p' }, fetcher).lookup({ code: '691090000000', date: '2026-07-10', compare: false })
    expect(result.comparisons).toEqual([])
    expect(urls.filter(url => url.includes('queryDate='))).toHaveLength(1)
    expect(result.notes.join(' ')).toContain('sıfır')
  })

  it('keeps surveillance values after large unrelated results and skips automatic comparisons', async () => {
    const surveillance = { typeCode: 'TRC057', typeName: 'Gözetim', origin: '1011', current: parseTariffMeasures({ measures: [measure('4,500.00 USD / 1000 kg', '2026-01-30')] }), previous: null, previousDate: null, status: 'unknown' as const }
    const lookup = { lookup: vi.fn(async () => ({ code: '691090000000', date: '2026-07-10', description: null, source: 'https://tariff.singlewindow.io/', fetchedAt: '', classification: 'SUPPORTING_NON_AUTHORITATIVE' as const,
      comparisons: [{ ...surveillance, typeCode: 'OTHER', typeName: 'x'.repeat(30000) }, surveillance], notes: [] })) }
    const result = await runChatTool('gtip_tariff_sorgula', { gtip: '6910.90', tarih: '2026-07-10' }, {} as AssistantKnowledge, { tariffLookup: lookup, userContent: 'birim gümrük kıymetini öğrenmek istiyorum' })
    expect(lookup.lookup).toHaveBeenCalledWith({ code: '691090000000', date: '2026-07-10', compare: false })
    expect(JSON.stringify(result).length).toBeLessThan(24000)
    expect(result).toMatchObject({ comparisons: [surveillance] })
  })

  it.each(['691010000000', '691090000000'])('keeps July and August validity boundaries for %s', async (code) => {
    const requests: string[] = []
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('login.singlewindow')) return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }))
      if (url.includes('/mcp')) return new Response('{}', { status: 404 })
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer token' })
      requests.push(new URL(url).searchParams.get('queryDate')!)
      // The provider can include both historical and future rows in one response.
      return new Response(JSON.stringify({ measures: [
        measure('4,500.00 USD / 1000 kg', '2026-01-30', '2026-08-09'),
        measure('5,500.00 USD / 1000 kg', '2026-08-10'),
      ] }))
    }) as unknown as typeof fetch
    const lookup = new SingleWindowTariffLookup({ username: 'u', password: 'p' }, fetcher)
    for (const date of ['2026-07-10', '2026-07-12', '2026-08-09', '2026-08-10']) {
      const result = await lookup.lookup({ code, date, compare: false })
      expect(result.comparisons).toHaveLength(1)
      expect(result.comparisons[0]!.current).toHaveLength(1)
      expect(result.comparisons[0]!.current[0]!.value).toBe(date === '2026-08-10' ? '5,500.00 USD / 1000 kg' : '4,500.00 USD / 1000 kg')
    }
    expect(requests).toEqual(['2026-07-10', '2026-07-12', '2026-08-09', '2026-08-10'])
  })

  it.each([undefined, 'birim_gumruk_kiymeti'])('does not pass authenticated API links to chat (%s)', async (alan) => {
    const lookup = { lookup: vi.fn(async () => ({ code: '691090000000', date: '2026-07-12', description: null,
      source: 'https://tariff.singlewindow.io/api/v2-0/tariff-query/tariff-measures-by-commodity?queryDate=2026-07-12',
      fetchedAt: '', classification: 'SUPPORTING_NON_AUTHORITATIVE' as const, comparisons: [], notes: [] })) }
    const result = await runChatTool('gtip_tariff_sorgula', { gtip: '6910.90', tarih: '2026-07-12', ...(alan ? { alan } : {}) }, {} as AssistantKnowledge, { tariffLookup: lookup })
    expect(result).toMatchObject({ source: 'Tariff (yetkilendirilmiş sorgu)', date: '2026-07-12' })
    expect(JSON.stringify(result)).not.toContain('https://tariff.singlewindow.io/api/')
  })

  it('offers the same lookup to chat without exposing credentials', async () => {
    const lookup = { lookup: vi.fn(async () => ({ code: '691090000000', date: '2026-09-23', description: null, source: 'https://tariff.singlewindow.io/', fetchedAt: '2026-09-23T00:00:00Z', classification: 'SUPPORTING_NON_AUTHORITATIVE' as const, comparisons: [], notes: [] })) }
    await runChatTool('gtip_tariff_sorgula', { gtip: '6910.90', tarih: '2026-09-23', mense: 'CN' }, {} as AssistantKnowledge, { tariffLookup: lookup })
    expect(lookup.lookup).toHaveBeenCalledWith({ code: '691090000000', date: '2026-09-23', origin: 'CN' })
  })
})
