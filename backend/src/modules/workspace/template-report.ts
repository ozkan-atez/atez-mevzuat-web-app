import { z } from 'zod'
import type { AiModelClient } from '../ai/application/ai-model-client'
import { TemplateDefinitionSchema,type TemplateReport } from './template-definition'
import { generateTemplateReport } from './template-ai'

export const TemplateSnapshotSchema=z.object({definition:TemplateDefinitionSchema.nullable().optional(),revision:z.number().int().positive().nullable().optional()})
export async function reportFromTemplate(snapshot:unknown,evidence:unknown,sources:TemplateReport['sources'],aiModel?:AiModelClient,model?:string) {
  const parsed=TemplateSnapshotSchema.parse(snapshot ?? {})
  if(!parsed.definition)return null
  if(!aiModel || !model)throw new Error('Şablon içerik üretimi için AI sağlayıcısı gerekli.')
  return generateTemplateReport({definition:parsed.definition,revision:parsed.revision ?? null,sources,evidence,model:aiModel,modelName:model})
}
