import { TemplateReportSchema } from '../../workspace/template-definition'
import { z } from 'zod'
import { sanitizeReportFragment } from './sanitize-report-fragment'

const text = z.string().trim().min(1)
const httpUrl = z.string().url().refine((value) => /^https?:\/\//.test(value))
const blockId = z.enum(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10'])
const source = z.object({ label: text, url: z.union([httpUrl,z.literal('')]) }).strict()
export const ReportSourceSchema = z.object({
  id: z.string().min(1).max(100), label: text.max(300), url: z.union([httpUrl,z.literal('')]).default(''),
  content: z.string().trim().min(1).max(100_000),
  documentVersionId: z.string().uuid().optional(),
  kind: z.enum(['URL', 'TEXT', 'FILE']), fileName: z.string().max(300).optional(),
}).strict()
export const ReportCustomizationSchema = z.object({
  templateReport: TemplateReportSchema.nullable().optional(),
  headings: z.record(z.string().max(100), text.max(300)).default({}),
  order: z.array(z.string().min(1).max(100)).max(50).default([]),
  sections: z.array(z.object({id: z.string().regex(/^[a-zA-Z0-9-]+$/).max(80), title: text.max(300), html: z.string().max(100_000).transform(sanitizeReportFragment)}).strict()).max(30).default([]),
  sources: z.array(ReportSourceSchema).max(30).default([]),
  templateId: z.string().max(100).nullable().default(null),
  customHtml: z.string().max(500_000).transform(sanitizeReportFragment).nullable().default(null),
}).strict().superRefine((value, context) => {
  value.sources.forEach((source,index) => {if (source.kind === 'URL' && !source.url) context.addIssue({code:'custom',path:['sources',index,'url'],message:'URL kaynağı için HTTP bağlantısı gereklidir.'})})
  for (const key of ['sources', 'sections'] as const) if (new Set(value[key].map(item => item.id)).size !== value[key].length) context.addIssue({code: 'custom', path: [key], message: 'Kimlikler benzersiz olmalıdır.'})
})
export type ReportCustomization = z.infer<typeof ReportCustomizationSchema>
const customization = ReportCustomizationSchema.nullable().optional()
const common = z.object({
  sourceOrigin: z.object({name:text,authority:text,publicationDateKnown:z.boolean().optional()}).strict().optional(),
  customization,
  schemaVersion: z.literal(1),
  templateFamily: z.literal('bulten-v2'),
  reportId: z.string().regex(/^\d{6}-\d{2}$/),
  topicId: z.string().uuid(),
  documentTitle: text,
  issueNumber: text,
  displayDate: text,
  typeLabel: text,
  title: text,
  documentNumber: text.optional(),
  summary: text,
  affectedParties: z.array(text).max(3),
  dates: z.array(text).max(3),
  note: text.nullable(),
  source,
  blocks: z.array(blockId).min(1),
})

const K1ReportSpecSchema = common.extend({ card: z.literal('K1') }).strict()

const table = z.object({
  title: text,
  columns: z.array(text).min(2).max(12),
  rows: z.array(z.array(z.string().trim()).min(2).max(12)).min(2).max(500),
  note: text.nullable(),
}).strict().superRefine((value, context) => {
  value.rows.forEach((row, index) => {
    if (row.length !== value.columns.length) context.addIssue({ code: 'custom', path: ['rows', index], message: 'Satır ve sütun genişliği eşleşmelidir' })
  })
})

const K2ReportSpecSchema = common.extend({ card: z.literal('K2'), table }).strict()
const K3ReportSpecSchema = common.extend({
  card: z.literal('K3'),
  oldDeadline: text,
  newDeadline: text,
  timeline: z.array(z.object({ date: text, description: text }).strict()).min(1).max(3),
}).strict()
const K4ReportSpecSchema = common.extend({
  card: z.literal('K4'),
  removedRule: text,
  replacementRule: text.nullable(),
  alert: text,
}).strict()
const K5ReportSpecSchema = common.extend({
  card: z.literal('K5'),
  supportingSource: source,
}).strict()
const K6ReportSpecSchema = z.object({
  customization,
  schemaVersion: z.literal(1),
  templateFamily: z.literal('bulten-v2'),
  reportId: z.string().regex(/^\d{6}-00$/),
  topicId: z.null(),
  card: z.literal('K6'),
  documentTitle: text,
  issueNumber: text,
  displayDate: text,
  emptyDayText: text.max(180),
  source,
  blocks: z.array(blockId).min(1),
}).strict()

export const ReportSpecSchema = z.discriminatedUnion('card', [
  K1ReportSpecSchema,
  K2ReportSpecSchema,
  K3ReportSpecSchema,
  K4ReportSpecSchema,
  K5ReportSpecSchema,
  K6ReportSpecSchema,
])

export type ReportSpec = z.infer<typeof ReportSpecSchema>
