import { z } from 'zod'
import { ReportFieldEditSchema } from './domain/report-patch'

export const messageSchema = z.object({ message: z.string().trim().min(1).max(8_000) }).strict()

export const versionSchema = z.coerce.number().int().positive()

export const applyEditsSchema = z.object({
  edits: z.array(ReportFieldEditSchema).min(1).max(50),
  /** The revision the client rendered; omitted only when it has not loaded one yet. */
  expectedVersion: z.number().int().positive().optional(),
}).strict()

export const publishDraftSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
}).strict()
