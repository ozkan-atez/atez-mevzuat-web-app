import { describe, expect, it } from 'vitest'
import { decodeChatAttachment } from '../../src/modules/chat/application/chat-attachment'

describe('decodeChatAttachment', () => {
  it('accepts a bounded PDF and preserves its bytes', () => {
    const bytes = Buffer.from('%PDF-1.7\nexample')
    expect(decodeChatAttachment({ name: 'rapor.pdf', mediaType: 'application/pdf', data: bytes.toString('base64') }))
      .toMatchObject({ name: 'rapor.pdf', mediaType: 'application/pdf', bytes })
  })

  it('rejects an unsupported type, forged PDF, and oversized input', () => {
    expect(() => decodeChatAttachment({ name: 'script.sh', mediaType: 'application/x-sh', data: 'YQ==' })).toThrow(/desteklenmiyor/)
    expect(() => decodeChatAttachment({ name: 'rapor.pdf', mediaType: 'application/pdf', data: 'YQ==' })).toThrow(/PDF/)
    expect(() => decodeChatAttachment({ name: 'huge.txt', mediaType: 'text/plain', data: Buffer.alloc(5_000_001).toString('base64') })).toThrow(/çok büyük/)
  })
})
