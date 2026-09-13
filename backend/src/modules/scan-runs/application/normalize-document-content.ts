import { load } from 'cheerio'
import type { AiInputPart } from '../../ai/application/ai-model-client'
import { AiProviderError } from '../../ai/domain/ai-errors'

interface Input {
  id: string
  title: string
  mediaType: string
  bytes: Buffer
}

export function normalizeDocumentContent(input: Input): AiInputPart[] {
  const metadata = `Belge kimliği: ${input.id}\nBaşlık: ${input.title}`
  if (input.mediaType === 'text/html') {
    const $ = load(input.bytes.toString('utf8'))
    $('script, style, nav, header, footer, aside, noscript').remove()
    $('br').replaceWith('\n')
    $('h1, h2, h3, h4, h5, h6, p, li, tr').each((_index, element) => {
      $(element).append('\n')
    })
    const text = $('body').text().replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    return [{ text: `${metadata}\nİçerik:\n${text}` }]
  }
  if (input.mediaType === 'text/plain') {
    return [{ text: `${metadata}\nİçerik:\n${input.bytes.toString('utf8')}` }]
  }
  if (input.mediaType === 'application/pdf') {
    return [{ text: metadata }, { inlineData: { mimeType: input.mediaType, data: input.bytes.toString('base64') } }]
  }
  throw new AiProviderError('CONTENT_REJECTED', false, `Belge filtresi için desteklenmeyen içerik türü: ${input.mediaType}`)
}
