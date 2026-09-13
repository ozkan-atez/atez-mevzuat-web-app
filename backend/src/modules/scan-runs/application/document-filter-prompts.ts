import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { z } from 'zod'
import type { AiInputPart, StructuredAiRequest } from '../../ai/application/ai-model-client'
import { contentFilterResponseJsonSchema, titleFilterResponseJsonSchema } from './document-filter-schemas'

export const TITLE_FILTER_PROMPT_VERSION = 'document-filter-title-v1'
export const CONTENT_FILTER_PROMPT_VERSION = 'document-filter-content-v1'

const keywordsSchema = z.object({
  l1: z.array(z.string().min(1)).min(1),
  l2: z.array(z.string().min(1)).min(1),
  l3: z.array(z.string().min(1)).min(1),
}).strict()

const keywordPath = fileURLToPath(new URL('../../../../config/document-filter-keywords.yaml', import.meta.url))
const keywordContext = keywordsSchema.parse(parse(readFileSync(keywordPath, 'utf8')))
const configurationHash = createHash('sha256').update(JSON.stringify(keywordContext)).digest('hex')

const baseInstruction = `Sen Türkiye gümrük ve dış ticaret mevzuatı konusunda uzman bir sınıflandırma sistemisin.
Her belgeyi anlamına ve hukuki etkisine göre değerlendir. Anahtar kelimeler yalnızca alan bağlamı sağlayan örnek sinyallerdir; kesin eşleştirme kuralları değildir.
Eş anlamlıları, düzenlenen kurumları, ürünleri, ticaret akışlarını, gümrük işlemlerini ve dolaylı düzenleyici etkileri dikkate al.
Her belge kimliğini yanıtta tam bir kez kullan ve kısa Türkçe gerekçe yaz.
Alan sinyalleri: ${JSON.stringify(keywordContext)}`

export interface TitleFilterDocumentInput {
  id: string
  title: string
  publicationOrder: number
  editionLabel: string
}

export function buildTitleFilterRequest(documents: TitleFilterDocumentInput[], model: string): {
  request: StructuredAiRequest
  configurationHash: string
} {
  return {
    configurationHash,
    request: {
      model,
      systemInstruction: `${baseInstruction}\nBaşlık aşamasında IN, OUT veya gerçekten içerik gerektiren durumda MAYBE kararı ver.`,
      parts: [{ text: JSON.stringify({ documents }) }],
      responseJsonSchema: titleFilterResponseJsonSchema,
    },
  }
}

export function buildContentFilterRequest(input: {
  model: string
  documentParts: AiInputPart[]
}): StructuredAiRequest {
  return {
    model: input.model,
    systemInstruction: `${baseInstruction}\nBu içerik aşamasında kesin karar ver; yalnızca IN veya OUT kullan, MAYBE kullanma.`,
    parts: input.documentParts,
    responseJsonSchema: contentFilterResponseJsonSchema,
  }
}
