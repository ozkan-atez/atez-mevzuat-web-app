import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { evaluate } from '@marcbachmann/cel-js'
import { RecipeDefinition, type RecipeNode } from '@atez/contracts'

/** Tarifler config'te sürümlü JSON olarak durur (§5.2); kayıt sırasında doğrulanır. */
export class RecipeRegistry {
  private readonly recipes = new Map<string, RecipeDefinition>()

  add(def: unknown): RecipeDefinition {
    const recipe = RecipeDefinition.parse(def)
    for (const n of recipe.nodes) if (n.when) compileCheck(n.when)
    const current = this.recipes.get(recipe.key)
    if (!current || current.version < recipe.version) this.recipes.set(recipe.key, recipe)
    return recipe
  }

  static fromDir(dir: string): RecipeRegistry {
    const reg = new RecipeRegistry()
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      try {
        reg.add(JSON.parse(readFileSync(join(dir, f), 'utf8')))
      } catch (err) {
        throw new Error(`Tarif geçersiz: ${f}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return reg
  }

  get(key: string): RecipeDefinition | undefined {
    return this.recipes.get(key)
  }
  list(): RecipeDefinition[] {
    return [...this.recipes.values()]
  }
}

function compileCheck(expr: string): void {
  try {
    // Ayrıştırma hatasını kayıt anında yakala; değişken çözümü çalışma anında.
    evaluate(expr, { item: {}, run: {} })
  } catch (err) {
    if (err instanceof Error && /parse|syntax|unexpected/i.test(err.message)) throw new Error(`CEL ifadesi geçersiz: ${expr}: ${err.message}`)
  }
}

export function evaluateWhen(expr: string | undefined, vars: { item: unknown; run: unknown }): boolean {
  if (!expr) return true
  return evaluate(expr, vars as Record<string, unknown>) === true
}

export const successorsOf = (recipe: RecipeDefinition, nodeId: string): RecipeNode[] => recipe.nodes.filter((n) => n.after.includes(nodeId))
export const isStreaming = (n: RecipeNode): boolean => n.after.length === 1 && !n.barrier

export function topoOrder(recipe: RecipeDefinition): RecipeNode[] {
  const out: RecipeNode[] = []
  const done = new Set<string>()
  while (out.length < recipe.nodes.length) {
    for (const n of recipe.nodes) if (!done.has(n.id) && n.after.every((a) => done.has(a))) {
      out.push(n)
      done.add(n.id)
    }
  }
  return out
}

/** Nokta yollu alan okuma: `items`, `result.items`. */
export function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), value)
}

export function mergeWith(input: unknown, withValues: Record<string, unknown> | undefined): unknown {
  if (!withValues) return input
  if (input && typeof input === 'object' && !Array.isArray(input)) return { ...(input as Record<string, unknown>), ...withValues }
  return input
}
