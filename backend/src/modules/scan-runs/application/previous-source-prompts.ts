import { createHash } from 'node:crypto'
import type { StructuredAiRequest } from '../../ai/application/ai-model-client'
import { previousSourceResponseJsonSchema } from './previous-source-schemas'

export const PREVIOUS_SOURCE_PROMPT_VERSION = 'previous-source-preflight-v1'

export interface PreviousSourcePreflightInput {
  documentId: string
  title: string
  publicationDate: string
  sourceUrl: string
  documentType: string | null
  visibleText: string
}

const systemInstruction = `Sen Resmî Gazete mevzuat kimliği çıkarma sistemisin. Görevin rapor veya hukuki analiz yazmak değil, yalnızca önceki kaynak aramasını daraltacak kısa ve kesin bir arama niyeti üretmektir.
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
      parts: [{ text: JSON.stringify(payload) }],
      responseJsonSchema: previousSourceResponseJsonSchema,
    },
  }
}
