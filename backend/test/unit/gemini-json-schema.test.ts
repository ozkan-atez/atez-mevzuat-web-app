import { describe, expect, it } from 'vitest'
import { toGeminiJsonSchema, toGeminiShallowSchema } from '../../src/modules/ai/application/gemini-json-schema'

describe('toGeminiJsonSchema', () => {
  it('removes unsupported constraints and converts const to enum recursively', () => {
    expect(toGeminiJsonSchema({
      type: 'object', additionalProperties: false, properties: {
        version: { type: 'integer', const: 1 },
        code: { type: 'string', pattern: '^A$', minLength: 1, format: 'uri' },
      }, required: ['version', 'code'],
    })).toEqual({
      type: 'object', additionalProperties: false, properties: {
        version: { type: 'integer', enum: [1] },
        code: { type: 'string' },
      }, required: ['version', 'code'],
    })
  })

  it('keeps required top-level fields while bounding nested object complexity', () => {
    const shallow = toGeminiShallowSchema({ type: 'object', required: ['document'], properties: {
      document: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
      rows: { type: 'array', items: { type: 'object', required: ['value'], properties: { value: { type: 'string' } } } },
    } }, 1)
    expect(shallow).toMatchObject({ type: 'object', required: ['document'], properties: { document: { type: 'object' }, rows: { type: 'array', items: { type: 'object' } } } })
    expect(JSON.stringify(shallow)).not.toContain('title\"]')
  })
})
