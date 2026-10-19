import { createHash } from 'node:crypto'

export const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')

/** Anahtar sırası sabit JSON; hash ve önbellek anahtarları için. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortDeep(v)]),
    )
  }
  return value
}

export const hashJson = (value: unknown): string => sha256(canonicalJson(value))
