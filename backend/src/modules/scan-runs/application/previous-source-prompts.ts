import { createHash } from 'node:crypto'
import type { AiInputPart, StructuredAiRequest } from '../../ai/application/ai-model-client'
import { previousSourceResponseJsonSchema } from './previous-source-schemas'

export const PREVIOUS_SOURCE_PROMPT_VERSION = 'previous-source-preflight-v3-document'

export interface PreviousSourcePreflightInput {
  documentId: string
  title: string
  publicationDate: string
  sourceUrl: string
  documentType: string | null
  visibleText: string
  documentParts?: AiInputPart[]
}

const systemInstruction = `Sen kaynak belgelerden mevzuat kimliği çıkarma sistemisin. Belge resmî yayın, kurum duyurusu veya meslek kuruluşu haberi olabilir; ikincil kaynağı resmî yayın olarak sunma. Görevin rapor veya hukuki analiz yazmak değil, yalnızca önceki kaynak aramasını daraltacak kısa ve kesin bir arama niyeti üretmektir.
Metinde değiştirilen, kaldırılan, süresi uzatılan veya uygulanan önceki mevzuatın adını ve kimliğini aynen ayıkla. Güncel yayının Karar/Tebliğ numarasını hedef mevzuat numarası sanma.
Açık bir Tebliğ No (örneğin 2018/5), karar numarası veya yönetmelik adı varsa ilk sorgu adayı en ayırt edici tam kimlik olsun. En fazla üç sorgu üret. Önceki kaynağa gerek yoksa relationship NONE kullan.`

export const PREVIOUS_SOURCE_CONFIGURATION_HASH = createHash('sha256')
  .update(JSON.stringify({ promptVersion: PREVIOUS_SOURCE_PROMPT_VERSION, systemInstruction, schema: previousSourceResponseJsonSchema }))
  .digest('hex')

export function buildPreviousSourcePreflightRequest(input: PreviousSourcePreflightInput, model: string): {
  request: StructuredAiRequest
  configurationHash: string
} {
  const payload = {
    documentId: input.documentId,
    title: input.title,
    publicationDate: input.publicationDate,
    sourceUrl: input.sourceUrl,
    documentType: input.documentType,
    visibleText: input.visibleText.slice(0, 12_000),
  }
  return {
    configurationHash: PREVIOUS_SOURCE_CONFIGURATION_HASH,
    request: {
      model,
      systemInstruction,
      parts: [{ text: JSON.stringify(payload) }, ...(input.documentParts ?? [])],
      responseJsonSchema: previousSourceResponseJsonSchema,
    },
  }
}

/** Official search treats long phrases differently; always try the exact number first. */
export function buildPreviousSourceQueries(intent: {targetRegulationIdentifier: string | null; queryCandidates: string[]}): string[] {
  return [...new Set([intent.targetRegulationIdentifier, ...intent.queryCandidates].filter((value): value is string => Boolean(value?.trim())).map(value => value.trim()))]
}
