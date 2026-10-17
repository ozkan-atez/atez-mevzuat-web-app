import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { DocumentProfileV1, StepInput, StepOutput } from '@atez/contracts'
import type { StepContext, StepHandler } from '@atez/engine'
import { PermanentError, schema } from '@atez/platform'
import { addDays, documents, jaccard, loadPrompt, loadSourceDefinition, titleTokens } from '@atez/modules'
import type { StepDeps } from './deps'
import { loadProfile } from './extract-table'

const PROMPT = 'topic-same-event.v1'
type Out = StepOutput<'topic.link'>
const Pick = z.object({ topicIndex: z.number().int().nullable(), reason: z.string() })

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toLocaleLowerCase('tr')

/**
 * `topic.link` (§3 Konular, §0.1): önce kesin eşleşme (aynı belgenin önceki sürümü, RG bağlantısı,
 * aynı tür + resmî numara), sonra flash-lite ile "aynı olay mı?", o da yoksa ayrı konu.
 * Eşzamanlı bağlamalar advisory lock ile sıralanır.
 */
export const topicLink: StepHandler<StepInput<'topic.link'>, Out, StepDeps> = {
  key: 'topic.link',
  versions: (ctx) => ({ handler: '1', prompt: loadPrompt(ctx.deps.configDir, PROMPT).ref }),
  // Konu üyeliği kalıcı durumdur; adım her seferinde DB'ye bakar (üyeyse anında döner).
  cacheIdentity: () => null,
  async run(input, ctx) {
    const dv = input.documentVersionId
    const loaded = await loadProfile(ctx, dv)
    if (!loaded) throw new PermanentError('Belge profili yok', 'NO_PROFILE')
    const profile = loaded.profile
    const version = (await documents.getVersion(ctx.deps.db, dv))!
    const doc = (await documents.getDocument(ctx.deps.db, version.documentId))!
    const role = loadSourceDefinition(ctx.deps.configDir, doc.sourceId).policy.topicRole

    const candidates = await sameEventCandidates(ctx, profile, dv)
    let aiPick: { topicId: string; reason: string } | null = null
    if (candidates.length && !(await memberOf(ctx, dv))) aiPick = await askSameEvent(ctx, profile, candidates)

    return ctx.deps.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('topic.link'))`)
      const [existing] = await tx.select().from(schema.topicMember).where(eq(schema.topicMember.documentVersionId, dv))
      if (existing) return { documentVersionId: dv, topicId: existing.topicId, matchedBy: 'EXISTING_MEMBER' as const }
      const join = async (topicId: string, matchedBy: Out['matchedBy'], memberRole = role) => {
        await tx.insert(schema.topicMember).values({ topicId, documentVersionId: dv, role: memberRole, matchedBy })
        const [primary] = await tx.select({ v: schema.topic.primaryVersionId }).from(schema.topic).where(eq(schema.topic.id, topicId))
        if (primary?.v && primary.v !== dv)
          await tx.insert(schema.documentRelation).values({ fromVersionId: dv, relation: 'SAME_EVENT', toVersionId: primary.v, strategy: matchedBy }).onConflictDoNothing()
        return { documentVersionId: dv, topicId, matchedBy }
      }

      // 1) Aynı belgenin önceki sürümü bir konudaysa (içerik değişti) aynı konu.
      const sibling = await tx
        .select({ topicId: schema.topicMember.topicId })
        .from(schema.topicMember)
        .innerJoin(schema.documentVersion, eq(schema.documentVersion.id, schema.topicMember.documentVersionId))
        .where(eq(schema.documentVersion.documentId, doc.id))
        .limit(1)
      if (sibling[0]) return join(sibling[0].topicId, 'OFFICIAL_NUMBER')

      // 2) Kodla çıkarılmış RG bağlantıları (destekleyici kaynaklar RG belgesine doğrudan bağlanır).
      if (doc.sourceId !== 'resmi-gazete' && version.manifestKey) {
        const manifest = JSON.parse((await ctx.deps.store.get(version.manifestKey)).toString('utf8')) as { hints?: { rgReferences?: { url: string }[] } }
        const urls = (manifest.hints?.rgReferences ?? []).map((r) => r.url.replace(/^http:/, 'https:').replace('://resmigazete', '://www.resmigazete'))
        if (urls.length) {
          const hit = await tx
            .select({ topicId: schema.topicMember.topicId })
            .from(schema.topicMember)
            .innerJoin(schema.documentVersion, eq(schema.documentVersion.id, schema.topicMember.documentVersionId))
            .innerJoin(schema.document, eq(schema.document.id, schema.documentVersion.documentId))
            .where(inArray(schema.document.url, urls))
            .limit(1)
          if (hit[0]) return join(hit[0].topicId, 'RG_REFERENCE', 'SUPPORTING')
        }
      }

      // 3) Aynı tür + aynı resmî numara + benzer başlık ("No: 2026/1" farklı tebliğ serilerinde tekrarlanır).
      if (profile.identity.officialNumber) {
        const same = await tx
          .select({ topicId: schema.topicMember.topicId, number: schema.documentProfile.officialNumber, title: schema.document.title })
          .from(schema.documentProfile)
          .innerJoin(schema.topicMember, eq(schema.topicMember.documentVersionId, schema.documentProfile.documentVersionId))
          .innerJoin(schema.documentVersion, eq(schema.documentVersion.id, schema.documentProfile.documentVersionId))
          .innerJoin(schema.document, eq(schema.document.id, schema.documentVersion.documentId))
          .where(and(eq(schema.documentProfile.docType, profile.identity.docType), sql`${schema.documentProfile.officialNumber} IS NOT NULL`))
        const mine = titleTokens(doc.title)
        const match = same.find((s) => norm(s.number) === norm(profile.identity.officialNumber) && jaccard(titleTokens(s.title), mine) >= 0.5)
        if (match) return join(match.topicId, 'OFFICIAL_NUMBER')
      }

      // 4) Model "aynı olay" dediyse.
      if (aiPick) return join(aiPick.topicId, 'AI_SAME_EVENT', role === 'PRIMARY' ? 'SUPPORTING' : role)

      // 5) Ayrı konu.
      const [t] = await tx.insert(schema.topic).values({ title: profile.identity.title, primaryVersionId: dv }).returning({ id: schema.topic.id })
      await tx.insert(schema.topicMember).values({ topicId: t!.id, documentVersionId: dv, role: 'PRIMARY', matchedBy: 'NEW_TOPIC' })
      return { documentVersionId: dv, topicId: t!.id, matchedBy: 'NEW_TOPIC' as const }
    })
  },
}

async function memberOf(ctx: StepContext<StepDeps>, dv: string) {
  const [m] = await ctx.deps.db.select().from(schema.topicMember).where(eq(schema.topicMember.documentVersionId, dv))
  return m ?? null
}

/**
 * "Aynı olay" adayları: yayımdan ±3 gün içinde açılmış, ana belge profili GTİP ya da anahtar
 * kelimelerde örtüşen konular. İki farklı resmî numaralı RG düzenlemesi aday değildir.
 */
async function sameEventCandidates(ctx: StepContext<StepDeps>, profile: DocumentProfileV1, dv: string) {
  const pub = profile.identity.publication.date
  if (!pub) return []
  const rows = await ctx.deps.db
    .select({ topicId: schema.topic.id, primary: schema.topic.primaryVersionId, objectKey: schema.documentProfile.objectKey, number: schema.documentProfile.officialNumber, date: schema.documentProfile.publicationDate })
    .from(schema.topic)
    .innerJoin(schema.documentProfile, eq(schema.documentProfile.documentVersionId, schema.topic.primaryVersionId))
    .where(and(gte(schema.documentProfile.publicationDate, addDays(pub, -3)), lte(schema.documentProfile.publicationDate, addDays(pub, 3))))
  const out: { topicId: string; profile: DocumentProfileV1 }[] = []
  const myCodes = new Set(profile.gtip.codes.map((c) => c.code.replace(/\D/g, '')))
  const myKeys = new Set(profile.keywords.map((k) => k.toLocaleLowerCase('tr')))
  for (const r of rows) {
    if (r.primary === dv) continue
    if (profile.identity.officialNumber && r.number && norm(r.number) !== norm(profile.identity.officialNumber)) continue
    const p = JSON.parse((await ctx.deps.store.get(r.objectKey)).toString('utf8')) as DocumentProfileV1
    const codes = new Set(p.gtip.codes.map((c) => c.code.replace(/\D/g, '')))
    const overlap = [...myCodes].some((c) => codes.has(c)) || jaccard(myKeys, new Set(p.keywords.map((k) => k.toLocaleLowerCase('tr')))) >= 0.3
    if (overlap) out.push({ topicId: r.topicId, profile: p })
  }
  return out.slice(0, 5)
}

async function askSameEvent(ctx: StepContext<StepDeps>, profile: DocumentProfileV1, candidates: { topicId: string; profile: DocumentProfileV1 }[]) {
  const ai = ctx.deps.ai
  if (!ai) return null
  const prompt = loadPrompt(ctx.deps.configDir, PROMPT)
  const view = (p: DocumentProfileV1) => ({ başlık: p.identity.title, tür: p.identity.docType, numara: p.identity.officialNumber, kurum: p.identity.institution, yayım: p.identity.publication.date, özet: p.summary })
  const res = await ai.generate({
    tier: 'lite',
    purpose: 'topic.link',
    promptVersion: prompt.ref,
    system: prompt.text,
    parts: [{ text: JSON.stringify({ yeniBelge: view(profile), adayKonular: candidates.map((c, i) => ({ topicIndex: i, ...view(c.profile) })) }) }],
    schema: Pick,
    thinking: 'low',
    context: { runId: ctx.runId, workItemId: ctx.workItemId, stepKey: 'topic.link' },
  })
  const c = res.data.topicIndex === null ? null : candidates[res.data.topicIndex]
  return c ? { topicId: c.topicId, reason: res.data.reason } : null
}
