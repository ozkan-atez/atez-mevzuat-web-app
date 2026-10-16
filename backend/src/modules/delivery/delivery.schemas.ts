import { z } from 'zod'

const emailList = z.array(z.string().trim().email()).max(200)

export const customerGroupCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  emails: emailList.min(1),
  recipientNames: z.record(z.string().trim().email(), z.string().trim().max(120)).optional(),
  isActive: z.boolean().default(true),
}).strict()

export const customerGroupUpdateSchema = customerGroupCreateSchema.partial().strict()

export const dispatchSchema = z.object({
  reportVersion: z.number().int().positive(),
  groupIds: z.array(z.string().uuid()).max(50).default([]),
  recipients: emailList.default([]),
  subject: z.string().trim().min(1).max(300),
  bodyText: z.string().trim().min(1).max(50_000),
  attachPdf: z.boolean().default(true),
}).strict()
