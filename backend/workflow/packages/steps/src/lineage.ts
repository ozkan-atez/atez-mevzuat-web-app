import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import type { DiscoveredItem, DocumentProfileV1, StepInput, StepOutput } from '@atez/contracts'
import type { StepContext, StepHandler } from '@atez/engine'
import { PermanentError, TransientError, errorInfo, schema } from '@atez/platform'
import {
  comparisonDate,
  decideHit,
  documents,
  gtipKey,
  loadPrompt,
  resolveHitToItem,
  scoreHits,
  searchGazette,
  selectTariffMeasure,
  type PriorTarget,
  type ScoredHit,
} from '@atez/modules'
import { classifyProfile } from './classify-profile'
import type { StepDeps } from './deps'
import { loadProfile, runExtractTable } from './extract-table'
import { docFetch } from './fetch'
import { docNormalize } from './normalize'

const PROMPT = 'lineage-select.v1'
type Out = StepOutput<'lineage.resolve'>
type Attempt = Out['attempts'][number]

const Choice = z.object({ choice: z.number().int().nullable(), reason: z.string() })

/** Geçici hata son denemeye kadar kuyruğa geri döner; son denemede sonuç olarak yazılır (§7.1: run durmaz). */
function rethrowIfRetryable(err: unknown, ctx: StepContext<StepDeps>): void {
  if (err instanceof TransientError && ctx.attempt < ctx.maxAttempts) throw err
}

/**
 * `lineage.resolve` (§7): profil ipuçlarıyla önceki hali bulur. Sıra: TARIFF (her GTİP için
 * queryDate = yayım − 1) → RG `/Home/Filter` araması (bitiş = yayım − 1) → tek kaynak.
 * Bulunan önceki belge de ön kontrol + profil + tablo adımlarından geçer; ilişki
 * `document_relation` olarak yazılır. Hata ≠ bulunamadı.
 */
export const lineageResolve: StepHandler<StepInput<'lineage.resolve'>, Out, StepDeps> = {
  key: 'lineage.resolve',
  versions: (ctx) => ({
    handler: '1',
    policy: 'PUBLICATION_PREVIOUS_DAY',
    prompt: loadPrompt(ctx.deps.configDir, PROMPT).ref,
    // Kimlik bilgisi sonradan eklenirse TARIFF yeniden denenir.
    tariff: ctx.deps.tariff.configured ? 'on' : 'off',
  }),
  cacheIdentity: async (input, ctx) => {
    const p = await documents.latestProfile(ctx.deps.db, input.documentVersionId)
    return p ? `${input.documentVersionId}:p${p.version}` : null
  },
  async run(input, ctx) {
    const dv = input.documentVersionId
    const loaded = await loadProfile(ctx, dv)
    if (!loaded) throw new PermanentError('Belge profili yok', 'NO_PROFILE')
    const profile = loaded.profile
    if (!profile.lineage.needsPrior) return { documentVersionId: dv, status: 'NOT_NEEDED', attempts: [], relations: [] }
    const asOf = comparisonDate(profile.identity.publication.date)
    if (!asOf) throw new PermanentError('Yayım tarihi bilinmiyor; önceki hal tarihi hesaplanamaz (bugün varsayılmaz)', 'NO_PUBLICATION_DATE')

    const attempts: Attempt[] = []
    const relations: Out['relations'] = []
    // Yeniden çözümde önceki sonuç (ilişkiler, TARIFF satırları) bu çalıştırmanınkiyle değiştirilir.
    await ctx.deps.db.delete(schema.gtipValue).where(and(eq(schema.gtipValue.documentVersionId, dv), eq(schema.gtipValue.source, 'TARIFF')))
    await ctx.deps.db
      .delete(schema.documentRelation)
      .where(and(eq(schema.documentRelation.fromVersionId, dv), inArray(schema.documentRelation.strategy, ['TARIFF', 'RG_SEARCH'])))

    let tariffStatus: 'FOUND' | 'PARTIAL' | 'NOT_FOUND' | 'ERROR' | 'SKIPPED' = 'SKIPPED'
    if (profile.lineage.tariffQueries.length) {
      const t = await tariffStrategy(dv, profile, asOf, ctx)
      tariffStatus = t.status
      attempts.push({ strategy: 'TARIFF', status: t.status, note: t.note })
      relations.push(...t.relations)
    }

    let rgStatus: 'FOUND' | 'AMBIGUOUS' | 'NOT_FOUND' | 'ERROR' | 'SKIPPED' = 'SKIPPED'
    if (tariffStatus !== 'FOUND') {
      const r = await rgStrategy(dv, profile, asOf, ctx)
      rgStatus = r.status
      attempts.push({ strategy: 'RG_SEARCH', status: r.status, note: r.note })
      relations.push(...r.relations)
    }

    const status: Out['status'] =
      tariffStatus === 'FOUND' || rgStatus === 'FOUND' ? 'FOUND' : tariffStatus === 'PARTIAL' ? 'PARTIAL' : rgStatus === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'SINGLE_SOURCE'
    for (const a of attempts) {
      await ctx.deps.db.insert(schema.resolutionAttempt).values({ documentVersionId: dv, strategy: a.strategy, status: a.status, detail: { note: a.note, runId: ctx.runId } })
    }
    ctx.log.info('lineage resolved', { documentVersionId: dv, status, attempts })
    return { documentVersionId: dv, status, attempts, relations }
  },
}

async function addRelation(ctx: StepContext<StepDeps>, row: typeof schema.documentRelation.$inferInsert): Promise<Out['relations'][number]> {
  const [r] = await ctx.deps.db
    .insert(schema.documentRelation)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.documentRelation.fromVersionId, schema.documentRelation.relation, schema.documentRelation.toVersionId, schema.documentRelation.toTariffSnapshotId],
      set: { detail: row.detail, ambiguous: row.ambiguous ?? 0 },
    })
    .returning({ id: schema.documentRelation.id })
  return { relationId: r!.id, relation: row.relation, toVersionId: row.toVersionId ?? null, tariffSnapshotId: row.toTariffSnapshotId ?? null, ambiguous: Boolean(row.ambiguous) }
}

// ---- TARIFF ----------------------------------------------------------------------

async function tariffStrategy(dv: string, profile: DocumentProfileV1, asOf: string, ctx: StepContext<StepDeps>) {
  const relations: Out['relations'] = []
  if (!ctx.deps.tariff.configured) return { status: 'ERROR' as const, note: 'TARIFF kimlik bilgisi yok', relations }
  const current = await ctx.deps.db.select().from(schema.gtipValue).where(and(eq(schema.gtipValue.documentVersionId, dv), eq(schema.gtipValue.source, 'RG')))
  const outcomes: string[] = []
  const notes: string[] = []
  outer: for (const q of profile.lineage.tariffQueries) {
    const digits = gtipKey(q.code)
    // Kısa kod sıfırla doldurulmaz: belgedeki tam (12 haneli) kodlar kullanılır, yoksa NEEDS_CODE_EXPANSION.
    const codes = digits.length === 12 ? [digits] : [...new Set(current.map((r) => gtipKey(r.gtip)).filter((g) => g.length === 12 && g.startsWith(digits)))]
    if (!codes.length) {
      outcomes.push('NEEDS_CODE_EXPANSION')
      notes.push(`${q.code}: kısa kod, belgede alt kırılım yok`)
      continue
    }
    for (const code of codes) {
      let fetched
      try {
        fetched = await ctx.deps.tariff.lookUp(code, asOf)
      } catch (err) {
        rethrowIfRetryable(err, ctx)
        outcomes.push('ERROR')
        const info = errorInfo(err)
        notes.push(`${code}: ${info.message}`)
        // Kimlik/erişim hatasında kalan kodlar denenmez (ERROR, NOT_FOUND değil).
        if (info.code === 'TARIFF_AUTH' || info.code === 'TARIFF_NO_CREDENTIALS') break outer
        continue
      }
      const rows = current.filter((r) => gtipKey(r.gtip) === code)
      const targets = rows.length ? rows : [{ origin: null, unit: null, currency: null, description: null }]
      let found = false
      for (const row of targets) {
        const sel = selectTariffMeasure(fetched.raw, {
          gtip: code,
          date: asOf,
          field: q.field,
          origin: isoOrigin(row.origin),
          expected: row.unit || row.currency ? { unit: row.unit, currency: row.currency } : undefined,
        })
        outcomes.push(sel.status)
        if (sel.issues.length) notes.push(`${code}${row.origin ? ` (${row.origin})` : ''}: ${sel.issues.join('; ')}`)
        if (sel.status === 'FOUND' || sel.status === 'NOT_FOUND') {
          await ctx.deps.db.insert(schema.gtipValue).values({
            documentVersionId: dv,
            tariffSnapshotId: fetched.snapshotId,
            source: 'TARIFF',
            tableTitle: sel.status === 'NOT_FOUND' ? `ABSENT:${q.field}` : q.field,
            gtip: code,
            description: row.description,
            value: sel.value,
            rawValue: sel.rawValue,
            unit: sel.unit,
            currency: sel.currency,
            origin: row.origin,
            note: sel.notes.join(' ') || null,
          })
          found = true
        }
      }
      if (found) relations.push(await addRelation(ctx, { fromVersionId: dv, relation: 'PRIOR_VALUE', toTariffSnapshotId: fetched.snapshotId, strategy: 'TARIFF', detail: { gtip: code, queryDate: asOf, field: q.field } }))
    }
  }
  const status = outcomes.length && outcomes.every((o) => o === 'FOUND' || o === 'NOT_FOUND') ? 'FOUND' : outcomes.some((o) => o === 'FOUND') ? 'PARTIAL' : outcomes.includes('ERROR') ? 'ERROR' : 'NOT_FOUND'
  return { status: status as 'FOUND' | 'PARTIAL' | 'NOT_FOUND' | 'ERROR', note: notes.slice(0, 20).join(' | ') || null, relations }
}

/** TARIFF menşe parametresi ülke kodudur; belgede ad yazıyorsa çözülmez → seçim belirsiz kalır. */
function isoOrigin(origin: string | null): string | null {
  if (!origin) return null
  const o = origin.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(o) || /^\d{4}$/.test(o) ? o : origin
}

// ---- RG araması ---------------------------------------------------------------------

async function rgStrategy(dv: string, profile: DocumentProfileV1, asOf: string, ctx: StepContext<StepDeps>) {
  const relations: Out['relations'] = []
  const refs = profile.references.filter((r) => r.relation !== 'REFERENCES')
  const used = refs.length ? refs : profile.references
  const targets: PriorTarget[] = used.map((r) => ({ title: r.targetTitle, number: r.targetNumber }))
  const titleTerms = [...profile.lineage.rgQueries, ...used.map((r) => r.targetTitle)]
  // Çıplak "2018/1" araması sitede alt dize eşleşmesiyle yüzlerce sonuç döndürür (200 sınırı);
  // "No: 2018/1" hem "(No: 2018/1)" hem "(Tebliğ No: 2018/1)" başlıklarını daraltarak yakalar.
  const numberTerms = [...new Set(used.map((r) => r.targetNumber ?? '').filter((n) => /^\d{4}\/\d+$/.test(n)))].map((n) => `No: ${n}`)
  const terms = [...titleTerms, ...numberTerms]
  if (!terms.length) return { status: 'NOT_FOUND' as const, note: 'Arama terimi yok', relations }

  let search
  try {
    search = await searchGazette(ctx.deps.http, terms, asOf)
  } catch (err) {
    rethrowIfRetryable(err, ctx)
    return { status: 'ERROR' as const, note: errorInfo(err).message, relations }
  }
  const scored = scoreHits(search.hits, targets, { title: profile.identity.title, date: profile.identity.publication.date ?? '' })
  let { chosen, ambiguous } = decideHit(scored)
  let note = search.errors.length ? `Arama eksik: ${search.errors.join('; ')}` : null
  if (!chosen && (ambiguous || (scored.length === 0 && search.hits.length > 0))) {
    const pool = (scored.length ? scored : search.hits.map((h) => ({ ...h, score: 0, reasons: [] }))).slice(0, 8)
    const pick = await selectWithModel(profile, pool, ctx)
    if (pick) {
      chosen = pick
      ambiguous = false
      note = [note, 'Aday flash-lite ile seçildi'].filter(Boolean).join(' · ')
    } else if (pool.length) {
      ambiguous = true
    }
  }
  if (!chosen) {
    if (ambiguous) {
      const top = scored.slice(0, 2).map((h) => ({ title: h.title, date: h.date, indexUrl: h.indexUrl, score: h.score }))
      return { status: 'AMBIGUOUS' as const, note: [note, `Belirsiz; ilk adaylar: ${top.map((t) => `${t.date} ${t.title}`).join(' / ')}`].filter(Boolean).join(' · '), relations }
    }
    return { status: 'NOT_FOUND' as const, note: note ?? `${search.hits.length} sonuç, eşleşen yok`, relations }
  }

  let item
  try {
    item = await resolveHitToItem(ctx.deps.http, chosen)
  } catch (err) {
    rethrowIfRetryable(err, ctx)
    return { status: 'ERROR' as const, note: errorInfo(err).message, relations }
  }
  if (!item) return { status: 'AMBIGUOUS' as const, note: `Fihristte başlık tekil çözülemedi: ${chosen.title}`, relations }

  const prior = await ensurePriorProcessed(item, chosen.date, ctx)
  const ref = used.find((r) => r.targetNumber && chosen.title.includes(r.targetNumber)) ?? used[0]
  relations.push(
    await addRelation(ctx, {
      fromVersionId: dv,
      relation: ref?.relation ?? 'AMENDS',
      toVersionId: prior.documentVersionId,
      strategy: 'RG_SEARCH',
      detail: { title: chosen.title, date: chosen.date, url: item.url, score: chosen.score, reasons: chosen.reasons, priorProfile: prior.decision },
    }),
  )
  return { status: 'FOUND' as const, note, relations }
}

async function selectWithModel(profile: DocumentProfileV1, pool: ScoredHit[], ctx: StepContext<StepDeps>): Promise<ScoredHit | null> {
  const ai = ctx.deps.ai
  if (!ai || !pool.length) return null
  const prompt = loadPrompt(ctx.deps.configDir, PROMPT)
  const res = await ai.generate({
    tier: 'lite',
    purpose: 'lineage.select',
    promptVersion: prompt.ref,
    system: prompt.text,
    parts: [
      {
        text: JSON.stringify({
          yeniBelge: { başlık: profile.identity.title, numara: profile.identity.officialNumber, yayım: profile.identity.publication.date },
          değiştirdiği: profile.references,
          adaylar: pool.map((h, i) => ({ id: i, başlık: h.title, tarih: h.date, numara: h.number, tür: h.kind })),
        }),
      },
    ],
    schema: Choice,
    thinking: 'low',
    context: { runId: ctx.runId, workItemId: ctx.workItemId, stepKey: 'lineage.resolve' },
  })
  return res.data.choice === null ? null : (pool[res.data.choice] ?? null)
}

/** Önceki belge de §5.3 ön kontrolünden ve profil/tablo adımlarından geçer; işlendiyse yeniden okunmaz. */
async function ensurePriorProcessed(item: Awaited<ReturnType<typeof resolveHitToItem>> & object, date: string, ctx: StepContext<StepDeps>) {
  const [row] = await documents.upsertDiscovered(ctx.deps.db, 'resmi-gazete', [
    {
      canonicalKey: item.canonicalKey,
      url: item.url,
      title: item.title,
      kind: item.kind,
      publishedOn: date,
      listContext: { rgSection: item.rgSection, rgType: item.rgType, rgIssue: item.issue, mukerrer: item.mukerrer, position: item.position, feed: item.feed, discoveredBy: 'lineage' },
    },
  ])
  const doc = (await documents.getDocument(ctx.deps.db, row!.id))!
  const sub: StepContext<StepDeps> = { ...ctx, force: false }
  if (doc.processingState === 'PROFILED' && doc.latestVersionId) {
    const p = await documents.latestProfile(ctx.deps.db, doc.latestVersionId)
    // Profil güncel prompt/model sürümüyle üretilmişse yeniden okunmaz.
    const current = classifyProfile.versions(sub)
    if (p && p.promptVersion === current.prompt && p.model === current.model) {
      const hasRows = await ctx.deps.db.select({ id: schema.gtipValue.id }).from(schema.gtipValue).where(eq(schema.gtipValue.documentVersionId, doc.latestVersionId)).limit(1)
      if (!hasRows.length) await runExtractTable(doc.latestVersionId, sub).catch((err) => ctx.log.warn('prior table extraction failed', { error: String(err) }))
      return { documentVersionId: doc.latestVersionId, decision: p.decision }
    }
  }
  const candidate: DiscoveredItem = {
    schemaVersion: 1,
    source: 'resmi-gazete',
    feed: item.feed,
    documentId: doc.id,
    identity: { canonicalKey: doc.canonicalKey, url: doc.url },
    title: doc.title,
    kind: doc.kind as DiscoveredItem['kind'],
    listedDate: date,
    listContext: { rgSection: item.rgSection, rgType: item.rgType, rgIssue: item.issue, mukerrer: item.mukerrer, position: item.position },
    precheck: { status: 'NEW' },
  }
  const fetched = await docFetch.run({ candidate, decision: 'IN', reason: 'önceki hal', by: 'RULE' }, sub)
  const normalized = await docNormalize.run(fetched, sub)
  const profiled = await classifyProfile.run(normalized, sub)
  await runExtractTable(fetched.documentVersionId, sub).catch((err) => ctx.log.warn('prior table extraction failed', { error: String(err) }))
  return { documentVersionId: fetched.documentVersionId, decision: profiled.decision }
}
