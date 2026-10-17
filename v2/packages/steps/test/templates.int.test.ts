import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AiStudio, BUILTIN_COMPONENTS, ComponentService, TemplateService, ValidationFailed, applyDescriptions, applyCompiled, loadShell, runTemplateTool } from '@atez/modules'
import { AiGateway, DEFAULT_AI_CONFIG, FakeProvider, type DbHandle, type ProviderRequest } from '@atez/platform'
import { openTestDb, truncateAll } from '@atez/platform/testing'

const CONFIG = fileURLToPath(new URL('../../../config', import.meta.url))

const zebraDraft = (bad: boolean) => ({
  name: 'GTİP değer tablosu (sade)',
  description: 'Karşılaştırma satırlarını GTİP ve yeni değerle gösterir.',
  category: 'GTIP_TABLOSU',
  nodes: [
    { type: 'text', slot: 'intro', parent: null },
    { parent: null, type: 'table', bind: bad ? 'analysis.olmayanAlan' : 'analysis.comparison.rows', columns: [{ header: 'GTİP', value: 'gtip', format: 'gtip' }, { header: 'Yeni', value: 'currentValue', format: 'number' }] },
  ],
  slots: [{ key: 'intro', kind: 'text', instruction: 'Tabloyu tanıtan tek cümle.' }],
  appliesWhen: 'size(analysis.comparison.rows) > 0',
  sampleSlots: [{ key: 'intro', text: 'Yeni değerler aşağıdadır.', items: null }],
})

describe('Şablon stüdyosu ve bileşen havuzu (§10.1)', () => {
  let db: DbHandle
  let components: ComponentService
  let templates: TemplateService
  const calls: ProviderRequest[] = []
  let studio: AiStudio
  const shell = loadShell(CONFIG)

  beforeAll(async () => {
    db = await openTestDb()
    await truncateAll(db)
    components = new ComponentService(db.db)
    templates = new TemplateService(db.db, components)
    let n = 0
    const provider = new FakeProvider((req) => {
      calls.push(req)
      if (req.system?.includes('şablonlarını yapılandıran'))
        return { brief: 'İthalatçılar için kısa ve resmi rapor.', sections: [{ sectionId: 'ozet', heading: 'Bugün ne değişti', sectionDescription: 'Karar gerektiren noktaları öne çıkar.', missingDataRule: 'OMIT' }, { sectionId: 'uydurma', heading: 'x', sectionDescription: 'x', missingDataRule: 'NOTE' }] }
      if (req.system?.includes('bölüm açıklamaları öneren')) return { sections: [{ sectionId: 'ozet', sectionDescription: 'Gümrük müşavirine pratik etkiyi öne çıkar.' }, { sectionId: 'uydurma', sectionDescription: 'x' }] }
      return zebraDraft(n++ === 0) // ilk taslak geçersiz → onarım turu
    })
    studio = new AiStudio(new AiGateway(db.db, provider, DEFAULT_AI_CONFIG), CONFIG, shell)
  })
  afterAll(async () => db?.close())

  it('yerleşik bileşenler havuza idempotent yüklenir', async () => {
    await components.ensureBuiltins()
    await components.ensureBuiltins()
    const list = await components.list()
    expect(list).toHaveLength(BUILTIN_COMPONENTS.length)
    expect(list.every((c) => c.origin === 'BUILTIN' && c.status === 'ACTIVE' && c.currentVersion === 1)).toBe(true)
  })

  it('yeni şablonda bütün ACTIVE bileşenler açık gelir; pasif bileşen yeni şablonda yok, eskiyi bozmaz', async () => {
    const t1 = await templates.create({ title: 'Müşteri bülteni', brief: 'Kısa ve pratik.' })
    expect(t1.definition.sections).toHaveLength(BUILTIN_COMPONENTS.length)
    expect(t1.definition.sections.every((s) => s.enabled)).toBe(true)
    const istisna = (await components.list()).find((c) => c.key === 'istisnalar')!
    await components.setStatus(istisna.id, 'INACTIVE')
    const t2 = await templates.create({ title: 'İkinci' })
    expect(t2.definition.sections.some((s) => s.componentKey === 'istisnalar')).toBe(false)
    expect((await templates.get(t1.id))!.definition.sections.some((s) => s.componentKey === 'istisnalar')).toBe(true)
    await components.setStatus(istisna.id, 'ACTIVE')
  })

  it('seed şablonu idempotent: bütün aktif bileşenler açık, başlık ve açıklamalar dolu, varsayılan', async () => {
    const a = await templates.ensureSeed()
    const b = await templates.ensureSeed()
    expect(b.id).toBe(a.id)
    const active = await components.list({ status: 'ACTIVE' })
    expect(a.definition.title).toBe('ATEZ Günlük Mevzuat — Tüm bileşenler')
    expect(a.definition.sections).toHaveLength(active.length)
    expect(a.definition.sections.every((s) => s.enabled && s.heading.trim() && s.sectionDescription.trim())).toBe(true)
    expect(a.definition.sections.find((s) => s.componentKey === 'karsilastirma-tablosu')!.heading).toBe('GTİP karşılaştırması')
    expect(a.definition.sections.find((s) => s.componentKey === 'onerilen-aksiyonlar')!.heading).toBe('Önerilen aksiyonlar')
    expect((await templates.ensureDefault()).id).toBe(a.id)
  })

  it('zorunlu bölümde OMIT kuralı reddedilir', async () => {
    const t = (await templates.list())[0]!
    const full = (await templates.get(t.id))!
    const bad = { ...full.definition, sections: full.definition.sections.map((s, i) => (i === 0 ? { ...s, required: true, missingDataRule: 'OMIT' } : s)) }
    await expect(templates.save(t.id, bad)).rejects.toBeInstanceOf(ValidationFailed)
  })

  it('AI ile bileşen: geçersiz taslak tek onarım turuyla düzelir, önizlenir, kaydedilip şablona eklenir', async () => {
    const draft = await studio.draftComponent({ request: 'GTİP ve yeni değeri gösteren sade bir tablo' })
    expect(draft.repairRounds).toBe(1)
    expect(draft.ok).toBe(true)
    expect(draft.previewHtml).toContain('data-table')
    // Onarım turunda doğrulama hataları modele verildi
    expect((calls.at(-1)!.parts.at(-1) as { text: string }).text).toMatch(/olmayanAlan/)
    const saved = await components.create({ name: draft.name, description: draft.description, category: draft.category, origin: 'AI', definition: draft.definition })
    expect(saved.status).toBe('INACTIVE')
    await components.setStatus(saved.id, 'ACTIVE')
    const t = (await templates.list()).find((x) => x.title === 'Müşteri bülteni')!
    const full = (await templates.get(t.id))!
    const added = { ...full.definition, sections: [...full.definition.sections, { id: saved.key, componentKey: saved.key, componentVersion: 1, enabled: true, order: 99, heading: saved.name, sectionDescription: 'Yalnızca değişen kalemleri vurgula.', required: false, missingDataRule: 'OMIT' as const }] }
    const v2 = await templates.save(t.id, added)
    expect(v2.version).toBe(2)
    const preview = await templates.preview(v2.definition, shell)
    expect(preview.sections.find((s) => s.id === saved.key)?.state).toBe('RENDERED')
    expect(preview.html).toContain('Content-Security-Policy')
  })

  it('kullanımdaki bileşen silinemez, arşivlenir; kullanılmayan gerçekten silinir', async () => {
    const used = (await components.list()).find((c) => c.origin === 'AI')!
    expect(await components.remove(used.id)).toMatchObject({ result: 'ARCHIVED' })
    const fresh = await components.create({ name: 'Geçici not', description: 'x', category: 'NOT_UYARI', origin: 'USER', definition: { schemaVersion: 1, nodes: [{ type: 'note', text: 'Deneme' }], slots: [], appliesWhen: '', bindings: [], sampleData: { slots: {} } } })
    expect(await components.remove(fresh.id)).toEqual({ result: 'DELETED', usage: 0 })
    expect(await components.get(fresh.id)).toBeNull()
  })

  it('AI şablon önerisi yalnızca bölüm açıklamalarını değiştirir', async () => {
    const t = (await templates.list()).find((x) => x.title === 'Müşteri bülteni')!
    const full = (await templates.get(t.id))!
    const { suggestions } = await studio.suggestSectionDescriptions({ template: full.definition, components: {} })
    expect(suggestions.map((s) => s.sectionId)).toEqual(['ozet']) // bilinmeyen bölüm önerisi atılır
    const next = applyDescriptions(full.definition, suggestions)
    expect(next.sections.map((s) => s.id)).toEqual(full.definition.sections.map((s) => s.id))
    expect(next.sections.find((s) => s.id === 'ozet')!.sectionDescription).toMatch(/pratik etkiyi/)
  })

  it('rapor tarifi brief + bölüm başlık/açıklamasına çevrilir; seçim ve sıra değişmez, zorunlu bölüm OMIT olmaz', async () => {
    const t = (await templates.list()).find((x) => x.title === 'Müşteri bülteni')!
    const full = (await templates.get(t.id))!
    const def = { ...full.definition, request: 'İthalatçılar için kısa rapor. Bugün ne değişti başlığıyla başlasın.' }
    const res = await studio.compileRequest({ template: def, components: {} })
    expect(res.sections.map((s) => s.sectionId)).toEqual(['ozet'])
    const next = applyCompiled(def, res)
    expect(next.brief).toBe('İthalatçılar için kısa ve resmi rapor.')
    expect(next.request).toBe(def.request)
    expect(next.sections.map((s) => [s.id, s.enabled, s.order])).toEqual(def.sections.map((s) => [s.id, s.enabled, s.order]))
    const ozet = next.sections.find((s) => s.id === 'ozet')!
    expect(ozet.heading).toBe('Bugün ne değişti')
    expect(ozet.missingDataRule).toBe(ozet.required ? 'NOTE' : 'OMIT')
    await expect(studio.compileRequest({ template: { ...def, request: '  ' }, components: {} })).rejects.toThrow(/tarifi boş/)
  })

  it('chat aracı propose_template_change kaydetmez, aksiyon kartı döner', async () => {
    const t = (await templates.list()).find((x) => x.title === 'Müşteri bülteni')!
    const before = (await templates.get(t.id))!.version
    const res = await runTemplateTool('propose_template_change', { templateId: t.id, changes: [{ sectionId: 'kaynaklar', enabled: false }] }, { components, templates, studio, shell })
    expect(res.kind).toBe('action')
    if (res.kind === 'action') {
      expect(res.card.buttons).toContain('save')
      expect(res.card.previewHtml).toContain('<html')
    }
    expect((await templates.get(t.id))!.version).toBe(before)
  })
})
