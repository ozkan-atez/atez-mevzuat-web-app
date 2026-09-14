const SUPPORTED_SCHEMA_KEYS = new Set([
  '$id', '$defs', '$ref', '$anchor', 'type', 'format', 'title', 'description', 'enum',
  'items', 'prefixItems', 'minItems', 'maxItems', 'minimum', 'maximum', 'anyOf', 'oneOf',
  'properties', 'additionalProperties', 'required', 'propertyOrdering',
])

export function toGeminiJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return normalizeSchema(schema) as Record<string, unknown>
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
