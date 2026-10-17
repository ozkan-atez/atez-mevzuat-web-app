import { z } from 'zod'
import { isStepKey } from './steps'

/**
 * Tarif tanımı (§5.2): adım kataloğundaki genel adımların JSON dizilimi.
 *  - `after`: önceki düğümler. Tek önceki + bariyersiz → öğe bazlı akış (X'in fetch'i bitince X'in
 *    normalize'ı hemen başlar). Birden çok önceki ya da `barrier: true` → önceki adımların tüm
 *    öğeleri bitince tek iş açılır; girdi önceki çıktıların dizisidir.
 *  - `fanOut`: önceki çıktısındaki dizi alanı; her eleman ayrı iş olur.
 *  - `when`: CEL koşulu; `item` (iş girdisi) ve `run` (run girdisi) değişkenleriyle değerlendirilir.
 *  - `with`: statik girdi (nesne girdilerle birleştirilir).
 *  - `input`: kök düğümde run girdisinden alan seçimi yapılmaz; run girdisi + `with` kullanılır.
 */
export const RecipeNode = z.object({
  id: z.string().regex(/^[a-z][a-zA-Z0-9_-]*$/),
  step: z.string(),
  after: z.array(z.string()).default([]),
  fanOut: z.string().optional(),
  when: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
  barrier: z.boolean().default(false),
})
export type RecipeNode = z.infer<typeof RecipeNode>

export const RecipeDefinition = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]*$/),
    version: z.number().int().min(1),
    title: z.string(),
    description: z.string().optional(),
    nodes: z.array(RecipeNode).min(1),
  })
  .superRefine((recipe, ctx) => {
    const ids = new Set<string>()
    for (const n of recipe.nodes) {
      if (ids.has(n.id)) ctx.addIssue({ code: 'custom', message: `Tekrarlanan düğüm: ${n.id}` })
      ids.add(n.id)
      if (!isStepKey(n.step)) ctx.addIssue({ code: 'custom', message: `Katalogda olmayan adım: ${n.step}` })
    }
    for (const n of recipe.nodes) {
      for (const a of n.after) if (!ids.has(a)) ctx.addIssue({ code: 'custom', message: `${n.id}: bilinmeyen önceki düğüm ${a}` })
      if (n.fanOut && (n.after.length !== 1 || n.barrier))
        ctx.addIssue({ code: 'custom', message: `${n.id}: fanOut yalnızca tek önceki ve bariyersiz düğümde kullanılabilir` })
      if (n.after.length === 0 && (n.fanOut || n.barrier))
        ctx.addIssue({ code: 'custom', message: `${n.id}: kök düğümde fanOut/barrier olmaz` })
    }
    // Döngü kontrolü (Kahn)
    const indeg = new Map(recipe.nodes.map((n) => [n.id, n.after.length]))
    const queue = recipe.nodes.filter((n) => n.after.length === 0).map((n) => n.id)
    let seen = 0
    while (queue.length) {
      const id = queue.shift()!
      seen++
      for (const m of recipe.nodes) if (m.after.includes(id)) {
        indeg.set(m.id, indeg.get(m.id)! - 1)
        if (indeg.get(m.id) === 0) queue.push(m.id)
      }
    }
    if (seen !== recipe.nodes.length) ctx.addIssue({ code: 'custom', message: 'Tarif grafiğinde döngü var' })
  })
export type RecipeDefinition = z.infer<typeof RecipeDefinition>

export const StartRunRequest = z.object({
  recipeKey: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
  mode: z.enum(['REUSE_ONLY', 'FILL_MISSING', 'FORCE']).default('FILL_MISSING'),
  /** FORCE modunda yalnızca bu düğümler yeniden üretilir; boşsa tümü. */
  forceNodes: z.array(z.string()).optional(),
})
export type StartRunRequest = z.infer<typeof StartRunRequest>
