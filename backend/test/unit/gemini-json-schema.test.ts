import { describe, expect, it } from 'vitest'
import { toGeminiJsonSchema } from '../../src/modules/ai/application/gemini-json-schema'

describe('toGeminiJsonSchema', () => {
  it('removes unsupported constraints and converts const to enum recursively', () => {
    expect(toGeminiJsonSchema({
      type: 'object', additionalProperties: false, properties: {
        version: { type: 'integer', const: 1 },
        code: { type: 'string', pattern: '^A$', minLength: 1 },
      }, required: ['version', 'code'],
    })).toEqual({
      type: 'object', additionalProperties: false, properties: {
        version: { type: 'integer', enum: [1] },
        code: { type: 'string' },
      }, required: ['version', 'code'],
    })
  })
})
