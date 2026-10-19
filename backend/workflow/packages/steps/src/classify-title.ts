import { z } from 'zod'
import type { StepInput, StepOutput, TitleDecisionItem } from '@atez/contracts'
import type { StepHandler } from '@atez/engine'
import { PermanentError } from '@atez/platform'
import { documents, loadKeywordSet, loadPrompt, loadSourceDefinition } from '@atez/modules'
import type { StepDeps } from './deps'

const PROMPT = 'classify-title.v1'
const BATCH = 120

const ModelOut = z.object({
  items: z.array(z.object({ id: z.string(), decision: z.enum(['IN', 'OUT', 'MAYBE']), reason: z.string() })),
})

/**
 * `classify.title` (Flash-Lite, toplu): yalnızca maliyet içindir; OUT çıkanlar indirilmez.
 * Karar belge satırına yazılır ve aynı prompt/kural sürümüyle yeniden sorulmaz (öğe bazlı
 * yeniden kullanım). Kodla OUT yalnızca mevzuat olmayan içerik için (anahtar kelime seti).
 */
export const classifyTitle: StepHandler<StepInput<'classify.title'>, StepOutput<'classify.title'>, StepDeps> = {
  key: 'classify.title',
  versions: (ctx) => ({ handler: '1', prompt: loadPrompt(ctx.deps.configDir, PROMPT).ref, model: ctx.deps.ai?.modelFor('lite') ?? 'none' }),
  cacheIdentity: () => null,
  async run(input, ctx) {
    if (input.candidates.length === 0) return { items: [] }
    const prompt = loadPrompt(ctx.deps.configDir, PROMPT)
    const modelTag = `MODEL:${prompt.ref}/${ctx.deps.ai?.modelFor('lite') ?? 'none'}`
    const rows = new Map((await documents.getDocuments(ctx.deps.db, input.candidates.map((c) => c.documentId))).map((d) => [d.id, d]))

    const decided = new Map<string, Omit<TitleDecisionItem, 'candidate'>>()
    const toModel: StepInput<'classify.title'>['candidates'] = []
    const ruleSets = new Map<string, ReturnType<typeof loadKeywordSet>>()
    for (const c of input.candidates) {
      const set = ruleSets.get(c.source) ?? loadKeywordSet(ctx.deps.configDir, loadSourceDefinition(ctx.deps.configDir, c.source).policy.titleKeywordSet)
      ruleSets.set(c.source, set)
      const ruleTag = `RULE:${set.ref}`
      const row = rows.get(c.documentId)
      if (!ctx.force && row?.titleDecision && (row.titleDecidedBy === modelTag || row.titleDecidedBy === ruleTag)) {
        decided.set(c.documentId, { decision: row.titleDecision as 'IN' | 'OUT' | 'MAYBE', reason: row.titleReason ?? '', by: row.titleDecidedBy.startsWith('RULE') ? 'RULE' : 'MODEL' })
        continue
      }
      const hit = set.outTitlePatterns.find((p) => c.title.toLocaleLowerCase('tr').includes(p.toLocaleLowerCase('tr')))
      if (hit) {
        const d = { decision: 'OUT' as const, reason: `Mevzuat değil (kural: "${hit}")`, by: 'RULE' as const }
        decided.set(c.documentId, d)
        await documents.setTitleDecision(ctx.deps.db, c.documentId, d.decision, d.reason, ruleTag)
        continue
      }
      toModel.push(c)
    }

    if (toModel.length) {
      const ai = ctx.deps.ai
      if (!ai) throw new PermanentError('AI geçidi yapılandırılmamış (VERTEX_PROJECT/VERTEX_LOCATION)', 'AI_NOT_CONFIGURED')
      for (let i = 0; i < toModel.length; i += BATCH) {
        const batch = toModel.slice(i, i + BATCH)
        const list = batch.map((c, idx) => ({ id: String(idx), title: c.title, section: c.listContext.rgSection, type: c.listContext.rgType, kind: c.kind }))
        const res = await ai.generate({
          tier: 'lite',
          purpose: 'classify.title',
          promptVersion: prompt.ref,
          system: prompt.text,
          parts: [{ text: `Başlıklar (JSON):\n${JSON.stringify(list)}` }],
          schema: ModelOut,
          thinking: 'minimal',
          context: { runId: ctx.runId, workItemId: ctx.workItemId, stepKey: ctx.stepKey },
        })
        const byId = new Map(res.data.items.map((r) => [r.id, r]))
        for (const [idx, c] of batch.entries()) {
          const r = byId.get(String(idx))
          // Modelin atladığı başlık ucuz yoldan elenmez: MAYBE → tam okuma.
          const d = r ? { decision: r.decision, reason: r.reason, by: 'MODEL' as const } : { decision: 'MAYBE' as const, reason: 'Model bu başlık için sonuç vermedi', by: 'MODEL' as const }
          decided.set(c.documentId, d)
          await documents.setTitleDecision(ctx.deps.db, c.documentId, d.decision, d.reason, modelTag)
        }
      }
    }
    return { items: input.candidates.map((candidate) => ({ candidate, ...decided.get(candidate.documentId)! })) }
  },
}
