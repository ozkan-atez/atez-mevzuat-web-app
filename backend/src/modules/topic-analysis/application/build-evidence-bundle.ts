import { createHash } from 'node:crypto'
import type { AiInputPart } from '../../ai/application/ai-model-client'
import { normalizeDocumentContent } from '../../scan-runs/application/normalize-document-content'
import type { EvidenceContext, EvidencePart, TopicEvidenceInput, TopicObjectStore, TopicStoredObject } from './ports'

interface Candidate {
  sourceId: string
  title: string
  sourceUrl: string
  object: TopicStoredObject
}

export async function buildEvidenceBundle(
  topic: TopicEvidenceInput,
  objectStore: TopicObjectStore,
  options: { maxContextBytes: number },
): Promise<EvidenceContext> {
  const candidates: Candidate[] = [
    { sourceId: 'current-document', title: topic.document.title, sourceUrl: topic.document.sourceUrl, object: topic.document.object },
    ...topic.document.assets.map((asset) => ({ sourceId: `current-asset:${asset.id}`, title: asset.sourceUrl, sourceUrl: asset.sourceUrl, object: asset.object })),
    ...(topic.previousSource ? [
      { sourceId: 'previous-document', title: topic.previousSource.title, sourceUrl: topic.previousSource.sourceUrl, object: topic.previousSource.object },
      ...topic.previousSource.assets.map((asset) => ({ sourceId: `previous-asset:${asset.id}`, title: asset.sourceUrl, sourceUrl: asset.sourceUrl, object: asset.object })),
    ] : []),
  ]

  const officialBytes = candidates.reduce((total, candidate) => total + candidate.object.byteSize, 0n)
  if (officialBytes > BigInt(options.maxContextBytes)) {
    throw new Error(`Topic kanıt paketi Gemini bağlam sınırını aşıyor: ${officialBytes} > ${options.maxContextBytes}`)
  }
  // Curated references are supplementary; they must never crowd out official evidence.
  let remaining = BigInt(options.maxContextBytes) - officialBytes
  const managedSources = (topic.managedSources ?? []).filter((source) => {
    const size = BigInt(Buffer.byteLength(source.contentText) + Buffer.byteLength(source.title + source.sourceUrl + (source.description ?? '')) + 300)
    if (size > remaining) return false
    remaining -= size
    return true
  })

  const parts: EvidencePart[] = []
  const aiParts: AiInputPart[] = [
    ...(topic.sourceOrigin ? [{text:`Belgenin asıl kaynağı: ${topic.sourceOrigin.name}. Yetki sınıfı: ${topic.sourceOrigin.authority}. Bu bir Resmî Gazete belgesi değildir. ${topic.sourceOrigin.publicationDateKnown===false?'Yayın tarihi bilinmiyor. Hedef tarih yalnızca tarama tarihidir; yayın tarihi veya yürürlük tarihi olarak kullanma.':''} Kimlik sözleşmesindeki gazetteDate yayın tarihini, gazetteNumber kaynak adını temsil eder; Resmî Gazete sayısı uydurma. SUPPORTING/COMMERCIAL/PROFESSIONAL belgeleri destekleyici bağlamdır; resmi hukuki hüküm gibi sunma. Kaynak künyesinde gerçek URL ve kaynak adını koru.`}] : []),{ text: `Topic kimliği: ${topic.topicId}\nÖnceki kaynak paketi: ${topic.previousSource ? 'VAR' : 'YOK; önceki hüküm ve eski–yeni karşılaştırması üretme'}\nHedef tarih: ${topic.targetDate}\nBelge başlığı: ${topic.document.title}` }]
  for (const candidate of candidates) {
    const bytes = await objectStore.getContent(candidate.object.objectKey)
    parts.push({
      topicId: topic.topicId,
      sourceId: candidate.sourceId,
      title: candidate.title,
      sourceUrl: candidate.sourceUrl,
      objectKey: candidate.object.objectKey,
      sha256: candidate.object.sha256,
      mediaType: candidate.object.mediaType,
      byteSize: candidate.object.byteSize.toString(),
    })
    aiParts.push({ text: `Kanıt kimliği: ${candidate.sourceId}\nKaynak URL: ${candidate.sourceUrl}\nDepolanmış kanıt objectKey: ${candidate.object.objectKey}` })
    aiParts.push(...toAiParts(candidate, bytes))
  }
  for (const source of managedSources) {
    aiParts.push({ text: [
      `Destekleyici kullanıcı kaynağı kimliği: managed-source:${source.id}`,
      `Başlık: ${source.title}`,
      `Kaynak URL: ${source.sourceUrl}`,
      `Alınma zamanı: ${source.fetchedAt}`,
      source.description ? `Açıklama: ${source.description}` : '',
      'Bu kaynak resmî Resmî Gazete belgesi değildir; resmî metinle çelişirse resmî metni esas al.',
      `Kaynak metni:\n${source.contentText}`,
    ].filter(Boolean).join('\n') })
  }

  const manifestValue = {
    schemaVersion: 2,
    ...(topic.sourceOrigin ? {sourceOrigin:topic.sourceOrigin} : {}),
    topicId: topic.topicId,
    runId: topic.runId,
    targetDate: topic.targetDate,
    parts,
    managedSources: managedSources.map((source) => ({
      id: source.id, title: source.title, sourceUrl: source.sourceUrl, fetchedAt: source.fetchedAt,
      textSha256: createHash('sha256').update(source.contentText).digest('hex'),
      contentText: source.contentText,
    })),
  }
  const manifest = Buffer.from(JSON.stringify(manifestValue))
  const signature = createHash('sha256').update(manifest).digest('hex')
  return { topicId: topic.topicId, signature, parts, aiParts, manifest }
}

function toAiParts(candidate: Candidate, bytes: Buffer): AiInputPart[] {
  if (candidate.object.mediaType.startsWith('image/')) {
    return [{ inlineData: { mimeType: candidate.object.mediaType, data: bytes.toString('base64') } }]
  }
  return normalizeDocumentContent({
    id: candidate.sourceId,
    title: candidate.title,
    mediaType: candidate.object.mediaType,
    bytes,
  })
}
