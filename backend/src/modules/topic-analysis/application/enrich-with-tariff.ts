import { createHash } from 'node:crypto'
import type { AiModelClient, AiInputPart } from '../../ai/application/ai-model-client'
import { normalizeDocumentContent } from '../../scan-runs/application/normalize-document-content'
import { normalizeGtip, type TariffLookup, type TariffLookupResult } from '../../tariff/tariff-lookup'
import type { EvidenceContext, TopicEvidenceInput, TopicObjectStore } from './ports'

const GTIP = /(?<!\d)(\d{4}[.\s]+\d{2}(?:[.\s]+\d{2}){0,3}|\d{12})(?!\d)/g
const MAX_CODES = 100
const MAX_TARIFF_CONTEXT_BYTES = 120_000

/** Tariff is supplementary: an outage can never invalidate official evidence. */
export async function enrichWithTariff(input: {
  topic: TopicEvidenceInput
  evidence: EvidenceContext
  objectStore: TopicObjectStore
  aiModel: AiModelClient
  model: string
  lookup: TariffLookup
}): Promise<EvidenceContext> {
  const officialParts: AiInputPart[] = []
  const extracted = new Set<string>()
  const candidates = [
    { id: 'current-document', title: input.topic.document.title, object: input.topic.document.object },
    ...input.topic.document.assets.map((asset) => ({ id: `current-asset:${asset.id}`, title: asset.sourceUrl, object: asset.object })),
  ]
  for (const candidate of candidates) {
    const bytes = await input.objectStore.getContent(candidate.object.objectKey)
    const parts: AiInputPart[] = candidate.object.mediaType.startsWith('image/')
      ? [{ text: `Belge eki: ${candidate.title}` }, { inlineData: { mimeType: candidate.object.mediaType, data: bytes.toString('base64') } }]
      : ['text/html', 'text/plain', 'application/pdf'].includes(candidate.object.mediaType)
        ? normalizeDocumentContent({ id: candidate.id, title: candidate.title, mediaType: candidate.object.mediaType, bytes }) : []
    officialParts.push(...parts)
    for (const part of parts) if ('text' in part) for (const match of part.text.matchAll(GTIP)) {
      const nearby = part.text.slice(Math.max(0, match.index - 90), Math.min(part.text.length, match.index + match[0].length + 90))
      if (!/gt[iİıI]p|g\.t\.i\.p|tarife|pozisyon|eşya kodu/i.test(nearby)) continue
      try { extracted.add(normalizeGtip(match[0])) } catch { /* a number in prose is not necessarily a code */ }
    }
  }
  try {
    const response = await input.aiModel.generateStructured({
      model: input.model,
      systemInstruction: 'Yalnızca güncel resmî belge ve eklerindeki açıkça yazılmış bütün GTİP kodlarını bul. Tarih, karar numarası ve tutarları GTİP sayma. Kodları 6-12 rakam olarak döndür. Eklerdeki tablo satırlarını da tara. Yanıt yalnızca JSON olsun.',
      parts: officialParts,
      responseJsonSchema: { type: 'object', properties: { codes: { type: 'array', items: { type: 'string' } } }, required: ['codes'] },
    })
    const codes = response.json && typeof response.json === 'object' ? Reflect.get(response.json, 'codes') : null
    if (Array.isArray(codes)) for (const code of codes) if (typeof code === 'string') {
      try { extracted.add(normalizeGtip(code)) } catch { /* ignore non-GTİP model output */ }
    }
  } catch {
    // Textual GTİPs remain usable when the optional extraction request fails.
  }
  if (extracted.size === 0) return input.evidence

  const codes = [...extracted].slice(0, MAX_CODES)
  const results: Array<TariffLookupResult | { code: string; error: string }> = new Array(codes.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, codes.length) }, async () => {
    while (next < codes.length) {
      const index = next++
      const code = codes[index]!
      try { results[index] = await input.lookup.lookup({ code, date: input.topic.targetDate }) }
      catch { results[index] = { code, error: 'Tariff sorgusu bu GTİP için tamamlanamadı.' } }
    }
  }))
  const root = `runs/${input.topic.targetDate.replaceAll('-', '/')}/${input.topic.runId}/topics/${input.topic.topicId}/evidence/tariff`
  const tariffParts = []
  const aiParts = [...input.evidence.aiParts]
  let contextBytes = 0
  for (const result of results) {
    const body = Buffer.from(JSON.stringify(result))
    const stored = await input.objectStore.putRunFile(`${root}/${result.code}.json`, body, 'application/json')
    const sourceUrl = 'source' in result ? result.source : 'https://tariff.singlewindow.io/'
    const sourceId = `tariff:${result.code}`
    tariffParts.push({ topicId: input.topic.topicId, sourceId, title: `Tariff GTİP ${result.code}`, sourceUrl,
      objectKey: stored.objectKey, sha256: stored.sha256, mediaType: stored.mediaType, byteSize: stored.byteSize.toString() })
    if (contextBytes + body.byteLength <= MAX_TARIFF_CONTEXT_BYTES) {
      aiParts.push({ text: `Destekleyici Tariff kanıt kimliği: ${sourceId}\nNesne anahtarı: ${stored.objectKey}\nKaynak URL: ${sourceUrl}\nAlınma zamanı: ${'fetchedAt' in result ? result.fetchedAt : 'bilinmiyor'}\nBu veri resmî hukuki kanıt değildir. Önceki ve güncel değerleri yalnızca doğrulanmış satırlardan karşılaştır. Ürün adını yalnızca description doluysa kullan.\nTariff verisi: ${body.toString('utf8')}` })
      contextBytes += body.byteLength
    }
  }
  if (extracted.size > MAX_CODES) aiParts.push({ text: `GTİP sayısı ${MAX_CODES} sorgu sınırını aştı; kalan ${extracted.size - MAX_CODES} kod Tariff üzerinde doğrulanamadı.` })
  const manifest = Buffer.from(JSON.stringify({ ...JSON.parse(input.evidence.manifest.toString('utf8')) as Record<string, unknown>,
    parts: [...input.evidence.parts, ...tariffParts], tariff: { codes, omitted: Math.max(0, extracted.size - MAX_CODES), results: tariffParts } }))
  return { ...input.evidence, aiParts, parts: [...input.evidence.parts, ...tariffParts], manifest,
    signature: createHash('sha256').update(manifest).digest('hex') }
}
