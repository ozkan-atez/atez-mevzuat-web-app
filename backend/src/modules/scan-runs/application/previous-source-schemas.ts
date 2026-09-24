import { z } from 'zod'

const nullableText = z.string().trim().min(1).max(500).nullable()

const responseSchema = z.object({
  needsPreviousSource: z.boolean(),
  relationship: z.enum(['AMENDS', 'REPEALS', 'EXTENDS', 'IMPLEMENTS', 'NONE']),
  targetRegulationTitle: nullableText,
  targetRegulationIdentifier: nullableText,
  targetRegulationType: nullableText,
  targetInstitution: nullableText,
  targetArticleReferences: z.array(z.string().trim().min(1).max(200)).max(10),
  queryCandidates: z.array(z.string().trim().min(2).max(300)).max(3),
  reason: z.string().trim().min(1).max(1_000),
}).strict().superRefine((value, context) => {
  if (value.needsPreviousSource) {
    if (value.relationship === 'NONE' || (!value.targetRegulationTitle && !value.targetRegulationIdentifier) || value.queryCandidates.length === 0) {
      context.addIssue({ code: 'custom', message: 'Previous source search intent is incomplete' })
    }
  } else if (value.relationship !== 'NONE' || value.queryCandidates.length > 0) {
    context.addIssue({ code: 'custom', message: 'Non-search intent must use relationship NONE and no queries' })
  }
})

export type PreviousSourceIntent = z.infer<typeof responseSchema>

export const previousSourceResponseJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'needsPreviousSource', 'relationship', 'targetRegulationTitle', 'targetRegulationIdentifier',
    'targetRegulationType', 'targetInstitution', 'targetArticleReferences', 'queryCandidates', 'reason',
  ],
  properties: {
    needsPreviousSource: { type: 'boolean' },
    relationship: { type: 'string', enum: ['AMENDS', 'REPEALS', 'EXTENDS', 'IMPLEMENTS', 'NONE'] },
    targetRegulationTitle: { type: ['string', 'null'] },
    targetRegulationIdentifier: { type: ['string', 'null'] },
    targetRegulationType: { type: ['string', 'null'] },
    targetInstitution: { type: ['string', 'null'] },
    targetArticleReferences: { type: 'array', maxItems: 10, items: { type: 'string' } },
    queryCandidates: { type: 'array', maxItems: 3, items: { type: 'string' } },
    reason: { type: 'string' },
  },
}

export function parsePreviousSourcePreflightResponse(raw: unknown): PreviousSourceIntent {
  return responseSchema.parse(raw)
}
