import { fileURLToPath } from 'node:url'
import { and, eq, sql } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AiGateway, DEFAULT_AI_CONFIG, FakeProvider, MemoryObjectStore, ProviderError, schema, type ProviderRequest } from '@atez/platform'
import { RecipeRegistry } from '@atez/engine'
import { startHarness, type Harness } from '@atez/engine/testing'
import { DocumentProfileV1 } from '@atez/contracts'
import { TariffClient } from '@atez/modules'
import { buildStepRegistry, type StepDeps } from '../src/index'
import { FakeRg, fx } from './helpers'

const CONFIG = fileURLToPath(new URL('../../../config', import.meta.url))
const { aiCall, document, documentProfile, workItem, runStep } = schema

/** Sahte Gemini: başlık elemesi ve profil yanıtları. */
function fakeGemini(failOnce: Set<string>) {
  return (req: ProviderRequest) => {
    if (req.system?.includes('başlıklarını ön eleyen')) {
      const first = req.parts[0] as { text: string }
      const list = JSON.parse(first.text.slice(first.text.indexOf('\n') + 1)) as { id: string; title: string }[]
      return {
        items: list.map((t) => ({
          id: t.id,
          decision: /Ulusal Meslek|İhale|Yargı|Anayasa/.test(t.title) ? 'OUT' : /İthalat|Haksız|Gümrük/.test(t.title) ? 'IN' : 'MAYBE',
          reason: 'test',
        })),
      }
    }
    const instruction = (req.parts.at(-1) as { text: string }).text
    const title = instruction.match(/"başlık": "([^"]+)"/)?.[1] ?? ''
    for (const marker of failOnce) {
      if (title.includes(marker)) {
        failOnce.delete(marker)
        return new ProviderError('model reddetti (test)', false, 400)
      }
    }
    const hasHtml = req.parts.some((p) => 'text' in p && p.text.startsWith('<!doctype html>'))
    return {
      decision: /İthalat|Haksız/.test(title) ? 'IN' : 'OUT',
      coverage: { expected: { files: 1, pages: null, tables: 0 }, read: { files: 1, pages: null, tables: 0 }, complete: true },
      basisQuotes: hasHtml ? [{ quote: 'İthalatta Haksız Rekabetin Önlenmesine', file: 'f1', page: null }] : [],
      relevance: { score: 0.7, categories: ['ithalat'] },
      rationale: 'Madde 1 (test).',
      identity: { docType: 'TEBLIG', title, institution: null, officialNumber: null },
      summary: 'Test özeti.',
      change: { kind: 'NEW', effectiveRules: [{ rule: 'ON_PUBLICATION', explicitDate: null, days: null, scope: null, evidencePage: null }] },
      gtip: { present: false, codes: [], tables: [] },
      references: [],
      lineage: { needsPrior: false, strategyHint: 'NONE', rgQueries: [], tariffQueries: [] },
      affected: { parties: [], sectors: [] },
      keyPages: [],
      keywords: [],
      confidence: 0.6,
    }
  }
}

describe('Aşama 2: RG çekirdeği (sahte RG + sahte Gemini, gerçek kuyruk)', () => {
  let h: Harness<StepDeps>
  let rg: FakeRg
  const store = new MemoryObjectStore()
  const failOnce = new Set<string>(['İslam, Bilim ve Teknoloji'])

  beforeAll(async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage().drawText('Orta Vadeli Program (test)')
    rg = new FakeRg(Buffer.from(await pdf.save()))
    h = await startHarness<StepDeps>({
      steps: buildStepRegistry(),
      deps: (db) => ({ db, store, http: rg, configDir: CONFIG, ai: new AiGateway(db, new FakeProvider(fakeGemini(failOnce)), DEFAULT_AI_CONFIG), tariff: new TariffClient(db, store, null) }),
      recipes: RecipeRegistry.fromDir(`${CONFIG}/recipes`),
      pools: ['io', 'doc', 'ai-lite', 'ai-main'],
    })
  })
  afterAll(async () => h?.stop())

  const aiCalls = async () => (await h.db.db.select({ n: sql<number>`count(*)::int` }).from(aiCall))[0]!.n
  const nodeItems = (runId: string, nodeId: string) => h.db.db.select().from(workItem).where(and(eq(workItem.runId, runId), eq(workItem.nodeId, nodeId)))

  it('06.09.2026 ilk tarama: başlık elemesi, indirme, profil; tek hata run\'ı durdurmaz', async () => {
    const runId = await h.start('rg-daily-profile', { date: '2026-09-06' })
    expect(await h.waitForRun(runId)).toBe('COMPLETED_WITH_ERRORS')
    const [discover] = await nodeItems(runId, 'discover')
    expect((discover!.output as { counts: unknown }).counts).toEqual({ listed: 7, new: 7, pending: 0, skipped: 0 })
    const title = (await nodeItems(runId, 'title'))[0]!.output as { items: { decision: string; by: string; candidate: { title: string } }[] }
    expect(title.items.find((i) => i.candidate.title.includes('Merkez Bankasınca'))).toMatchObject({ decision: 'OUT', by: 'RULE' })
    expect(title.items.filter((i) => i.decision !== 'OUT')).toHaveLength(3)
    const steps = await h.db.db.select().from(runStep).where(eq(runStep.runId, runId))
    expect(steps.find((s) => s.nodeId === 'fetch')).toMatchObject({ total: 3, succeeded: 3, skipped: 4 })
    expect(steps.find((s) => s.nodeId === 'profile')).toMatchObject({ total: 3, succeeded: 2, failed: 1 })
    expect(await aiCalls()).toBe(4) // 1 başlık (toplu) + 3 profil (biri reddedildi)

    // Profil hem MinIO'da (tam JSON) hem DB'de (sorgulanabilir alanlar)
    const profiles = await h.db.db.select().from(documentProfile)
    expect(profiles).toHaveLength(2)
    const stored = DocumentProfileV1.parse(JSON.parse((await store.get(profiles[0]!.objectKey)).toString()))
    expect(stored.identity.publication).toMatchObject({ date: '2026-09-06' })
    // 31.12.2025-9 HTML fixture'ı üzerinde alıntı birebir doğrulandı
    const htmlProfile = profiles.map((p) => DocumentProfileV1.parse(JSON.parse(store.objects.get(p.objectKey)!.body.toString()))).find((p) => p.quoteCheck.checked > 0)
    expect(htmlProfile?.quoteCheck.status).toBe('VERIFIED')
  })

  it('ikinci çalıştırma: yalnızca yarım kalan belge işlenir (başlık yeniden sorulmaz, 304, normalize önbellekten)', async () => {
    rg.reset()
    const before = await aiCalls()
    const runId = await h.start('rg-daily-profile', { date: '2026-09-06' })
    expect(await h.waitForRun(runId)).toBe('COMPLETED')
    const discover = (await nodeItems(runId, 'discover'))[0]!.output as { precheck: { status: string }; counts: unknown }
    expect(discover.precheck.status).toBe('NO_CHANGE')
    expect(discover.counts).toEqual({ listed: 7, new: 0, pending: 1, skipped: 6 })
    const [fetch] = await nodeItems(runId, 'fetch')
    expect((fetch!.output as { delta: string }).delta).toBe('SAME')
    expect(rg.requests.find((r) => r.url.endsWith('.htm'))?.etag).toBeTruthy()
    expect((await nodeItems(runId, 'normalize'))[0]!.outcome).toBe('FROM_CACHE')
    expect(await aiCalls()).toBe(before + 1) // yalnızca o belgenin profili
  })

  it('üçüncü çalıştırma: değişiklik yok → tek istek, sıfır AI çağrısı', async () => {
    rg.reset()
    const before = await aiCalls()
    const runId = await h.start('rg-daily-profile', { date: '2026-09-06' })
    expect(await h.waitForRun(runId)).toBe('COMPLETED')
    expect(rg.requests.map((r) => r.url)).toEqual(['https://www.resmigazete.gov.tr/06.09.2026'])
    expect(await aiCalls()).toBe(before)
    expect(await nodeItems(runId, 'title')).toHaveLength(0)
  })

  it('31.12.2025: rozet 5 → 6 olduğunda yalnızca yeni mükerrer fihristi okunur', async () => {
    const real = fx('day-2025-12-31.html').toString('utf8')
    const five = real
      .replace('<span class="badge badge-light ml-2">6</span>', '<span class="badge badge-light ml-2">5</span>')
      .replace(/<a class="dropdown-item small"[^>]*mukerrer=6"[^>]*>[^<]*<\/a>/, '')
    rg.dayOverride.set('2025-12-31', Buffer.from(five))
    const first = await h.start('rg-daily-profile', { date: '2025-12-31' })
    expect(await h.waitForRun(first, 120_000)).toMatch(/^COMPLETED/)
    const firstDiscover = (await nodeItems(first, 'discover'))[0]!.output as { precheck: { editions: unknown[] } }
    expect(firstDiscover.precheck.editions).toHaveLength(6) // ana sayı + 5 mükerrer

    rg.dayOverride.delete('2025-12-31')
    rg.reset()
    const second = await h.start('rg-daily-profile', { date: '2025-12-31' })
    expect(await h.waitForRun(second, 120_000)).toMatch(/^COMPLETED/)
    const fihrists = rg.requests.filter((r) => r.url.includes('/fihrist'))
    expect(fihrists.map((r) => new URL(r.url).searchParams.get('mukerrer'))).toEqual(['6'])
    const d = (await nodeItems(second, 'discover'))[0]!.output as { precheck: { status: string }; candidates: { listContext: { mukerrer: number | null } }[] }
    expect(d.precheck.status).toBe('CHANGED')
    expect(d.candidates.length).toBeGreaterThan(0)
    expect(d.candidates.every((c) => c.listContext.mukerrer === 6)).toBe(true)
    const docs = await h.db.db.select({ n: sql<number>`count(*)::int` }).from(document).where(eq(document.publishedOn, '2025-12-31'))
    expect(docs[0]!.n).toBeGreaterThan(100)
  })
})
