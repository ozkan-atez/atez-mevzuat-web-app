import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { sha256 } from '@atez/platform'

/** Kaynak tanımı (§9; sürümlü config). Aşama 2'de yalnızca GAZETTE taşıması kullanılıyor. */
export const SourceDefinition = z.object({
  id: z.string(),
  version: z.number().int(),
  title: z.string(),
  transport: z.enum(['GAZETTE', 'HTTP', 'BROWSER', 'TARIFF_API']),
  trustClass: z.enum(['VERIFIED_OFFICIAL', 'SOURCE_UNVERIFIED', 'SUPPORTING_NON_AUTHORITATIVE', 'COMMERCIAL']),
  fetch: z.object({
    allowedHosts: z.array(z.string()).min(1),
    minIntervalMs: z.number().int().default(0),
    timeoutMs: z.number().int().default(60_000),
    maxAttachmentsPerDocument: z.number().int().default(30),
  }),
  policy: z.object({
    titleKeywordSet: z.string(),
    topicRole: z.enum(['PRIMARY', 'SUPPORTING', 'SIGNAL']),
    slots: z.array(z.string()).default([]),
  }),
})
export type SourceDefinition = z.infer<typeof SourceDefinition>

export const TitleKeywordSet = z.object({ key: z.string(), description: z.string().optional(), outTitlePatterns: z.array(z.string()) })
export type TitleKeywordSet = z.infer<typeof TitleKeywordSet> & { ref: string }

const safeName = (n: string) => {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(n)) throw new Error(`Geçersiz config adı: ${n}`)
  return n
}

export function loadSourceDefinition(configDir: string, sourceId: string): SourceDefinition {
  return SourceDefinition.parse(JSON.parse(readFileSync(join(configDir, 'sources', `${safeName(sourceId)}.json`), 'utf8')))
}

export function loadKeywordSet(configDir: string, key: string): TitleKeywordSet {
  const raw = readFileSync(join(configDir, 'keyword-sets', `${safeName(key)}.json`), 'utf8')
  return { ...TitleKeywordSet.parse(JSON.parse(raw)), ref: `${key}@${sha256(raw).slice(0, 8)}` }
}

export interface Prompt {
  name: string
  text: string
  /** `ad@içerik-hash'i`: prompt değişince önbellek anahtarı da değişir. */
  ref: string
}

export function loadPrompt(configDir: string, name: string): Prompt {
  const text = readFileSync(join(configDir, 'prompts', `${safeName(name)}.md`), 'utf8')
  return { name, text, ref: `${name}@${sha256(text).slice(0, 8)}` }
}
