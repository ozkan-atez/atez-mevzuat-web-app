import type { TemplateDefinition } from '@atez/contracts'
import type { StepContext } from '@atez/engine'
import { PermanentError, hashJson } from '@atez/platform'
import { ComponentService, TemplateService } from '@atez/modules'
import type { StepDeps } from './deps'

export interface ResolvedTemplate {
  versionId: string
  definition: TemplateDefinition
  /** Analizi etkileyen kısmın hash'i (brief + açık bölümlerin başlık/açıklama/bileşeni). */
  analysisHash: string
}

/** Run girdisindeki `templateId` ya da varsayılan şablonun güncel sürümü (§10.1). */
export async function resolveTemplate(ctx: StepContext<StepDeps>): Promise<ResolvedTemplate> {
  const components = new ComponentService(ctx.deps.db)
  const templates = new TemplateService(ctx.deps.db, components)
  await components.ensureBuiltins()
  const requested = ctx.runInput.templateId
  const t = typeof requested === 'string' ? await templates.get(requested) : await templates.ensureDefault()
  if (!t) throw new PermanentError(`Şablon yok: ${String(requested)}`, 'TEMPLATE_NOT_FOUND')
  return { versionId: t.versionId, definition: t.definition, analysisHash: hashJson(analysisView(t.definition)) }
}

/** Analize giden şablon görünümü: tema/başlık gibi görsel ayarlar analizi yeniden çalıştırmaz. */
export function analysisView(t: TemplateDefinition) {
  return {
    brief: t.brief,
    sections: [...t.sections]
      .filter((s) => s.enabled)
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ id: s.id, heading: s.heading, description: s.sectionDescription, component: s.componentKey })),
  }
}
