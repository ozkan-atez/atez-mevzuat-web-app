import { ProfileModelOutput, type FileRef, type StepInput, type StepOutput } from '@atez/contracts'
import type { StepHandler } from '@atez/engine'
import { PermanentError, StorageKeys, sha256, type AiPart } from '@atez/platform'
import { checkQuotes, documents, finalizeProfile, loadPrompt, mergeSegments, offsetPages, visibleText, type QuoteSource } from '@atez/modules'
import type { StepDeps } from './deps'

const PROMPT = 'classify-profile.v1'

/**
 * `classify.profile` (§6): ham belge (PDF/HTML/görsel) doğrudan Gemini'ye verilir; OCR yok (K11).
 * Belge en başta, talimat sonda (örtük önbellek). Büyük PDF parçaları ayrı çağrılarla okunur ve
 * kodla birleştirilir. Alıntılar metin görünümü olan girdilerde birebir doğrulanır; tek onarım
 * turundan sonra bulunamazsa karar REVIEW olur.
 */
export const classifyProfile: StepHandler<StepInput<'classify.profile'>, StepOutput<'classify.profile'>, StepDeps> = {
  key: 'classify.profile',
  versions: (ctx) => ({
    handler: '1',
    schema: '1',
    prompt: loadPrompt(ctx.deps.configDir, PROMPT).ref,
    model: ctx.deps.ai?.modelFor('main') ?? 'none',
    media: ctx.deps.ai?.config.mediaResolution ?? 'none',
  }),
  // Adım sürüme özgü yan etki (document_profile) üretir; kimlik sürümü de içerir.
  cacheIdentity: (input) => sha256([input.documentVersionId, input.contentHash, ...input.modelInputs.map((f) => `${f.label}:${f.sha256}`), ...input.skipped.map((s) => s.label)].join('|')),
  async run(input, ctx) {
    const ai = ctx.deps.ai
    if (!ai) throw new PermanentError('AI geçidi yapılandırılmamış (VERTEX_PROJECT/VERTEX_LOCATION)', 'AI_NOT_CONFIGURED')
    const { db, store } = ctx.deps
    if (input.modelInputs.length === 0) throw new PermanentError('Modele verilecek dosya yok', 'NO_MODEL_INPUT')
    const prompt = loadPrompt(ctx.deps.configDir, PROMPT)
    const version = await documents.getVersion(db, input.documentVersionId)
    const doc = version ? await documents.getDocument(db, version.documentId) : null
    if (!version || !doc) throw new PermanentError('Belge sürümü yok', 'DOCUMENT_MISSING')
    const manifest = version.manifestKey ? (JSON.parse((await store.get(version.manifestKey)).toString('utf8')) as { hints?: unknown; skippedLinks?: unknown }) : {}
    const listCtx = (doc.listContext ?? {}) as { rgIssue?: string | null; mukerrer?: number | null; rgSection?: string | null; rgType?: string | null }
    const publication = { date: doc.publishedOn, rgIssue: listCtx.rgIssue ?? null, mukerrer: listCtx.mukerrer ?? null }

    const segments = buildSegments(input.modelInputs, ai.config.inlineBudgetBytes)
    const profileVersion = await documents.nextProfileVersion(db, input.documentVersionId)
    const rawKey = StorageKeys.profileRaw(input.documentVersionId, profileVersion)
    const raws: { segment: string; aiCallId: string; text: string }[] = []
    const aiCallIds: string[] = []
    const results: { label: string; profile: ProfileModelOutput }[] = []
    let quoteChecked = 0
    let repairRounds = 0
    const missingAll: string[] = []

    for (const [si, seg] of segments.entries()) {
      const fileParts: AiPart[] = []
      const quoteSources: QuoteSource[] = []
      for (const f of seg) {
        const body = await store.get(f.objectKey)
        fileParts.push({ text: `=== Dosya ${f.label} · ${describe(f)} ===` })
        if (f.mime === 'text/html') {
          const html = body.toString('utf8')
          fileParts.push({ text: html })
          quoteSources.push({ label: f.label, text: visibleText(html) })
        } else {
          fileParts.push({ inline: { mime: f.mime, data: body } })
          quoteSources.push({ label: f.label, text: null })
        }
      }
      const context = {
        başlık: doc.title,
        kaynak: doc.sourceId,
        tür: listCtx.rgType ?? null,
        bölüm: listCtx.rgSection ?? null,
        yayımTarihi: publication.date,
        rgSayısı: publication.rgIssue,
        mükerrer: publication.mukerrer,
        dosyalar: seg.map((f) => ({ etiket: f.label, tür: f.mime, ...(f.pageRange ? { sayfa: f.pageRange[1] - f.pageRange[0] + 1 } : {}) })),
        okunamayanDosyalar: input.skipped,
        ipuçları: manifest.hints ?? null,
        parça: segments.length > 1 ? `${si + 1}/${segments.length} (her parça ayrı okunur; yalnızca bu parçadaki içeriğe göre yaz)` : null,
      }
      const instruction = `## Bağlam\n${JSON.stringify(context, null, 1)}\n\nYukarıdaki belge için Belge Profili JSON'unu üret.`
      const call = async (extra?: string) => {
        const res = await ai.generate({
          tier: 'main',
          purpose: 'classify.profile',
          promptVersion: prompt.ref,
          system: prompt.text,
          parts: [...fileParts, { text: extra ? `${instruction}\n\n${extra}` : instruction }],
          schema: ProfileModelOutput,
          mediaResolution: ai.config.mediaResolution,
          context: { runId: ctx.runId, workItemId: ctx.workItemId, stepKey: ctx.stepKey },
          responseKey: rawKey,
        })
        aiCallIds.push(res.aiCallId)
        raws.push({ segment: seg.map((f) => f.label).join(','), aiCallId: res.aiCallId, text: res.text })
        return res.data
      }
      let data = await call()
      let check = checkQuotes(data.basisQuotes, quoteSources)
      if (check.missing.length) {
        repairRounds++
        data = await call(
          `Önceki yanıtındaki şu alıntılar belgede birebir bulunamadı:\n${check.missing.map((q) => `- "${q}"`).join('\n')}\nAlıntıları belgeden harfi harfine kopyalayarak profili yeniden üret.`,
        )
        check = checkQuotes(data.basisQuotes, quoteSources)
      }
      quoteChecked += check.checked
      missingAll.push(...check.missing)
      const part = seg.length === 1 && seg[0]!.role === 'PART' ? seg[0]! : null
      const offset = part?.pageRange ? part.pageRange[0] - 1 : 0
      results.push({ label: seg.map((f) => f.label).join('+'), profile: offset ? offsetPages(data, () => offset) : data })
    }

    const pdfPages = input.modelInputs.filter((f) => f.pageRange).reduce((a, f) => a + (f.pageRange![1] - f.pageRange![0] + 1), 0)
    const allPagesKnown = input.modelInputs.every((f) => f.mime !== 'application/pdf' || f.pageRange)
    const expectedFiles = new Set(input.modelInputs.map((f) => f.label.split('#')[0])).size
    const profile = finalizeProfile(mergeSegments(results), {
      documentVersionId: input.documentVersionId,
      contentHash: input.contentHash,
      publication,
      expected: { files: expectedFiles, pages: allPagesKnown && pdfPages ? pdfPages : null },
      skipped: input.skipped,
      quoteCheck: {
        status: missingAll.length ? 'FAILED' : quoteChecked ? 'VERIFIED' : 'NOT_CHECKED',
        checked: quoteChecked,
        missing: missingAll,
        repairRounds,
      },
      parts: segments.length > 1 ? segments.map((s) => ({ label: s.map((f) => f.label).join('+'), pageRange: s.length === 1 ? s[0]!.pageRange : null })) : [],
      generatedBy: { model: ai.modelFor('main'), promptVersion: prompt.ref, aiCallIds },
    })
    // Parça birleştirmede model dosya sayısını parça başına bildirir; kapsamı özgün dosya sayısıyla karşılaştır.
    if (segments.length > 1) profile.coverage.read.files = Math.min(profile.coverage.read.files, expectedFiles)

    const key = StorageKeys.profile(input.documentVersionId, profileVersion)
    await store.put(rawKey, JSON.stringify(raws, null, 2), 'application/json')
    await store.put(key, JSON.stringify(profile, null, 2), 'application/json')
    const profileId = await db.transaction(async (tx) => {
      const id = await documents.insertProfile(tx, {
        documentVersionId: input.documentVersionId,
        version: profileVersion,
        decision: profile.decision,
        docType: profile.identity.docType,
        officialNumber: profile.identity.officialNumber,
        institution: profile.identity.institution,
        publicationDate: publication.date,
        changeKind: profile.change.kind,
        gtipCodes: profile.gtip.codes.map((c) => c.code),
        sectors: profile.affected.sectors,
        keywords: profile.keywords,
        confidence: profile.confidence,
        needsPrior: profile.lineage.needsPrior ? profile.lineage.strategyHint : 'NONE',
        objectKey: key,
        model: ai.modelFor('main'),
        promptVersion: prompt.ref,
      })
      await documents.setDocumentState(tx, doc.id, 'PROFILED')
      return id
    })
    ctx.log.info('profile written', { documentId: doc.id, decision: profile.decision, segments: segments.length, quoteCheck: profile.quoteCheck.status })
    return { documentVersionId: input.documentVersionId, profileId, profileVersion, decision: profile.decision, objectKey: key }
  },
}

function describe(f: FileRef): string {
  if (f.role === 'PART' && f.pageRange) return `PDF parçası (özgün belgenin ${f.pageRange[0]}–${f.pageRange[1]}. sayfaları; sayfa numaralarını bu dosyanın içine göre 1'den başlayarak ver)`
  if (f.mime === 'application/pdf') return `PDF${f.pageRange ? `, ${f.pageRange[1]} sayfa` : ''}`
  if (f.mime === 'text/html') return 'HTML (metin)'
  return `görsel (${f.mime})`
}

/** PART'lar tek başına; diğer dosyalar bayt bütçesi içinde bir araya toplanır. */
export function buildSegments(files: FileRef[], budget: number): FileRef[][] {
  const sorted = [...files].sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }))
  const segments: FileRef[][] = []
  let current: FileRef[] = []
  let size = 0
  for (const f of sorted) {
    if (f.role === 'PART') {
      segments.push([f])
      continue
    }
    if (current.length && size + f.bytes > budget) {
      segments.push(current)
      current = []
      size = 0
    }
    current.push(f)
    size += f.bytes
  }
  if (current.length) segments.push(current)
  return segments
}
