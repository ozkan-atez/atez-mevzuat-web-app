const SUPPORTED_SCHEMA_KEYS = new Set([
  '$id', '$defs', '$ref', '$anchor', 'type', 'title', 'description', 'enum',
  'items', 'prefixItems', 'minItems', 'maxItems', 'minimum', 'maximum', 'anyOf', 'oneOf',
  'minLength', 'maxLength',
  'properties', 'additionalProperties', 'required', 'propertyOrdering',
])

export function toGeminiJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return normalizeSchema(schema) as Record<string, unknown>
}

// Gemini rejects array cardinality bounds in responseJsonSchema, so they are dropped
// before a schema is used as a response contract. Zod re-checks them after generation.
export function toGeminiResponseSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return dropArrayBounds(normalizeSchema(schema)) as Record<string, unknown>
}

export function toGeminiShallowSchema(schema: Record<string, unknown>, maxPropertyDepth = 2): Record<string, unknown> {
  return shallowSchema(schema, 0, maxPropertyDepth) as Record<string, unknown>
}

function normalizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSchema)
  if (!value || typeof value !== 'object') return value
  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  if ('const' in input) output.enum = [input.const]
  for (const [key, child] of Object.entries(input)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) continue
    if (key === 'properties' || key === '$defs') {
      output[key] = Object.fromEntries(Object.entries(child as Record<string, unknown>).map(([name, property]) => [name, normalizeSchema(property)]))
    } else {
      output[key] = normalizeSchema(child)
    }
  }
  return output
}

function shallowSchema(value: unknown, depth: number, maxDepth: number): unknown {
  if (Array.isArray(value)) return value.map((item) => shallowSchema(item, depth, maxDepth))
  if (!value || typeof value !== 'object') return value
  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  // Gemini rejects array cardinality bounds in responseJsonSchema; Zod re-checks them after generation.
  for (const key of ['type', 'title', 'description', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength']) {
    if (key in input) output[key] = input[key]
  }
  if (depth < maxDepth && input.properties && typeof input.properties === 'object') {
    output.properties = Object.fromEntries(Object.entries(input.properties as Record<string, unknown>).map(([name, property]) => [name, shallowSchema(property, depth + 1, maxDepth)]))
    if (input.required) output.required = input.required
    if ('additionalProperties' in input) output.additionalProperties = input.additionalProperties
  }
  if (input.items) output.items = shallowSchema(input.items, depth, maxDepth)
  if (input.anyOf) output.anyOf = shallowSchema(input.anyOf, depth, maxDepth)
  return output
}

function dropArrayBounds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropArrayBounds)
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'minItems' || key === 'maxItems') continue
    output[key] = dropArrayBounds(child)
  }
  return output
}
