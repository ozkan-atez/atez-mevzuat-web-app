import { z } from 'zod'

const commonDecisionFields = {
  documentId: z.string().min(1),
  reason: z.string().trim().min(1).max(1_000),
  confidence: z.number().min(0).max(1),
}

const titleResponseSchema = z.object({
  decisions: z.array(z.object({
    ...commonDecisionFields,
    decision: z.enum(['IN', 'OUT', 'MAYBE']),
  }).strict()),
}).strict()

const contentResponseSchema = z.object({
  decisions: z.array(z.object({
    ...commonDecisionFields,
    decision: z.enum(['IN', 'OUT']),
  }).strict()),
}).strict()

export type TitleDecision = z.infer<typeof titleResponseSchema>['decisions'][number]
export type ContentDecision = z.infer<typeof contentResponseSchema>['decisions'][number]

export const titleFilterResponseJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['decisions'],
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['documentId', 'decision', 'reason', 'confidence'],
        properties: {
          documentId: { type: 'string' },
          decision: { type: 'string', enum: ['IN', 'OUT', 'MAYBE'] },
          reason: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
}

export const contentFilterResponseJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['decisions'],
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['documentId', 'decision', 'reason', 'confidence'],
        properties: {
          documentId: { type: 'string' },
          decision: { type: 'string', enum: ['IN', 'OUT'] },
          reason: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
}

function validateDocumentIds<T extends { documentId: string }>(decisions: T[], expectedIds: string[]): T[] {
  const returnedIds = decisions.map((decision) => decision.documentId)
  const duplicates = returnedIds.filter((id, index) => returnedIds.indexOf(id) !== index)
  if (duplicates.length > 0) throw new Error(`AI response has duplicate document IDs: ${[...new Set(duplicates)].join(', ')}`)

  const expected = new Set(expectedIds)
  const unknown = returnedIds.filter((id) => !expected.has(id))
  if (unknown.length > 0) throw new Error(`AI response has unknown document IDs: ${unknown.join(', ')}`)

  const returned = new Set(returnedIds)
  const missing = expectedIds.filter((id) => !returned.has(id))
  if (missing.length > 0) throw new Error(`AI response is missing document IDs: ${missing.join(', ')}`)
  return decisions
}

export function parseTitleFilterResponse(raw: unknown, expectedIds: string[]): TitleDecision[] {
  return validateDocumentIds(titleResponseSchema.parse(raw).decisions, expectedIds)
}

export function parseContentFilterResponse(raw: unknown, expectedIds: string[]): ContentDecision[] {
  try {
    return validateDocumentIds(contentResponseSchema.parse(raw).decisions, expectedIds)
  } catch (error) {
    if (raw && typeof raw === 'object' && JSON.stringify(raw).includes('MAYBE')) {
      throw new Error('Content filter must return a final IN or OUT decision')
    }
    throw error
  }
}
