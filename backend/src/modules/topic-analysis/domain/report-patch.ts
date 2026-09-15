import { z } from 'zod'
import { ReportSpecSchema, type ReportSpec } from './report-spec-schemas'

/**
 * The fields a revision may touch, as path patterns.
 *
 * Everything absent from this list is locked, which is the point: the document's
 * identity and its evidenced source (`reportId`, `topicId`, `card`, `issueNumber`,
 * `displayDate`, `source.url`, `documentTitle`) must not drift, or the bulletin
 * would start describing a different document. Table structure is locked for the
 * same reason — changing columns or row count is an analysis revision, not a text
 * correction.
 *
 * `#` stands for an array index.
 */
export const EDITABLE_PATH_PATTERNS = [
  'title',
  'typeLabel',
  'summary',
  'documentNumber',
  'note',
  'affectedParties.#',
  'dates.#',
  'blocks',
  'table.title',
  'table.note',
  'table.rows.#.#',
  'oldDeadline',
  'newDeadline',
  'timeline.#.date',
  'timeline.#.description',
  'removedRule',
  'replacementRule',
  'alert',
  'supportingSource.label',
  'emptyDayText',
] as const

export type EditablePathPattern = (typeof EDITABLE_PATH_PATTERNS)[number]

const patternMatchers = EDITABLE_PATH_PATTERNS.map((pattern) => ({
  pattern,
  matcher: new RegExp(`^${pattern.split('.').map((segment) => segment === '#' ? '(?:0|[1-9][0-9]{0,3})' : escapeSegment(segment)).join('\\.')}$`),
}))

export function matchEditablePattern(path: string): EditablePathPattern | null {
  return patternMatchers.find((entry) => entry.matcher.test(path))?.pattern ?? null
}

export const ReportFieldEditSchema = z.object({
  path: z.string().trim().min(1).max(120),
  /** `null` clears a nullable field such as `note`; arrays are replaced wholesale. */
  value: z.union([z.string(), z.array(z.string()), z.null()]),
}).strict()

export const ReportPatchSchema = z.object({
  edits: z.array(ReportFieldEditSchema).min(1).max(50),
}).strict()

export type ReportFieldEdit = z.infer<typeof ReportFieldEditSchema>
export type ReportPatch = z.infer<typeof ReportPatchSchema>

export type PatchRejectionReason = 'LOCKED_PATH' | 'UNKNOWN_PATH' | 'MISSING_TARGET' | 'SCHEMA_VIOLATION'

export class ReportPatchError extends Error {
  constructor(
    readonly reason: PatchRejectionReason,
    message: string,
    readonly path?: string,
  ) {
    super(message)
    this.name = 'ReportPatchError'
  }
}

export interface AppliedEdit {
  path: string
  previousValue: string | string[] | null
  nextValue: string | string[] | null
}

/**
 * Applies a patch to a spec and returns the new spec plus what actually changed.
 *
 * The patch is all-or-nothing: one rejected path leaves the spec untouched, so a
 * half-applied revision can never reach the renderer. Fields the patch does not
 * name are carried over byte for byte — that is what stops the silent drift the
 * whole-spec regeneration used to cause.
 */
export function applyReportPatch(spec: ReportSpec, patch: ReportPatch): { spec: ReportSpec; applied: AppliedEdit[] } {
  const draft = structuredClone(spec) as Record<string, unknown>
  const applied: AppliedEdit[] = []

  for (const edit of patch.edits) {
    if (!matchEditablePattern(edit.path)) {
      throw new ReportPatchError(
        isKnownSpecPath(spec, edit.path) ? 'LOCKED_PATH' : 'UNKNOWN_PATH',
        isKnownSpecPath(spec, edit.path)
          ? `"${edit.path}" alanı revizyonla değiştirilemez.`
          : `"${edit.path}" bu raporda bulunmuyor.`,
        edit.path,
      )
    }

    const segments = edit.path.split('.')
    const parent = resolveParent(draft, segments, edit.path)
    const key = segments[segments.length - 1] as string
    const container = parent as Record<string, unknown>
    // A patch corrects an existing field; it never grows the spec with new keys.
    if (!(key in container)) {
      throw new ReportPatchError('MISSING_TARGET', `"${edit.path}" bu raporda bulunmuyor.`, edit.path)
    }

    const previousValue = container[key] as string | string[] | null
    container[key] = edit.value
    applied.push({ path: edit.path, previousValue, nextValue: edit.value })
  }

  const parsed = ReportSpecSchema.safeParse(draft)
  if (!parsed.success) {
    throw new ReportPatchError('SCHEMA_VIOLATION', `Rapor şeması bozulurdu: ${describeIssues(parsed.error)}`)
  }

  return { spec: parsed.data, applied: applied.filter((edit) => !isSameValue(edit.previousValue, edit.nextValue)) }
}

function resolveParent(root: Record<string, unknown>, segments: string[], path: string): unknown {
  let current: unknown = root
  for (const segment of segments.slice(0, -1)) {
    if (current === null || typeof current !== 'object') {
      throw new ReportPatchError('MISSING_TARGET', `"${path}" bu raporda bulunmuyor.`, path)
    }
    current = (current as Record<string, unknown>)[segment]
  }
  if (current === null || typeof current !== 'object') {
    throw new ReportPatchError('MISSING_TARGET', `"${path}" bu raporda bulunmuyor.`, path)
  }
  return current
}

function isKnownSpecPath(spec: ReportSpec, path: string): boolean {
  let current: unknown = spec
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return false
    current = (current as Record<string, unknown>)[segment]
    if (current === undefined) return false
  }
  return true
}

function isSameValue(left: string | string[] | null, right: string | string[] | null): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => item === right[index])
  }
  return left === right
}

function describeIssues(error: z.ZodError): string {
  return error.issues.slice(0, 3).map((issue) => `${issue.path.join('.') || '(kök)'}: ${issue.message}`).join('; ')
}

function escapeSegment(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface SpecDifference {
  path: string
  previousValue: unknown
  nextValue: unknown
  /** Structural fields can be staged by an analysis revision but not undone field by field. */
  revertible: boolean
}

/**
 * Lists what changed between two specs, so an analysis revision can be staged for
 * approval as a readable set of changes rather than an opaque new document.
 *
 * Unlike a patch this reports every path, including locked ones: an analysis
 * revision is allowed to move table structure and evidence, and hiding that from
 * the reviewer would be worse than showing a change they cannot undo piecemeal.
 */
export function diffReportSpecs(previous: unknown, next: unknown): SpecDifference[] {
  const differences: SpecDifference[] = []
  walk(previous, next, [], differences)
  return differences
}

function walk(previous: unknown, next: unknown, path: string[], out: SpecDifference[]): void {
  if (Array.isArray(previous) && Array.isArray(next) && previous.length === next.length) {
    previous.forEach((item, index) => walk(item, next[index], [...path, String(index)], out))
    return
  }
  if (isPlainObject(previous) && isPlainObject(next)) {
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      walk(previous[key], next[key], [...path, key], out)
    }
    return
  }
  if (JSON.stringify(previous) === JSON.stringify(next)) return

  const joined = path.join('.')
  out.push({
    path: joined,
    previousValue: previous ?? null,
    nextValue: next ?? null,
    revertible: matchEditablePattern(joined) !== null,
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
