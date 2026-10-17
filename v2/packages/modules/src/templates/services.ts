import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  ComponentDefinition,
  TemplateDefinition,
  type ComponentCategory,
  type ComponentRecord,
  type TemplateSection,
} from '@atez/contracts'
import { PermanentError, canonicalJson, schema, type Db, type DbOrTx } from '@atez/platform'
import { BUILTIN_COMPONENTS } from './builtins'
import { SAMPLE_CONTEXT, type RenderContext } from './context'
import { appliesTo, renderPage, renderSection, type Shell } from './render'
import { validateComponent } from './validate'

const { component, componentVersion, template, templateVersion } = schema

const CATEGORY_ORDER: ComponentCategory[] = ['BASLIK', 'OZET', 'DEGISIKLIK_KARTI', 'KARSILASTIRMA_TABLOSU', 'GTIP_TABLOSU', 'ZAMAN_CIZELGESI', 'ETKILENENLER', 'NOT_UYARI', 'KAYNAKLAR']

export class ValidationFailed extends PermanentError {
  constructor(readonly issues: string[]) {
    super(`Doğrulama başarısız: ${issues.slice(0, 5).join('; ')}`, 'VALIDATION_FAILED')
  }
}

/** Yerleşik bileşenler kataloğdaki sırayla, diğerleri sonra. */
const builtinIndex = (key: string) => {
  const i = BUILTIN_COMPONENTS.findIndex((b) => b.key === key)
  return i === -1 ? BUILTIN_COMPONENTS.length : i
}

export const slugify = (s: string) =>
  s
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'bilesen'

/** Bileşen havuzu (§10.1): sürümlü, değişmez tanımlar; aktif/pasif; kullanımdaysa arşiv, değilse silme. */
export class ComponentService {
  constructor(private readonly db: Db) {}

  /** Yerleşik bileşenleri idempotent yükler; tanım değiştiyse yeni sürüm açar. */
  async ensureBuiltins(): Promise<void> {
    for (const b of BUILTIN_COMPONENTS) {
      const v = validateComponent(b.definition)
      if (!v.ok) throw new Error(`Yerleşik bileşen geçersiz: ${b.key}: ${v.issues.join('; ')}`)
      await this.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(component).where(eq(component.key, b.key)).for('update')
        if (!existing) {
          const [c] = await tx.insert(component).values({ key: b.key, name: b.name, description: b.description, category: b.category, origin: 'BUILTIN', status: 'ACTIVE', currentVersion: 1 }).returning()
          await tx.insert(componentVersion).values({ componentId: c!.id, version: 1, definition: v.definition!, note: 'yerleşik' })
          return
        }
        const [cur] = await tx.select().from(componentVersion).where(and(eq(componentVersion.componentId, existing.id), eq(componentVersion.version, existing.currentVersion)))
        // jsonb anahtar sırasını değiştirir; kanonik karşılaştırma.
        if (cur && canonicalJson(cur.definition) === canonicalJson(v.definition)) return
        const next = existing.currentVersion + 1
        await tx.insert(componentVersion).values({ componentId: existing.id, version: next, definition: v.definition!, note: 'yerleşik güncelleme' })
        await tx.update(component).set({ currentVersion: next, name: b.name, description: b.description, updatedAt: sql`now()` }).where(eq(component.id, existing.id))
      })
    }
  }

  async list(filter: { category?: string; status?: string; origin?: string } = {}): Promise<ComponentRecord[]> {
    const rows = await this.db
      .select({ c: component, d: componentVersion.definition })
      .from(component)
      .innerJoin(componentVersion, and(eq(componentVersion.componentId, component.id), eq(componentVersion.version, component.currentVersion)))
      .where(
        and(
          filter.category ? eq(component.category, filter.category) : undefined,
          filter.status ? eq(component.status, filter.status) : undefined,
          filter.origin ? eq(component.origin, filter.origin) : undefined,
        ),
      )
      .orderBy(asc(component.name))
    return rows.map((r) => toRecord(r.c, r.d))
  }

  async get(id: string) {
    const [c] = await this.db.select().from(component).where(eq(component.id, id))
    if (!c) return null
    const versions = await this.db.select().from(componentVersion).where(eq(componentVersion.componentId, id)).orderBy(desc(componentVersion.version))
    const usage = await this.usage(c.key)
    return { ...toRecord(c, versions.find((v) => v.version === c.currentVersion)!.definition), versions: versions.map((v) => ({ version: v.version, note: v.note, createdAt: v.createdAt, definition: v.definition as ComponentDefinition })), usage }
  }

  async definitionOf(key: string, version: number, tx: DbOrTx = this.db): Promise<{ name: string; category: string; description: string; definition: ComponentDefinition } | null> {
    const [r] = await tx
      .select({ name: component.name, category: component.category, description: component.description, d: componentVersion.definition })
      .from(component)
      .innerJoin(componentVersion, eq(componentVersion.componentId, component.id))
      .where(and(eq(component.key, key), eq(componentVersion.version, version)))
    return r ? { name: r.name, category: r.category, description: r.description, definition: ComponentDefinition.parse(r.d) } : null
  }

  async create(input: { key?: string; name: string; description: string; category: ComponentCategory; origin: 'USER' | 'AI'; definition: unknown; activate?: boolean }): Promise<ComponentRecord> {
    const v = validateComponent(input.definition)
    if (!v.ok) throw new ValidationFailed(v.issues)
    let key = input.key ?? slugify(input.name)
    for (let i = 2; await this.keyExists(key); i++) key = `${slugify(input.name).slice(0, 36)}-${i}`
    return this.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(component)
        .values({ key, name: input.name, description: input.description, category: input.category, origin: input.origin, status: input.activate ? 'ACTIVE' : 'INACTIVE', currentVersion: 1 })
        .returning()
      await tx.insert(componentVersion).values({ componentId: c!.id, version: 1, definition: v.definition!, note: input.origin === 'AI' ? 'AI ile oluşturuldu' : null })
      return toRecord(c!, v.definition!)
    })
  }

  async addVersion(id: string, input: { definition: unknown; note?: string; name?: string; description?: string }): Promise<ComponentRecord> {
    const v = validateComponent(input.definition)
    if (!v.ok) throw new ValidationFailed(v.issues)
    return this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(component).where(eq(component.id, id)).for('update')
      if (!c) throw new PermanentError('Bileşen yok', 'NOT_FOUND')
      if (c.origin === 'BUILTIN') throw new PermanentError('Yerleşik bileşenler koddan sürümlenir; kopyalayıp düzenleyin', 'BUILTIN_READONLY')
      const next = c.currentVersion + 1
      await tx.insert(componentVersion).values({ componentId: id, version: next, definition: v.definition!, note: input.note ?? null })
      const [u] = await tx
        .update(component)
        .set({ currentVersion: next, name: input.name ?? c.name, description: input.description ?? c.description, updatedAt: sql`now()` })
        .where(eq(component.id, id))
        .returning()
      return toRecord(u!, v.definition!)
    })
  }

  async setStatus(id: string, status: 'ACTIVE' | 'INACTIVE'): Promise<void> {
    await this.db.update(component).set({ status, updatedAt: sql`now()` }).where(eq(component.id, id))
  }

  /** Hiçbir şablon sürümünde kullanılmıyorsa gerçekten siler; kullanılıyorsa arşivler. */
  async remove(id: string): Promise<{ result: 'DELETED' | 'ARCHIVED'; usage: number }> {
    const [c] = await this.db.select().from(component).where(eq(component.id, id))
    if (!c) throw new PermanentError('Bileşen yok', 'NOT_FOUND')
    const usage = await this.usage(c.key)
    if (usage > 0) {
      await this.db.update(component).set({ status: 'ARCHIVED', updatedAt: sql`now()` }).where(eq(component.id, id))
      return { result: 'ARCHIVED', usage }
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(componentVersion).where(eq(componentVersion.componentId, id))
      await tx.delete(component).where(eq(component.id, id))
    })
    return { result: 'DELETED', usage: 0 }
  }

  /** Bileşeni kullanan şablon sürümü sayısı. */
  async usage(key: string): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(templateVersion)
      .where(sql`${templateVersion.definition}->'sections' @> ${JSON.stringify([{ componentKey: key }])}::jsonb`)
    return r!.n
  }

  private async keyExists(key: string) {
    const [r] = await this.db.select({ id: component.id }).from(component).where(eq(component.key, key))
    return !!r
  }
}

function toRecord(c: typeof component.$inferSelect, d: unknown): ComponentRecord {
  return {
    id: c.id,
    key: c.key,
    name: c.name,
    description: c.description,
    category: c.category as ComponentCategory,
    origin: c.origin as ComponentRecord['origin'],
    status: c.status as ComponentRecord['status'],
    currentVersion: c.currentVersion,
    definition: ComponentDefinition.parse(d),
  }
}

/** Şablonlar (§10.1): sürümlü; yeni şablonda bütün ACTIVE bileşenler açık; rapor üretiminde sürüm dondurulur. */
export class TemplateService {
  constructor(
    private readonly db: Db,
    private readonly components: ComponentService,
  ) {}

  async create(input: { title: string; description?: string; brief?: string; makeDefault?: boolean }) {
    const active = (await this.components.list({ status: 'ACTIVE' })).sort(
      (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || builtinIndex(a.key) - builtinIndex(b.key) || a.name.localeCompare(b.name, 'tr'),
    )
    const sections: TemplateSection[] = active.map((c, i) => ({
      id: c.key,
      componentKey: c.key,
      componentVersion: c.currentVersion,
      enabled: true,
      order: i,
      heading: c.name,
      sectionDescription: '',
      required: false,
      missingDataRule: 'OMIT',
    }))
    const definition = TemplateDefinition.parse({
      schemaVersion: 1,
      title: input.title,
      description: input.description ?? '',
      brief: input.brief ?? '',
      theme: { tokens: {} },
      shell: { heading: 'ATEZ Mevzuat Radarı Günlük Raporu', showFooter: true },
      sections,
    })
    return this.db.transaction(async (tx) => {
      if (input.makeDefault) await tx.update(template).set({ isDefault: false })
      const [t] = await tx.insert(template).values({ title: definition.title, status: 'ACTIVE', isDefault: input.makeDefault ?? false, currentVersion: 1 }).returning()
      const [v] = await tx.insert(templateVersion).values({ templateId: t!.id, version: 1, definition }).returning()
      return { id: t!.id, versionId: v!.id, version: 1, isDefault: t!.isDefault, definition }
    })
  }

  async list() {
    return this.db.select().from(template).where(eq(template.status, 'ACTIVE')).orderBy(desc(template.isDefault), asc(template.title))
  }

  async get(id: string) {
    const [t] = await this.db.select().from(template).where(eq(template.id, id))
    if (!t) return null
    const versions = await this.db.select({ id: templateVersion.id, version: templateVersion.version, createdAt: templateVersion.createdAt }).from(templateVersion).where(eq(templateVersion.templateId, id)).orderBy(desc(templateVersion.version))
    const [cur] = await this.db.select().from(templateVersion).where(and(eq(templateVersion.templateId, id), eq(templateVersion.version, t.currentVersion)))
    return { id: t.id, isDefault: t.isDefault, version: t.currentVersion, versionId: cur!.id, definition: TemplateDefinition.parse(cur!.definition), versions }
  }

  async getVersion(versionId: string) {
    const [v] = await this.db.select().from(templateVersion).where(eq(templateVersion.id, versionId))
    return v ? { ...v, definition: TemplateDefinition.parse(v.definition) } : null
  }

  async save(id: string, raw: unknown) {
    const parsed = TemplateDefinition.safeParse(raw)
    if (!parsed.success) throw new ValidationFailed(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`))
    const def = parsed.data
    const issues: string[] = []
    for (const s of def.sections) {
      const c = await this.components.definitionOf(s.componentKey, s.componentVersion)
      if (!c) issues.push(`${s.id}: bileşen ${s.componentKey} v${s.componentVersion} yok`)
    }
    if (issues.length) throw new ValidationFailed(issues)
    return this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(template).where(eq(template.id, id)).for('update')
      if (!t) throw new PermanentError('Şablon yok', 'NOT_FOUND')
      const next = t.currentVersion + 1
      const [v] = await tx.insert(templateVersion).values({ templateId: id, version: next, definition: def }).returning()
      await tx.update(template).set({ currentVersion: next, title: def.title, updatedAt: sql`now()` }).where(eq(template.id, id))
      return { id, version: next, versionId: v!.id, definition: def }
    })
  }

  async setDefault(id: string) {
    await this.db.transaction(async (tx) => {
      await tx.update(template).set({ isDefault: false })
      await tx.update(template).set({ isDefault: true }).where(eq(template.id, id))
    })
  }

  /** Varsayılan şablon; yoksa "Standart bülten" oluşturulur. */
  async ensureDefault() {
    const [d] = await this.db.select().from(template).where(and(eq(template.isDefault, true), eq(template.status, 'ACTIVE')))
    if (d) return (await this.get(d.id))!
    const created = await this.create({
      title: 'Standart bülten',
      description: 'Yerleşik bileşenlerle varsayılan rapor',
      brief: 'Gümrük müşavirleri ve dış ticaret firmaları için kısa, resmî ve tarafsız bir mevzuat bülteni. Önce ne değiştiğini, sonra sayısal etkiyi ve firmaların yapması gerekenleri öne çıkar.',
      makeDefault: true,
    })
    // Özet bölümü her raporda olsun.
    const def = { ...created.definition, sections: created.definition.sections.map((s) => (s.componentKey === 'ozet' ? { ...s, required: true, missingDataRule: 'NOTE' as const } : s)) }
    await this.save(created.id, def)
    return (await this.get(created.id))!
  }

  /** Şablonun örnek analizle tam önizlemesi (bölüm görünme kuralları dahil). */
  async preview(raw: unknown, shell: Shell, ctx: RenderContext = SAMPLE_CONTEXT): Promise<{ html: string; sections: { id: string; state: string }[] }> {
    const def = TemplateDefinition.parse(raw)
    const states: { id: string; state: string }[] = []
    let body = ''
    for (const s of [...def.sections].sort((a, b) => a.order - b.order)) {
      if (!s.enabled) continue
      const c = await this.components.definitionOf(s.componentKey, s.componentVersion)
      if (!c) continue
      const visible = appliesTo(c.definition, ctx).visible
      const state = visible ? 'RENDERED' : s.missingDataRule === 'OMIT' ? 'OMITTED' : s.missingDataRule === 'BLOCK' ? 'BLOCKED' : 'NOTE'
      states.push({ id: s.id, state })
      body += renderSection({ heading: s.heading, state: state as never, fields: c.definition.sampleData.slots }, c.definition, ctx)
    }
    return {
      html: renderPage(shell, def, body, { reportLabel: 'Önizleme', headline: def.title, sourceLabel: 'Örnek analiz', displayDate: '31.12.2025', preview: true }),
      sections: states,
    }
  }
}

export async function componentsByKeys(db: Db, keys: string[]) {
  if (!keys.length) return []
  return db.select().from(component).where(inArray(component.key, keys))
}
