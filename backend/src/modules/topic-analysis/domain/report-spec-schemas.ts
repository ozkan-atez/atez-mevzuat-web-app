import { z } from 'zod'

const text = z.string().trim().min(1)
const httpUrl = z.string().url().refine((value) => /^https?:\/\//.test(value))
const blockId = z.enum(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10'])
const source = z.object({ label: text, url: httpUrl }).strict()
const common = z.object({
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
  rows: z.array(z.array(text).min(2).max(12)).min(2).max(500),
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
