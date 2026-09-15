import { describe, expect, it } from 'vitest'
import { toGeminiJsonSchema, toGeminiResponseSchema, toGeminiShallowSchema } from '../../src/modules/ai/application/gemini-json-schema'

describe('toGeminiJsonSchema', () => {
  it('removes unsupported constraints, keeps length bounds and converts const to enum recursively', () => {
    expect(toGeminiJsonSchema({
      type: 'object', additionalProperties: false, properties: {
        version: { type: 'integer', const: 1 },
        code: { type: 'string', pattern: '^A$', minLength: 1, maxLength: 8, format: 'uri' },
      }, required: ['version', 'code'],
    })).toEqual({
      type: 'object', additionalProperties: false, properties: {
        version: { type: 'integer', enum: [1] },
        code: { type: 'string', minLength: 1, maxLength: 8 },
      }, required: ['version', 'code'],
    })
  })

  it('keeps required top-level fields while bounding nested object complexity', () => {
    const shallow = toGeminiShallowSchema({ type: 'object', required: ['document'], properties: {
      document: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' } } },
      rows: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } } },
    } }, 1)
    expect(shallow).toMatchObject({ type: 'object', required: ['document'], properties: { document: { type: 'object' }, rows: { type: 'array', items: { type: 'object' } } } })
    expect(JSON.stringify(shallow)).not.toContain('title\"]')
    expect((shallow.properties as Record<string, Record<string, unknown>>).document).not.toHaveProperty('additionalProperties')
  })

  it('keeps array element fields because list wrappers do not consume the depth budget', () => {
    const shallow = toGeminiShallowSchema({ type: 'object', required: ['parties'], properties: {
      parties: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['name'], properties: {
          name: { type: 'string', minLength: 1 },
          detail: { type: 'object', additionalProperties: false, required: ['note'], properties: { note: { type: 'string' } } },
        },
      } },
    } }, 2)
    const properties = shallow.properties as Record<string, Record<string, unknown>>
    const items = properties.parties!.items as Record<string, unknown>
    expect(items).toMatchObject({ required: ['name'], properties: { name: { type: 'string', minLength: 1 } } })
    expect((items.properties as Record<string, Record<string, unknown>>).detail!).not.toHaveProperty('properties')
  })

  it('drops array cardinality bounds that Gemini rejects in response schemas', () => {
    const schema = { type: 'object', properties: {
      ids: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1 } },
    } }
    expect(toGeminiJsonSchema(schema)).toMatchObject({ properties: { ids: { minItems: 1, maxItems: 20 } } })
    const response = toGeminiResponseSchema(schema)
    expect(JSON.stringify(response)).not.toContain('minItems')
    expect(JSON.stringify(response)).not.toContain('maxItems')
    expect(response).toMatchObject({ properties: { ids: { type: 'array', items: { type: 'string', minLength: 1 } } } })
  })

  it('omits array bounds from the shallow response schema', () => {
    const shallow = toGeminiShallowSchema({ type: 'object', properties: {
      rows: { type: 'array', minItems: 1, items: { type: 'object', required: ['value'], properties: { value: { type: 'string', minLength: 1 } } } },
    } }, 2)
    expect(JSON.stringify(shallow)).not.toContain('minItems')
    expect(shallow).toMatchObject({ properties: { rows: { items: { required: ['value'], properties: { value: { minLength: 1 } } } } } })
  })
})
