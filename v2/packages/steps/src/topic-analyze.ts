import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { AnalysisModelOutput, AnalysisV1, type DocumentProfileV1, type StepInput, type StepOutput } from '@atez/contracts'
import type { StepContext, StepHandler } from '@atez/engine'
import { PermanentError, StorageKeys, hashJson, schema, type AiPart } from '@atez/platform'
import { buildComparison, checkQuotes, comparisonDate, documents, gtipKey, loadPrompt, visibleText, type QuoteSource, type ValueRow } from '@atez/modules'
import type { StepDeps } from './deps'
import { loadProfile, pdfPages } from './extract-table'
import { analysisView, resolveTemplate } from './template-resolve'

const PROMPT = 'topic-analyze.v2'
const KEY_PAGES_MAX = 20
const PRIOR_PAGES_MAX = 10
const WHOLE_DOC_PAGES = 30

interface DocLayer {
  ref: string
  documentVersionId: string
  role: 'PRIMARY' | 'SUPPORTING' | 'SIGNAL' | 'PRIOR'
  profile: DocumentProfileV1
  title: string
  url: string | null
}

async function topicState(ctx: StepContext<StepDeps>, topicId: string) {
  const [topic] = await ctx.deps.db.select().from(schema.topic).where(eq(schema.topic.id, topicId))
  if (!topic) throw new PermanentError('Konu yok', 'TOPIC_MISSING')
  const members = await ctx.deps.db.select().from(schema.topicMember).where(eq(schema.topicMember.topicId, topicId)).orderBy(schema.topicMember.createdAt)
  const memberIds = members.map((m) => m.documentVersionId)
  const relations = memberIds.length
    ? await ctx.deps.db
        .select()
        .from(schema.documentRelation)
        .where(and(inArray(schema.documentRelation.fromVersionId, memberIds), ne(schema.documentRelation.relation, 'SAME_EVENT')))
        .orderBy(schema.documentRelation.createdAt)
    : []
  return { topic, members, relations }
}

/**
 * `topic.analyze` (§8, K14): girdi katmanlarla kümülatif kurulur; karşılaştırma tablosu ve
 * yüzdeler kodda hesaplanır (yeni değer güncel RG belgesinden, eski değer TARIFF'ten ya da önceki
 * belgeden). Model yalnızca yorum ve kanıtlı iddialar yazar; alıntılar birebir doğrulanır.
 */
export const topicAnalyze: StepHandler<StepInput<'topic.analyze'>, StepOutput<'topic.analyze'>, StepDeps> = {
  key: 'topic.analyze',
  versions: (ctx) => ({ handler: '1', schema: '1', prompt: loadPrompt(ctx.deps.configDir, PROMPT).ref, model: ctx.deps.ai?.modelFor('main') ?? 'none' }),
  cacheIdentity: async (input, ctx) => {
    const { members, relations } = await topicState(ctx, input.topicId)
    const ids = [...members.map((m) => m.documentVersionId), ...relations.map((r) => r.toVersionId).filter((x): x is string => !!x)]
    const profiles = await Promise.all(ids.map(async (id) => (await documents.latestProfile(ctx.deps.db, id))?.version ?? 0))
    const rows = ids.length ? await ctx.deps.db.select({ id: schema.gtipValue.id, v: schema.gtipValue.value }).from(schema.gtipValue).where(inArray(schema.gtipValue.documentVersionId, ids)) : []
    const template = await resolveTemplate(ctx)
    return hashJson({ topic: input.topicId, template: template.analysisHash, ids, profiles, relations: relations.map((r) => [r.id, r.toVersionId, r.toTariffSnapshotId]), rows: rows.map((r) => `${r.id}:${r.v}`).sort() })
  },
  async run(input, ctx) {
    const ai = ctx.deps.ai
    if (!ai) throw new PermanentError('AI geçidi yapılandırılmamış', 'AI_NOT_CONFIGURED')
    const { topic, members, relations } = await topicState(ctx, input.topicId)
    const primaryId = topic.primaryVersionId ?? members[0]?.documentVersionId
    if (!primaryId) throw new PermanentError('Konunun belgesi yok', 'TOPIC_EMPTY')

    // ---- Katman 1, 2, 5: profiller ----
    const layers: DocLayer[] = []
    const addLayer = async (documentVersionId: string, role: DocLayer['role']) => {
      if (layers.some((l) => l.documentVersionId === documentVersionId)) return
      const p = await loadProfile(ctx, documentVersionId)
      if (!p) return
      const v = (await documents.getVersion(ctx.deps.db, documentVersionId))!
      const d = (await documents.getDocument(ctx.deps.db, v.documentId))!
      layers.push({ ref: `d${layers.length + 1}`, documentVersionId, role, profile: p.profile, title: d.title, url: d.url })
    }
    await addLayer(primaryId, 'PRIMARY')
    const primary = layers[0]
    if (!primary) throw new PermanentError('Ana belgenin profili yok', 'NO_PROFILE')
    const priorIds = relations.filter((r) => r.toVersionId).map((r) => r.toVersionId!)
    for (const id of priorIds) await addLayer(id, 'PRIOR')
    for (const m of members) if (m.documentVersionId !== primaryId) await addLayer(m.documentVersionId, m.role as DocLayer['role'])

    // Önceki belgelerin önceki analizi (kümülatif kazanç): katman 2.
    const priorAnalyses: unknown[] = []
    for (const id of priorIds) {
      const [m] = await ctx.deps.db.select().from(schema.topicMember).where(eq(schema.topicMember.documentVersionId, id))
      if (!m) continue
      const [a] = await ctx.deps.db.select().from(schema.analysis).where(eq(schema.analysis.topicId, m.topicId)).orderBy(desc(schema.analysis.revision)).limit(1)
      if (a) {
        const prev = AnalysisV1.parse(JSON.parse((await ctx.deps.store.get(a.objectKey)).toString('utf8')))
        priorAnalyses.push({ ref: layers.find((l) => l.documentVersionId === id)?.ref, summary: prev.summary, comparison: prev.comparison, claims: prev.claims })
      }
    }

    // ---- Katman 4: karşılaştırma (kod) ----
    const label = (id: string) => layers.find((l) => l.documentVersionId === id)
    const current: ValueRow[] = (
      await ctx.deps.db.select().from(schema.gtipValue).where(and(eq(schema.gtipValue.documentVersionId, primaryId), eq(schema.gtipValue.source, 'RG')))
    ).map((r) => ({ gtip: r.gtip, description: r.description, origin: r.origin, unit: r.unit, currency: r.currency, value: r.value, raw: r.rawValue, source: `${primary.ref} s.${r.page ?? '-'}` }))
    const tariffRows = await ctx.deps.db.select().from(schema.gtipValue).where(and(eq(schema.gtipValue.documentVersionId, primaryId), eq(schema.gtipValue.source, 'TARIFF')))
    const snapshotIds = [...new Set(relations.map((r) => r.toTariffSnapshotId).filter((x): x is string => !!x))]
    const snapshots = snapshotIds.length ? await ctx.deps.db.select().from(schema.tariffSnapshot).where(inArray(schema.tariffSnapshot.id, snapshotIds)) : []
    const tRef = (id: string | null) => `t${snapshots.findIndex((s) => s.id === id) + 1}`
    const priorRows: ValueRow[] = [
      ...tariffRows.filter((r) => r.value !== null).map((r) => ({ gtip: r.gtip, description: r.description, origin: r.origin, unit: r.unit, currency: r.currency, value: r.value, raw: r.rawValue, source: `TARIFF ${tRef(r.tariffSnapshotId)}`, note: r.note })),
      ...(priorIds.length
        ? (await ctx.deps.db.select().from(schema.gtipValue).where(and(inArray(schema.gtipValue.documentVersionId, priorIds), eq(schema.gtipValue.source, 'RG')))).map((r) => ({
            gtip: r.gtip,
            description: r.description,
            origin: r.origin,
            unit: r.unit,
            currency: r.currency,
            value: r.value,
            raw: r.rawValue,
            source: `${label(r.documentVersionId!)?.ref ?? 'önceki'} s.${r.page ?? '-'}`,
          }))
        : []),
    ]
    const absent = new Set(tariffRows.filter((r) => r.tableTitle?.startsWith('ABSENT:')).map((r) => `${gtipKey(r.gtip)}|${(r.origin ?? '').trim().toLocaleUpperCase('tr')}`))
    const comparison = current.length ? buildComparison(current, { rows: priorRows, absent }) : { rows: [], issues: [] }

    // ---- Katman 1 ve 3: belge sayfaları ----
    const fileParts: AiPart[] = []
    const quoteSources: QuoteSource[] = []
    const attachPages = async (layer: DocLayer, maxPages: number) => {
      const files = await documents.filesOf(ctx.deps.db, layer.documentVersionId, ['MODEL_INPUT', 'PART'])
      const html = files.find((f) => f.mime === 'text/html' && f.label === 'f1')
      if (html) {
        const text = (await ctx.deps.store.get(html.objectKey)).toString('utf8')
        fileParts.push({ text: `=== ${layer.ref}:f1 · ${layer.title} (HTML) ===` }, { text })
        quoteSources.push({ label: `${layer.ref}:f1`, text: visibleText(text) })
        return
      }
      const total = files.filter((f) => f.label.startsWith('f1')).reduce((a, f) => Math.max(a, f.pageRange?.[1] ?? 0), 0)
      const pages = total && total <= WHOLE_DOC_PAGES ? Array.from({ length: total }, (_, i) => i + 1) : [...new Set(layer.profile.keyPages)].sort((a, b) => a - b).slice(0, maxPages)
      const pdf = pages.length ? await pdfPages(ctx, files, pages) : null
      if (!pdf) return
      fileParts.push({ text: `=== ${layer.ref}:f1 · ${layer.title} (PDF; özgün sayfalar ${pages.join(', ')} → bu dosyada 1–${pages.length}) ===` }, { inline: { mime: 'application/pdf', data: pdf } })
      quoteSources.push({ label: `${layer.ref}:f1`, text: null })
    }
    await attachPages(primary, KEY_PAGES_MAX)
    const hasTariff = snapshots.length > 0
    if (!hasTariff) for (const l of layers.filter((x) => x.role === 'PRIOR').slice(0, 1)) await attachPages(l, PRIOR_PAGES_MAX)

    const lineage = await ctx.deps.db.select().from(schema.resolutionAttempt).where(eq(schema.resolutionAttempt.documentVersionId, primaryId)).orderBy(desc(schema.resolutionAttempt.createdAt)).limit(4)
    const priorStatus: AnalysisV1['priorState']['status'] = !primary.profile.lineage.needsPrior
      ? 'NOT_NEEDED'
      : priorIds.length || snapshots.length
        ? comparison.rows.some((r) => r.status === 'NO_PRIOR')
          ? 'PARTIAL'
          : 'FOUND'
        : lineage.some((a) => a.status === 'AMBIGUOUS')
          ? 'AMBIGUOUS'
          : 'SINGLE_SOURCE'
    // Şablon istekleri: analiz, raporun isteyeceği bilgileri bilerek arar (Belge Profili şablondan bağımsızdır).
    const template = await resolveTemplate(ctx)
    const tv = analysisView(template.definition)
    const context = {
      şablonİstekleri: { brief: tv.brief, bölümler: tv.sections.map((s) => ({ sectionId: s.id, başlık: s.heading, açıklama: s.description || null, bileşen: s.component })) },
      katman1_mevcutBelge: { ref: primary.ref, profil: primary.profile },
      katman2_öncekiBelgeler: layers.filter((l) => l.role === 'PRIOR').map((l) => ({ ref: l.ref, profil: l.profile })),
      katman2_öncekiAnalizler: priorAnalyses,
      katman4_karşılaştırma: { satırlar: comparison.rows, notlar: comparison.issues },
      katman4_tariff: snapshots.map((s, i) => ({ ref: `t${i + 1}`, gtip: s.gtip, sorguTarihi: s.queryDate, seçilenDeğerler: tariffRows.filter((r) => r.tariffSnapshotId === s.id).map((r) => ({ menşe: r.origin, değer: r.rawValue, durum: r.value === null ? 'önlem yok' : 'bulundu' })) })),
      katman5_destekleyici: layers.filter((l) => l.role === 'SUPPORTING' || l.role === 'SIGNAL').map((l) => ({ ref: l.ref, profil: l.profile })),
      öncekiHal: { durum: priorStatus, karşılaştırmaTarihi: comparisonDate(primary.profile.identity.publication.date), denemeler: lineage.map((a) => ({ strateji: a.strategy, durum: a.status, not: (a.detail as { note?: string } | null)?.note ?? null })) },
    }
    const prompt = loadPrompt(ctx.deps.configDir, PROMPT)
    const aiCallIds: string[] = []
    const call = async (extra?: string) => {
      const res = await ai.generate({
        tier: 'main',
        purpose: 'topic.analyze',
        promptVersion: prompt.ref,
        system: prompt.text,
        parts: [...fileParts, { text: `## Katmanlar\n${JSON.stringify(context)}\n\nKümülatif analizi üret.${extra ? `\n\n${extra}` : ''}` }],
        schema: AnalysisModelOutput,
        mediaResolution: ai.config.mediaResolution,
        context: { runId: ctx.runId, workItemId: ctx.workItemId, stepKey: ctx.stepKey },
      })
      aiCallIds.push(res.aiCallId)
      return res.data
    }
    const quotes = (o: AnalysisModelOutput) => o.claims.flatMap((c) => c.evidence.filter((e) => e.kind === 'DOCUMENT' && e.quote).map((e) => ({ quote: e.quote!, file: e.ref, page: e.page })))
    let out = await call()
    let check = checkQuotes(quotes(out), quoteSources)
    if (check.missing.length) {
      out = await call(`Şu alıntılar kaynakta birebir bulunamadı:\n${check.missing.map((q) => `- "${q}"`).join('\n')}\nAlıntıları harfi harfine kopyalayarak analizi yeniden üret.`)
      check = checkQuotes(quotes(out), quoteSources)
    }
    const issues = [...comparison.issues, ...(check.missing.length ? [`${check.missing.length} alıntı kaynakta bulunamadı`] : [])]
    const [last] = await ctx.deps.db.select({ r: schema.analysis.revision }).from(schema.analysis).where(eq(schema.analysis.topicId, topic.id)).orderBy(desc(schema.analysis.revision)).limit(1)
    const revision = (last?.r ?? 0) + 1
    const analysis: AnalysisV1 = AnalysisV1.parse({
      ...out,
      schemaVersion: 1,
      topicId: topic.id,
      revision,
      status: check.missing.length ? 'REVIEW' : 'OK',
      documents: layers.map((l) => ({
        ref: l.ref,
        documentVersionId: l.documentVersionId,
        role: l.role,
        title: l.title,
        publicationDate: l.profile.identity.publication.date,
        officialNumber: l.profile.identity.officialNumber,
        url: l.url,
      })),
      priorState: {
        status: priorStatus,
        comparisonDate: comparisonDate(primary.profile.identity.publication.date),
        tariffSnapshots: snapshots.map((s, i) => ({ ref: `t${i + 1}`, snapshotId: s.id, gtip: s.gtip, queryDate: s.queryDate })),
        note: priorStatus === 'SINGLE_SOURCE' ? 'Önceki hal bulunamadı; analiz tek kaynakla yapıldı.' : priorStatus === 'AMBIGUOUS' ? 'Önceki hal adayları belirsiz; seçim bekliyor.' : null,
      },
      dates: {
        publication: primary.profile.identity.publication.date,
        effective: primary.profile.change.effectiveRules.map((r) => ({ scope: r.scope, rule: r.rule, date: r.resolvedDate })),
      },
      comparison: { rows: comparison.rows, note: comparison.issues.length ? comparison.issues.join(' · ') : null },
      quoteCheck: { status: check.missing.length ? 'FAILED' : check.checked ? 'VERIFIED' : 'NOT_CHECKED', checked: check.checked, missing: check.missing },
      issues,
      template: { versionId: template.versionId, analysisHash: template.analysisHash },
      generatedBy: { model: ai.modelFor('main'), promptVersion: prompt.ref, aiCallIds },
    })
    const key = StorageKeys.topicAnalysis(topic.id, revision)
    await ctx.deps.store.put(key, JSON.stringify(analysis, null, 2), 'application/json')
    const [row] = await ctx.deps.db
      .insert(schema.analysis)
      .values({ topicId: topic.id, revision, status: analysis.status, objectKey: key, model: ai.modelFor('main'), promptVersion: prompt.ref })
      .returning({ id: schema.analysis.id })
    ctx.log.info('topic analyzed', { topicId: topic.id, revision, rows: comparison.rows.length, prior: priorStatus })
    return { topicId: topic.id, analysisId: row!.id, revision, status: analysis.status, comparisonRows: comparison.rows.length, objectKey: key }
  },
}
