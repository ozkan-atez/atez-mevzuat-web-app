import { PDFDocument } from 'pdf-lib'
import { z } from 'zod'
import { DocumentProfileV1, type FileRef, type StepInput, type StepOutput } from '@atez/contracts'
import type { StepContext, StepHandler } from '@atez/engine'
import { PermanentError, StorageKeys, schema, type AiPart } from '@atez/platform'
import { documents, loadPrompt, normalizeDecimal } from '@atez/modules'
import { and, eq } from 'drizzle-orm'
import type { StepDeps } from './deps'

const PROMPT = 'extract-table.v1'
const PAGES_PER_GROUP = 12
const PARALLEL = 4

const Rows = z.object({
  rows: z.array(
    z.object({
      gtip: z.string(),
      description: z.string().nullable(),
      rawValue: z.string().nullable(),
      unit: z.string().nullable(),
      currency: z.string().nullable(),
      origin: z.string().nullable(),
      page: z.number().int().min(1).nullable(),
    }),
  ),
  rowCount: z.number().int().min(0),
})

export async function loadProfile(ctx: StepContext<StepDeps>, documentVersionId: string): Promise<{ id: string; version: number; profile: DocumentProfileV1 } | null> {
  const row = await documents.latestProfile(ctx.deps.db, documentVersionId)
  if (!row) return null
  return { id: row.id, version: row.version, profile: DocumentProfileV1.parse(JSON.parse((await ctx.deps.store.get(row.objectKey)).toString('utf8'))) }
}

/** Özgün sayfa numaralarını içeren dosyadan (MODEL_INPUT veya PART) alt PDF üretir. */
export async function pdfPages(ctx: StepContext<StepDeps>, files: FileRef[], pages: number[]): Promise<Uint8Array | null> {
  // Tablo sayfaları ana belgeye (f1) aittir; bölünmüşse PART'lar, değilse MODEL_INPUT kullanılır.
  const parts = files.filter((f) => f.role === 'PART' && f.label.startsWith('f1#'))
  const pdfs = parts.length ? parts : files.filter((f) => f.role === 'MODEL_INPUT' && f.label === 'f1' && f.mime === 'application/pdf')
  const out = await PDFDocument.create()
  const cache = new Map<string, PDFDocument>()
  let copied = 0
  for (const page of [...new Set(pages)].sort((a, b) => a - b)) {
    const file = pdfs.find((f) => f.pageRange && page >= f.pageRange[0] && page <= f.pageRange[1])
    if (!file) continue
    let src = cache.get(file.objectKey)
    if (!src) {
      src = await PDFDocument.load(await ctx.deps.store.get(file.objectKey), { ignoreEncryption: true, updateMetadata: false })
      cache.set(file.objectKey, src)
    }
    const [p] = await out.copyPages(src, [page - file.pageRange![0]])
    out.addPage(p!)
    copied++
  }
  return copied ? out.save({ useObjectStreams: true }) : null
}

async function limited<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, tasks.length) }, async () => {
      while (i < tasks.length) {
        const k = i++
        results[k] = await tasks[k]!()
      }
    }),
  )
  return results
}

/**
 * `extract.table` (§6.3): profilde işaretli GTİP tablolarının satırları; sayfa grupları paralel.
 * Değer belgede yazdığı gibi alınır, ondalık biçimi ve satır sayısı kodla denetlenir; satırlar
 * `gtip_value` olarak yazılır.
 */
export const extractTable: StepHandler<StepInput<'extract.table'>, StepOutput<'extract.table'>, StepDeps> = {
  key: 'extract.table',
  versions: (ctx) => ({ handler: '1', prompt: loadPrompt(ctx.deps.configDir, PROMPT).ref, model: ctx.deps.ai?.modelFor('main') ?? 'none', pages: String(PAGES_PER_GROUP) }),
  cacheIdentity: async (input, ctx) => {
    const p = await documents.latestProfile(ctx.deps.db, input.documentVersionId)
    return p ? `${input.documentVersionId}:p${p.version}` : null
  },
  run: (input, ctx) => runExtractTable(input.documentVersionId, ctx),
}

export async function runExtractTable(documentVersionId: string, ctx: StepContext<StepDeps>): Promise<StepOutput<'extract.table'>> {
  const loaded = await loadProfile(ctx, documentVersionId)
  if (!loaded) throw new PermanentError('Belge profili yok; extract.table profil gerektirir', 'NO_PROFILE')
  const { profile } = loaded
  const empty = { documentVersionId, status: 'NO_TABLES' as const, rows: 0, tables: [], issues: [] as string[] }
  if (!profile.gtip.present || profile.gtip.tables.length === 0) return empty
  const ai = ctx.deps.ai
  if (!ai) throw new PermanentError('AI geçidi yapılandırılmamış', 'AI_NOT_CONFIGURED')
  const prompt = loadPrompt(ctx.deps.configDir, PROMPT)
  const files = await documents.filesOf(ctx.deps.db, documentVersionId, ['MODEL_INPUT', 'PART'])
  const html = files.find((f) => f.mime === 'text/html' && f.label === 'f1')
  const issues: string[] = []

  type Group = { table: (typeof profile.gtip.tables)[number]; pages: number[] }
  const groups: Group[] = []
  for (const table of profile.gtip.tables) {
    if (html) {
      groups.push({ table, pages: [] })
      continue
    }
    if (!table.pages.length) {
      issues.push(`"${table.title}" tablosunun sayfaları bilinmiyor`)
      continue
    }
    const pages = [...new Set(table.pages)].sort((a, b) => a - b)
    for (let i = 0; i < pages.length; i += PAGES_PER_GROUP) groups.push({ table, pages: pages.slice(i, i + PAGES_PER_GROUP) })
  }

  const raws: unknown[] = []
  const results = await limited(
    groups.map((g) => async () => {
      const parts: AiPart[] = []
      if (html) parts.push({ text: (await ctx.deps.store.get(html.objectKey)).toString('utf8') })
      else {
        const pdf = await pdfPages(ctx, files, g.pages)
        if (!pdf) return { group: g, rows: [] as z.infer<typeof Rows>['rows'], missing: true }
        parts.push({ inline: { mime: 'application/pdf', data: pdf } })
      }
      const where = html ? 'HTML belgenin tamamı' : `özgün belgenin ${g.pages.join(', ')}. sayfaları (bu dosyada 1–${g.pages.length})`
      parts.push({ text: `Tablo: "${g.table.title}" · sütunlar: ${g.table.columns.join(' | ') || 'bilinmiyor'} · kaynak: ${where}.\nBu tablonun satırlarını çıkar.` })
      const res = await ai.generate({
        tier: 'main',
        purpose: 'extract.table',
        promptVersion: prompt.ref,
        system: prompt.text,
        parts,
        schema: Rows,
        mediaResolution: ai.config.mediaResolution,
        context: { runId: ctx.runId, workItemId: ctx.workItemId, stepKey: 'extract.table' },
      })
      raws.push({ table: g.table.title, pages: g.pages, aiCallId: res.aiCallId, data: res.data })
      if (res.data.rowCount !== res.data.rows.length) issues.push(`"${g.table.title}" ${g.pages.join(',')}: modelin bildirdiği satır sayısı (${res.data.rowCount}) ile çıkan satır (${res.data.rows.length}) farklı`)
      // Sayfa numaraları alt PDF içinden özgün belgeye taşınır.
      const rows = res.data.rows.map((r) => ({ ...r, page: r.page && !html ? (g.pages[r.page - 1] ?? null) : r.page }))
      return { group: g, rows, missing: false }
    }),
    PARALLEL,
  )

  const toInsert: (typeof schema.gtipValue.$inferInsert)[] = []
  const tables = new Map<string, { title: string; pages: number[]; rows: number; expectedRows: number | null }>()
  let badValues = 0
  let badCodes = 0
  for (const r of results) {
    if (r.missing) issues.push(`"${r.group.table.title}" sayfaları ${r.group.pages.join(',')} model girdisinde bulunamadı`)
    const t = tables.get(r.group.table.title) ?? { title: r.group.table.title, pages: r.group.table.pages, rows: 0, expectedRows: r.group.table.approxRows }
    for (const row of r.rows) {
      const digits = row.gtip.replace(/\D/g, '')
      if (digits.length < 4 || digits.length > 12) {
        badCodes++
        continue
      }
      const value = normalizeDecimal(row.rawValue)
      if (row.rawValue && value === null) badValues++
      t.rows++
      toInsert.push({
        documentVersionId,
        source: 'RG',
        tableTitle: r.group.table.title,
        gtip: row.gtip.trim(),
        description: row.description,
        value,
        rawValue: row.rawValue,
        unit: row.unit,
        currency: row.currency,
        origin: row.origin,
        page: row.page,
      })
    }
    tables.set(t.title, t)
  }
  if (badCodes) issues.push(`${badCodes} satırda GTİP biçimi geçersiz; atlandı`)
  if (badValues) issues.push(`${badValues} satırda değer ondalık sayı olarak okunamadı (metinsel değer olabilir)`)
  for (const t of tables.values()) {
    if (t.expectedRows && Math.abs(t.rows - t.expectedRows) / t.expectedRows > 0.25) issues.push(`"${t.title}": beklenen ≈${t.expectedRows} satır, çıkan ${t.rows}`)
  }
  const version = loaded.version
  await ctx.deps.store.put(StorageKeys.tables(documentVersionId, version), JSON.stringify({ issues, groups: raws, rows: toInsert }, null, 2), 'application/json')
  await ctx.deps.db.transaction(async (tx) => {
    await tx.delete(schema.gtipValue).where(eqRg(documentVersionId))
    if (toInsert.length) await tx.insert(schema.gtipValue).values(toInsert)
  })
  ctx.log.info('tables extracted', { documentVersionId, rows: toInsert.length, groups: groups.length, issues: issues.length })
  return {
    documentVersionId,
    status: issues.length ? 'PARTIAL' : 'EXTRACTED',
    rows: toInsert.length,
    tables: [...tables.values()],
    issues,
  }
}

const eqRg = (dv: string) => and(eq(schema.gtipValue.documentVersionId, dv), eq(schema.gtipValue.source, 'RG'))
