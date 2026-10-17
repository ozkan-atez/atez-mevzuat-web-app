import { desc, eq, sql } from 'drizzle-orm'
import { AnalysisV1, ComposeModelOutput, ReportSpecV2, type ComponentDefinition, type ReportCard } from '@atez/contracts'
import type { StepContext } from '@atez/engine'
import { PermanentError, StorageKeys, schema } from '@atez/platform'
import {
  ComponentService,
  TemplateService,
  allowedNumbers,
  appliesTo,
  buildRenderContext,
  formatDateTr,
  getPath,
  loadPrompt,
  loadShell,
  renderPage,
  renderSection,
  selectCard,
  unmatchedNumbers,
} from '@atez/modules'
import type { StepDeps } from './deps'
import { loadProfile } from './extract-table'

const PROMPT = 'report-compose.v2'

/**
 * Tek rapor yolu (§10, §10.1): compose → render aynı serviste. Şablon sürümü dondurulur; her açık
 * bölüm için bileşen türü, veri bağları, başlık, bölüm açıklaması ve brief prompt'a girer. Metin
 * alanlarını model yazar; sayılar ve tablolar analizden kodla gelir ve metindeki sayılar analize
 * karşı denetlenir (1 onarım turu). K1: onay ve otomatik e-posta yok.
 */
export class ReportService {
  private readonly components: ComponentService
  private readonly templates: TemplateService
  constructor(private readonly ctx: StepContext<StepDeps>) {
    this.components = new ComponentService(ctx.deps.db)
    this.templates = new TemplateService(ctx.deps.db, this.components)
  }

  promptRef(): string {
    return loadPrompt(this.ctx.deps.configDir, PROMPT).ref
  }

  /** Run girdisindeki `templateId` ya da varsayılan şablonun güncel sürümü. */
  async templateVersionId(): Promise<string> {
    await this.components.ensureBuiltins()
    const requested = this.ctx.runInput.templateId
    const t = typeof requested === 'string' ? await this.templates.get(requested) : await this.templates.ensureDefault()
    if (!t) throw new PermanentError(`Şablon yok: ${String(requested)}`, 'TEMPLATE_NOT_FOUND')
    return t.versionId
  }

  async compose(analysisId: string, templateVersionId: string): Promise<{ reportId: string; revision: number; card: ReportCard; specKey: string }> {
    const { db, store, ai } = this.ctx.deps
    if (!ai) throw new PermanentError('AI geçidi yapılandırılmamış', 'AI_NOT_CONFIGURED')
    const [a] = await db.select().from(schema.analysis).where(eq(schema.analysis.id, analysisId))
    if (!a) throw new PermanentError('Analiz yok', 'ANALYSIS_MISSING')
    const analysis = AnalysisV1.parse(JSON.parse((await store.get(a.objectKey)).toString('utf8')))
    const primary = analysis.documents.find((d) => d.role === 'PRIMARY') ?? analysis.documents[0]!
    const profile = (await loadProfile(this.ctx, primary.documentVersionId))?.profile
    if (!profile) throw new PermanentError('Ana belge profili yok', 'NO_PROFILE')
    const tv = await this.templates.getVersion(templateVersionId)
    if (!tv) throw new PermanentError('Şablon sürümü yok', 'TEMPLATE_VERSION_MISSING')
    const template = tv.definition
    const rctx = buildRenderContext(analysis, profile)

    // Bölüm durumları: görünme kuralı + eksik veri kuralı.
    const plan: { section: (typeof template.sections)[number]; def: ComponentDefinition; meta: { name: string; category: string; description: string }; state: 'RENDERED' | 'OMITTED' | 'NOTE' | 'BLOCKED' }[] = []
    for (const section of [...template.sections].sort((x, y) => x.order - y.order)) {
      if (!section.enabled) continue
      const c = await this.components.definitionOf(section.componentKey, section.componentVersion)
      if (!c) throw new PermanentError(`Şablondaki bileşen yok: ${section.componentKey} v${section.componentVersion}`, 'COMPONENT_MISSING')
      const visible = appliesTo(c.definition, rctx).visible
      const state = visible ? 'RENDERED' : section.missingDataRule === 'OMIT' ? 'OMITTED' : section.missingDataRule === 'BLOCK' ? 'BLOCKED' : 'NOTE'
      plan.push({ section, def: c.definition, meta: { name: c.name, category: c.category, description: c.description }, state })
    }
    const writable = plan.filter((p) => p.state === 'RENDERED' && p.def.slots.length)
    const input = {
      şablon: { başlık: template.title, brief: template.brief },
      bölümler: writable.map((p) => ({
        sectionId: p.section.id,
        başlık: p.section.heading,
        bölümAçıklaması: p.section.sectionDescription || null,
        bileşen: { ad: p.meta.name, tür: p.meta.category, açıklama: p.meta.description },
        slots: p.def.slots,
        veriBağları: Object.fromEntries(p.def.bindings.map((b) => [b, summarize(getPath(rctx, b))])),
      })),
      analiz: {
        summary: analysis.summary,
        operationalImpact: analysis.operationalImpact,
        affected: analysis.affected,
        claims: analysis.claims.map((c) => c.text),
        comparisonCommentary: analysis.comparisonCommentary,
        exceptions: analysis.exceptions,
        dates: analysis.dates,
        priorState: analysis.priorState,
        comparison: analysis.comparison.rows.map((r) => ({ gtip: r.gtip, açıklama: r.description, menşe: r.origin, birim: [r.currency, r.unit].filter(Boolean).join('/'), önceki: r.previous?.value ?? null, yeni: r.current?.value ?? null, değişimYüzde: r.changePct, durum: r.status })),
        documents: analysis.documents.map((d) => ({ title: d.title, role: d.role, publicationDate: d.publicationDate, officialNumber: d.officialNumber })),
        document: { tür: profile.identity.docType, değişiklik: profile.change.kind, kurum: profile.identity.institution },
      },
    }
    const prompt = loadPrompt(this.ctx.deps.configDir, PROMPT)
    const allowed = allowedNumbers({ analysis, profileDates: profile.change.effectiveRules })
    const aiCallIds: string[] = []
    const call = async (extra?: string) => {
      const res = await ai.generate({
        tier: 'main',
        purpose: 'report.compose',
        promptVersion: prompt.ref,
        system: prompt.text,
        parts: [{ text: `${JSON.stringify(input)}\n\nRapor başlığını ve bölüm alanlarını üret.${extra ? `\n\n${extra}` : ''}` }],
        schema: ComposeModelOutput,
        context: { runId: this.ctx.runId, workItemId: this.ctx.workItemId, stepKey: this.ctx.stepKey },
      })
      aiCallIds.push(res.aiCallId)
      return res.data
    }
    const collect = (out: ComposeModelOutput) => {
      const fields = new Map<string, Record<string, string | string[]>>()
      const missing: string[] = []
      for (const p of writable) {
        const got = out.sections.find((s) => s.sectionId === p.section.id)
        const f: Record<string, string | string[]> = {}
        for (const slot of p.def.slots) {
          const g = got?.fields.find((x) => x.slot === slot.key)
          const value = slot.kind === 'list' ? (g?.items ?? []).filter(Boolean) : (g?.text ?? '').trim()
          if ((Array.isArray(value) && !value.length) || value === '') missing.push(`${p.section.id}.${slot.key}`)
          f[slot.key] = value
        }
        fields.set(p.section.id, f)
      }
      const texts = [out.headline, ...[...fields.values()].flatMap((f) => Object.values(f).flat())]
      return { fields, missing, check: unmatchedNumbers(texts, allowed) }
    }
    let out = await call()
    let r = collect(out)
    let repairRounds = 0
    if (r.missing.length || r.check.unmatched.length) {
      repairRounds = 1
      const problems = [
        ...(r.missing.length ? [`Doldurulmayan alanlar: ${r.missing.join(', ')}`] : []),
        ...(r.check.unmatched.length ? [`Analizde olmayan sayılar (kaldır ya da analizdeki değerle değiştir): ${r.check.unmatched.join(', ')}`] : []),
      ]
      out = await call(problems.join('\n'))
      r = collect(out)
    }

    const sections = plan.map((p) => ({
      sectionId: p.section.id,
      componentKey: p.section.componentKey,
      componentVersion: p.section.componentVersion,
      heading: p.section.heading,
      state: p.state,
      fields: r.fields.get(p.section.id) ?? {},
    }))
    const status: 'READY' | 'NEEDS_INPUT' = sections.some((s) => s.state === 'BLOCKED') ? 'NEEDS_INPUT' : 'READY'
    const card = selectCard(profile, analysis)

    return db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.report).where(eq(schema.report.topicId, analysis.topicId))
      let reportId: string
      let revision: number
      if (existing) {
        reportId = existing.id
        const [last] = await tx.select({ r: schema.reportRevision.revision }).from(schema.reportRevision).where(eq(schema.reportRevision.reportId, reportId)).orderBy(desc(schema.reportRevision.revision)).limit(1)
        revision = (last?.r ?? 0) + 1
      } else {
        const [row] = await tx.insert(schema.report).values({ topicId: analysis.topicId, status: 'COMPOSING', title: out.headline, card, currentRevision: 0 }).returning({ id: schema.report.id })
        reportId = row!.id
        revision = 1
      }
      const spec = ReportSpecV2.parse({
        schemaVersion: 2,
        reportId,
        revision,
        topicId: analysis.topicId,
        analysisId,
        templateVersionId,
        card,
        headline: out.headline,
        status,
        sections,
        validation: { numbersChecked: r.check.checked, unmatchedNumbers: r.check.unmatched, repairRounds, missingSlots: r.missing },
        generatedBy: { model: ai.modelFor('main'), promptVersion: prompt.ref, aiCallIds },
      })
      const specKey = StorageKeys.reportFile(reportId, revision, 'spec.json')
      await store.put(specKey, JSON.stringify(spec, null, 2), 'application/json')
      await tx.insert(schema.reportRevision).values({ reportId, revision, analysisId, templateVersionId, specKey, validation: spec.validation })
      return { reportId, revision, card, specKey }
    })
  }

  async render(reportId: string, revision: number): Promise<{ htmlKey: string; status: 'READY' | 'NEEDS_INPUT'; issues: string[] }> {
    const { db, store, configDir } = this.ctx.deps
    const [rev] = await db.select().from(schema.reportRevision).where(sql`${schema.reportRevision.reportId} = ${reportId} AND ${schema.reportRevision.revision} = ${revision}`)
    if (!rev) throw new PermanentError('Rapor revizyonu yok', 'REPORT_REVISION_MISSING')
    const spec = ReportSpecV2.parse(JSON.parse((await store.get(rev.specKey)).toString('utf8')))
    const [a] = await db.select().from(schema.analysis).where(eq(schema.analysis.id, spec.analysisId))
    const analysis = AnalysisV1.parse(JSON.parse((await store.get(a!.objectKey)).toString('utf8')))
    const primary = analysis.documents.find((d) => d.role === 'PRIMARY') ?? analysis.documents[0]!
    const profile = (await loadProfile(this.ctx, primary.documentVersionId))!.profile
    const tv = (await this.templates.getVersion(spec.templateVersionId))!
    const rctx = buildRenderContext(analysis, profile)
    const shell = loadShell(configDir)
    let body = ''
    for (const s of spec.sections) {
      const c = await this.components.definitionOf(s.componentKey, s.componentVersion)
      body += renderSection(s, c?.definition ?? null, rctx)
    }
    const pub = profile.identity.publication
    const html = renderPage(shell, tv.definition, body, {
      reportLabel: `Rapor ${reportId.slice(0, 8)} · r${String(revision).padStart(2, '0')}`,
      headline: spec.headline,
      sourceLabel: pub.rgIssue ? `${pub.rgIssue}${pub.mukerrer ? ` (${pub.mukerrer}. mükerrer)` : ''} sayılı Resmî Gazete` : primary.title,
      displayDate: formatDateTr(pub.date),
    })
    // Tablo hücreleri analizdeki değerlerden üretildi; geri doğrulama: her yeni değer sayfada görünmeli.
    const issues = [
      ...spec.validation.unmatchedNumbers.map((n) => `Metindeki sayı analizde yok: ${n}`),
      ...spec.validation.missingSlots.map((m) => `Doldurulmayan alan: ${m}`),
      ...spec.sections.filter((s) => s.state === 'BLOCKED').map((s) => `Zorunlu bölüm için veri yok: ${s.heading}`),
    ]
    const htmlKey = StorageKeys.reportFile(reportId, revision, 'report.html')
    await store.put(htmlKey, html, 'text/html; charset=utf-8')
    await db.transaction(async (tx) => {
      await tx.update(schema.reportRevision).set({ htmlKey, validation: { ...spec.validation, shell: shell.ref, issues } }).where(eq(schema.reportRevision.id, rev.id))
      await tx
        .update(schema.report)
        .set({ status: spec.status, title: spec.headline, card: spec.card, currentRevision: revision, updatedAt: sql`now()` })
        .where(eq(schema.report.id, reportId))
    })
    return { htmlKey, status: spec.status, issues }
  }
}

/** Prompt'a giden veri bağı değerinin kısa görünümü. */
function summarize(v: unknown): unknown {
  if (Array.isArray(v)) return v.length > 12 ? [...v.slice(0, 12), `… (+${v.length - 12})`] : v
  if (typeof v === 'string' && v.length > 600) return `${v.slice(0, 600)}…`
  return v ?? null
}
