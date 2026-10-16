import { z } from 'zod'
import { researchNeedSchema } from './tariff-catalog'

export const requestSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), expectedMainLinks: z.number().int().positive().optional() }).strict()
export type GazetteRequest = z.infer<typeof requestSchema>
export type Entry = { id: string; title: string; url: string; kind: 'REGULATION' | 'ANNOUNCEMENT'; parentUrl: string; documentType?: string; section?: string; titleBasis?: 'SUBJECT_AND_INSTITUTION' | 'INSTITUTION_ONLY' }
export type Material = { id: string; url: string; mime: string; file: string; text: string; sha256: string; bytes: number; delivery: 'TEXT' | 'PDF' | 'IMAGE' | 'UNSUPPORTED'; errors: string[] }
export type Bundle = { entry: Entry; materials: Material[]; errors: string[] }
export type Index = { url: string; issueNumber: string; date: string; entries: Entry[]; supplementUrls: string[]; text: string }
export const decisionSchema = z.object({
  researchNeeds:z.array(researchNeedSchema).optional(),
  decision: z.enum(['IN', 'OUT', 'REVIEW']),
  summary: z.string(), reason: z.string().min(1),
  readable: z.boolean(),
  materials: z.array(z.object({ id: z.string(), readable: z.boolean(), issue: z.string() }).strict()),
  evidence: z.array(z.object({ materialId: z.string(), quote: z.string() }).strict()),
  evidenceVerification: z.enum(['EXACT_TEXT','VISUAL_REVIEW_REQUIRED','FAILED']).optional(),
}).strict()
export type Decision = z.infer<typeof decisionSchema>
export const titlesSchema = z.object({ items: z.array(z.object({ id: z.string(), decision: z.enum(['IN','OUT','REVIEW']), reason: z.string().min(1) }).strict()) }).strict()
export type TitleDecision = z.infer<typeof titlesSchema>['items'][number]
export interface Collector {
  index(date: string, url?: string): Promise<Index>
  collect(entry: Entry, followAssets?: boolean): Promise<Bundle>
  announcementEntries(entry: Entry, bundle: Bundle): Promise<Entry[]>
}
export interface Analyst {
  titles(entries: Entry[]): Promise<TitleDecision[]>
  analyze(bundle: Bundle): Promise<Decision>
}
export const cleanText = (text: string) => text.replace(/\s+/g, ' ').trim()
