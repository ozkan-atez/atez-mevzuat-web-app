import { and, eq, sql } from 'drizzle-orm'
import { StartRunRequest, type Actor, type RecipeDefinition, type RunMode, type StepKey } from '@atez/contracts'
import { enqueueStepCommand, schema, type Db, type DbOrTx } from '@atez/platform'
import { mergeWith, type RecipeRegistry } from './recipes'

const { run, runStep, workItem } = schema

export interface StartedRun {
  runId: string
  recipeKey: string
  recipeVersion: number
}

/**
 * Run başlatır: run, run_step'ler ve kök işler + komutlar tek transaction'da (outbox).
 */
export async function startRun(db: Db, recipes: RecipeRegistry, request: unknown, actor: Actor): Promise<StartedRun> {
  const req = StartRunRequest.parse(request)
  const recipe = recipes.get(req.recipeKey)
  if (!recipe) throw new Error(`Tarif bulunamadı: ${req.recipeKey}`)
  return db.transaction(async (tx) => {
    const [r] = await tx
      .insert(run)
      .values({
        recipeKey: recipe.key,
        recipeVersion: recipe.version,
        recipe,
        mode: req.mode,
        forceNodes: req.forceNodes ?? null,
        input: req.input,
        actor,
        status: 'RUNNING',
      })
      .returning({ id: run.id })
    const runId = r!.id
    await tx.insert(runStep).values(recipe.nodes.map((n) => ({ runId, nodeId: n.id, stepKey: n.step })))
    for (const node of recipe.nodes.filter((n) => n.after.length === 0)) {
      await createItems(tx, { runId, actor, nodeId: node.id, stepKey: node.step as StepKey, items: [{ itemKey: 'root', input: mergeWith(req.input, node.with), parentItemId: null }] })
    }
    return { runId, recipeKey: recipe.key, recipeVersion: recipe.version }
  })
}

/** İş oluşturur (çiftler `item_key` tekilliğiyle bastırılır) ve komutlarını outbox'a yazar. */
export async function createItems(
  tx: DbOrTx,
  args: { runId: string; actor: Actor; nodeId: string; stepKey: StepKey; items: { itemKey: string; input: unknown; parentItemId: string | null }[] },
): Promise<number> {
  if (args.items.length === 0) return 0
  const inserted = await tx
    .insert(workItem)
    .values(args.items.map((i) => ({ runId: args.runId, nodeId: args.nodeId, stepKey: args.stepKey, itemKey: i.itemKey, parentItemId: i.parentItemId, input: i.input ?? null, status: 'READY' })))
    .onConflictDoNothing()
    .returning({ id: workItem.id })
  for (const row of inserted) {
    await enqueueStepCommand(tx, { payload: { runId: args.runId, workItemId: row.id, stepKey: args.stepKey }, actor: args.actor, attempt: 1 })
  }
  if (inserted.length) {
    await tx
      .update(runStep)
      .set({ total: sql`${runStep.total} + ${inserted.length}` })
      .where(and(eq(runStep.runId, args.runId), eq(runStep.nodeId, args.nodeId)))
  }
  return inserted.length
}

export function isForced(mode: RunMode, forceNodes: string[] | null, nodeId: string): boolean {
  return mode === 'FORCE' && (!forceNodes || forceNodes.length === 0 || forceNodes.includes(nodeId))
}

export type RecipeSnapshot = RecipeDefinition
