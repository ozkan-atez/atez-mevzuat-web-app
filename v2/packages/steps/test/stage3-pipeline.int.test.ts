import { fileURLToPath } from 'node:url'
import { and, desc, eq, sql } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AnalysisV1, ReportSpecV2 } from '@atez/contracts'
import { RecipeRegistry } from '@atez/engine'
import { startHarness, type Harness } from '@atez/engine/testing'
import { ComponentService, TariffClient, TemplateService, type TariffApi } from '@atez/modules'
import { AiGateway, DEFAULT_AI_CONFIG, FakeProvider, MemoryObjectStore, PermanentError, schema, type ProviderRequest } from '@atez/platform'
import { buildStepRegistry, type StepDeps } from '../src/index'
import { FakeRg } from './helpers'

const CONFIG = fileURLToPath(new URL('../../../config', import.meta.url))
const { aiCall, report, reportRevision, workItem, documentRelation, gtipValue, resolutionAttempt } = schema

/** Sahte TARIFF API: Keycloak yok; kapatılınca kimlik bilgisi yokmuş gibi davranır. */
class FakeTariff implements TariffApi {
  enabled = true
  calls: { gtip: string; date: string }[] = []
  async fetchMeasures(gtip: string, queryDate: string) {
    if (!this.enabled) throw new PermanentError('TARIFF kimlik bilgisi yok', 'TARIFF_NO_CREDENTIALS')
    this.calls.push({ gtip, date: queryDate })
    const measures =
      gtip === '720851200011'
        ? [
            {
              id: 77,
              measureType: { measure_type_code: 'TR0201' },
              effective_start_date: '2024-01-01',
              effective_end_date: '4000-01-01',
              is_import: true,
              areaDetails: [{ geographical_area_code: 'CN' }],
              base_duty_formatted: '1,000.00 USD / 1000 kg',
              legalActViews: [{ regulation_code: '2018/5', regulation_url: 'https://www.resmigazete.gov.tr/eskiler/2018/01/x.htm' }],
            },
          ]
        : []
    return {
      url: `https://tariff.example/${gtip}?queryDate=${queryDate}`,
      raw: { measures, commodities: [{ commodity_code: gtip, declarable: true, commodity_start_date: '2000-01-01', commodity_end_date: null }] },
    }
  }
}

const marker = (req: ProviderRequest) => req.system ?? ''
const instruction = (req: ProviderRequest) => (req.parts.at(-1) as { text: string }).text

const composePrompts: string[] = []
function fakeGemini(req: ProviderRequest): unknown {
  const sys = marker(req)
  if (sys.includes('başlıklarını ön eleyen')) {
    const first = req.parts[0] as { text: string }
    const list = JSON.parse(first.text.slice(first.text.indexOf('\n') + 1)) as { id: string; title: string }[]
    return { items: list.map((t) => ({ id: t.id, decision: /Çeşitli/.test(t.title) ? 'IN' : 'OUT', reason: 'test' })) }
  }
  if (sys.includes('Belge Profili')) {
    const title = instruction(req).match(/"başlık": "([^"]+)"/)?.[1] ?? ''
    const prior = title.includes('2025/43')
    return {
      decision: 'IN',
      coverage: { expected: { files: 1, pages: null, tables: 1 }, read: { files: 1, pages: null, tables: 1 }, complete: true },
      basisQuotes: [{ quote: 'İthalatta Haksız Rekabetin Önlenmesine', file: 'f1', page: null }],
      relevance: { score: 0.9, categories: ['damping'] },
      rationale: 'Madde 1 (test).',
      identity: { docType: 'TEBLIG', title, institution: 'Ticaret Bakanlığı', officialNumber: prior ? '2025/43' : '2026/99' },
      summary: 'Test özeti.',
      change: { kind: prior ? 'NEW' : 'AMENDMENT', effectiveRules: [{ rule: 'ON_PUBLICATION', explicitDate: null, days: null, scope: null, evidencePage: null }] },
      gtip: { present: true, codes: [{ code: '7208.51', level: '6', context: 'ek', page: null }], tables: [{ title: 'EK-1', pages: [], approxRows: 2, columns: ['GTİP', 'Menşe', 'Değer'] }] },
      references: prior ? [] : [{ relation: 'AMENDS', targetTitle: 'İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ', targetNumber: '2025/43', targetType: 'TEBLIG', articles: ['Madde 1'] }],
      lineage: prior
        ? { needsPrior: false, strategyHint: 'NONE', rgQueries: [], tariffQueries: [] }
        : { needsPrior: true, strategyHint: 'TARIFF', rgQueries: ['İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ 2025/43'], tariffQueries: [{ code: '7208.51', field: 'DAMPING' }] },
      affected: { parties: ['ithalatçılar'], sectors: ['çelik'] },
      keyPages: [],
      keywords: ['damping'],
      confidence: 0.9,
    }
  }
  if (sys.includes('GTİP tablolarını satır satır')) {
    return {
      rows: [
        { gtip: '7208.51.20.00.11', description: 'Sıcak haddelenmiş sac', rawValue: '1.250,50', unit: 'ton', currency: 'ABD Doları', origin: 'CN', page: null },
        { gtip: '7208.51.20.00.12', description: 'Diğer sac', rawValue: '%15', unit: '%', currency: null, origin: null, page: null },
      ],
      rowCount: 2,
    }
  }
  if (sys.includes('önceki halini')) return { choice: 0, reason: 'test' }
  if (sys.includes('aynı mevzuat olayını')) return { topicIndex: null, reason: 'test' }
  if (sys.includes('dış ticaret mevzuatını analiz eden')) {
    return {
      summary: 'Damping önleminde değişiklik (test).',
      operationalImpact: 'Beyannamelerde yeni tutar uygulanır.',
      affected: { parties: ['ithalatçılar'], sectors: ['çelik'] },
      claims: [{ text: 'Tebliğ ithalatta haksız rekabetle ilgilidir.', evidence: [{ kind: 'DOCUMENT', ref: 'd1:f1', page: null, quote: 'İthalatta Haksız Rekabetin Önlenmesine' }] }],
      comparisonCommentary: 'Çin menşeli sacda tutar arttı.',
      exceptions: [],
    }
  }
  if (sys.includes('metin alanlarını yazan')) {
    composePrompts.push((req.parts[0] as { text: string }).text)
    const input = JSON.parse((req.parts[0] as { text: string }).text.split('\n\n')[0]!) as { bölümler: { sectionId: string; slots: { key: string; kind: string }[] }[] }
    return {
      headline: 'Sıcak haddelenmiş sacda damping tutarı değişti',
      sections: input.bölümler.map((b) => ({
        sectionId: b.sectionId,
        fields: b.slots.map((sl) => (sl.kind === 'list' ? { slot: sl.key, text: null, items: ['Değişiklik yayımı tarihinde yürürlüğe girdi.'] } : { slot: sl.key, text: 'Çin menşeli sacda önlem 1.250,5 ABD Doları/ton oldu.', items: null })),
      })),
    }
  }
  throw new Error(`beklenmeyen istem: ${sys.slice(0, 60)}`)
}

describe('Aşama 3: önceki hal, kümülatif analiz ve READY rapor (sahte RG/TARIFF/Gemini, gerçek kuyruk)', () => {
  let h: Harness<StepDeps>
  let rg: FakeRg
  const store = new MemoryObjectStore()
  const tariffApi = new FakeTariff()

  beforeAll(async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage().drawText('test')
    rg = new FakeRg(Buffer.from(await pdf.save()))
    rg.searchResults = (term) =>
      term.includes('Haksız Rekabet')
        ? [
            { konu: 'İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ (No: 2025/43)', mevzuatAdi: 'TEBLİĞLER', resmiGazeteSayisi: 33124, kanunKararNo: null, resmiGazeteTarihi: '2025-12-31T00:00:00', mukerrer: 'HAYIR', url: '/fihrist?tarih=2025-12-31' },
            { konu: 'İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ (No: 2025/4399)', mevzuatAdi: 'TEBLİĞLER', resmiGazeteSayisi: 33000, kanunKararNo: null, resmiGazeteTarihi: '2025-08-01T00:00:00', mukerrer: 'HAYIR', url: '/fihrist?tarih=2025-08-01' },
          ]
        : []
    h = await startHarness<StepDeps>({
      steps: buildStepRegistry(),
      deps: (db) => ({ db, store, http: rg, configDir: CONFIG, ai: new AiGateway(db, new FakeProvider(fakeGemini), DEFAULT_AI_CONFIG), tariff: new TariffClient(db, store, tariffApi) }),
      recipes: RecipeRegistry.fromDir(`${CONFIG}/recipes`),
      pools: ['io', 'doc', 'ai-lite', 'ai-main', 'render'],
    })
  })
  afterAll(async () => h?.stop())

  const aiCalls = async () => (await h.db.db.select({ n: sql<number>`count(*)::int` }).from(aiCall))[0]!.n
  const node = (runId: string, nodeId: string) => h.db.db.select().from(workItem).where(and(eq(workItem.runId, runId), eq(workItem.nodeId, nodeId)))
  const latestSpec = async () => {
    const [r] = await h.db.db.select().from(report)
    const [rev] = await h.db.db.select().from(reportRevision).where(eq(reportRevision.reportId, r!.id)).orderBy(desc(reportRevision.revision)).limit(1)
    const spec = ReportSpecV2.parse(JSON.parse((await store.get(rev!.specKey)).toString()))
    const [a] = await h.db.db.select().from(schema.analysis).where(eq(schema.analysis.id, spec.analysisId))
    const analysis = AnalysisV1.parse(JSON.parse((await store.get(a!.objectKey)).toString()))
    return { report: r!, rev: rev!, spec, analysis }
  }

  it('daily-scan: TARIFF önceki değeri (yayım − 1) ile karşılaştırma tablosu ve READY rapor', async () => {
    const runId = await h.start('daily-scan', { date: '2026-09-06' })
    expect(await h.waitForRun(runId, 60_000)).toBe('COMPLETED')
    // Kısa kod 7208.51 sıfırla doldurulmadı; belgedeki tam kodlar yayım − 1 günü için sorgulandı.
    expect(tariffApi.calls.map((c) => c.date)).toEqual(['2026-09-05', '2026-09-05'])
    expect(tariffApi.calls.map((c) => c.gtip).sort()).toEqual(['720851200011', '720851200012'])
    const [lineage] = await node(runId, 'lineage')
    expect(lineage!.output).toMatchObject({ status: 'FOUND', attempts: [{ strategy: 'TARIFF', status: 'FOUND' }] })
    const { report: r, spec, analysis } = await latestSpec()
    expect(r.status).toBe('READY')
    expect(spec.card).toBe('ORAN_TABLOSU')
    // Varsayılan şablon: bütün yerleşik bileşenler açık; görünme kurallarına göre bölümler.
    const state = Object.fromEntries(spec.sections.map((x) => [x.componentKey, x.state]))
    expect(state).toMatchObject({ ozet: 'RENDERED', 'karsilastirma-tablosu': 'RENDERED', 'gtip-tablosu': 'OMITTED', 'sure-uzatimi': 'OMITTED' })
    const byGtip = Object.fromEntries(analysis.comparison.rows.map((x) => [x.gtip, x]))
    expect(byGtip['7208.51.20.00.11']).toMatchObject({ status: 'CHANGED', changePct: '25.05', previous: { value: '1000' }, current: { value: '1250.5' }, currency: 'USD', unit: 'TNE' })
    expect(byGtip['7208.51.20.00.12']).toMatchObject({ status: 'NEW', previous: null }) // önlem yoktu ≠ değişmedi
    expect(spec.validation.unmatchedNumbers).toEqual([])
    const html = (await store.get((await latestSpec()).rev.htmlKey!)).toString()
    expect(html).toContain('1.250,5')
    expect(html).toContain('+%25,05')
    const rel = await h.db.db.select().from(documentRelation).where(eq(documentRelation.relation, 'PRIOR_VALUE'))
    expect(rel.length).toBeGreaterThanOrEqual(1)
  })

  it('ikinci çalıştırma: ön kontrol değişiklik bulmaz, AI çağrısı yok', async () => {
    const before = await aiCalls()
    const runId = await h.start('daily-scan', { date: '2026-09-06' })
    expect(await h.waitForRun(runId)).toBe('COMPLETED')
    expect(await aiCalls()).toBe(before)
  })

  it('RG stratejisi: TARIFF erişilemezse (ERROR, NOT_FOUND değil) önceki belge RG aramasıyla bulunur, profillenir ve rapor yeni revizyon alır', async () => {
    tariffApi.enabled = false
    // TARIFF önbelleği temizlenir ki API tekrar denensin.
    await h.db.db.delete(schema.tariffSnapshot)
    const { report: r } = await latestSpec()
    const dv = (await h.db.db.select({ v: schema.topic.primaryVersionId }).from(schema.topic))[0]!.v!
    const runId = await h.start('document-report', { documentVersionIds: [dv] }, 'FORCE', ['lineage', 'analyze', 'compose', 'render'])
    expect(await h.waitForRun(runId, 60_000)).toBe('COMPLETED')
    const [lineage] = await node(runId, 'lineage')
    expect(lineage!.output).toMatchObject({ status: 'FOUND', attempts: [{ strategy: 'TARIFF', status: 'ERROR' }, { strategy: 'RG_SEARCH', status: 'FOUND' }] })
    // Arama bitişi yayım − 1; 2025/43 seçildi (2025/4399 değil)
    expect(rg.searches.every((s) => s.genelbitistarihi === '2026-09-05')).toBe(true)
    const amends = await h.db.db.select().from(documentRelation).where(eq(documentRelation.relation, 'AMENDS'))
    expect((amends[0]!.detail as { title: string }).title).toContain('2025/43')
    // Önceki belge de profillendi ve tablosu çıkarıldı
    const priorRows = await h.db.db.select().from(gtipValue).where(eq(gtipValue.documentVersionId, amends[0]!.toVersionId!))
    expect(priorRows.length).toBe(2)
    const { report: r2, spec, analysis: an2 } = await latestSpec()
    expect(r2.id).toBe(r.id)
    expect(r2.currentRevision).toBe(2)
    expect(an2.comparison.rows.find((x) => x.gtip === '7208.51.20.00.11')).toMatchObject({ status: 'UNCHANGED', previous: { source: expect.stringMatching(/^d2/) } })
    const attempts = await h.db.db.select().from(resolutionAttempt)
    expect(attempts.some((a) => a.strategy === 'TARIFF' && a.status === 'ERROR')).toBe(true)
    const analysis = AnalysisV1.parse(JSON.parse((await store.get(`artifacts/topics/${spec.topicId}/analysis/r02.json`)).toString()))
    expect(analysis.documents.map((d) => d.role)).toEqual(['PRIMARY', 'PRIOR'])
    expect(analysis.quoteCheck.status).toBe('VERIFIED')
  })

  it('aynı belge için FILL_MISSING: her şey önbellekten, AI çağrısı yok', async () => {
    const before = await aiCalls()
    const dv = (await h.db.db.select({ v: schema.topic.primaryVersionId }).from(schema.topic))[0]!.v!
    const runId = await h.start('document-report', { documentVersionIds: [dv] })
    expect(await h.waitForRun(runId)).toBe('COMPLETED')
    expect(await aiCalls()).toBe(before)
    const outcomes = (await h.db.db.select().from(workItem).where(eq(workItem.runId, runId))).filter((i) => !['entry', 'link'].includes(i.nodeId)).map((i) => i.outcome)
    expect(new Set(outcomes)).toEqual(new Set(['FROM_CACHE']))
  })

  it('şablonda bölüm açıklaması değişince compose yeniden çalışır ve açıklama prompt\'a girer', async () => {
    const components = new ComponentService(h.db.db)
    const templates = new TemplateService(h.db.db, components)
    const def = await templates.ensureDefault()
    const next = { ...def.definition, sections: def.definition.sections.map((s) => (s.id === 'ozet' ? { ...s, sectionDescription: 'Yalnızca ithalatçıya düşen yükümlülüğü vurgula.' } : s)) }
    await templates.save(def.id, next)
    const before = composePrompts.length
    const dv = (await h.db.db.select({ v: schema.topic.primaryVersionId }).from(schema.topic))[0]!.v!
    const runId = await h.start('document-report', { documentVersionIds: [dv] })
    expect(await h.waitForRun(runId)).toBe('COMPLETED')
    const [compose] = await node(runId, 'compose')
    expect(compose!.outcome).toBe('EXECUTED')
    expect(composePrompts.length).toBe(before + 1)
    expect(composePrompts.at(-1)).toContain('Yalnızca ithalatçıya düşen yükümlülüğü vurgula.')
    const [render] = await node(runId, 'render')
    expect(render!.outcome).toBe('EXECUTED')
  })
})
