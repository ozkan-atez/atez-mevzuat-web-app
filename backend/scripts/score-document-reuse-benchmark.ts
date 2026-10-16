/** Deterministic scoring against visually transcribed gold, never an LLM judge. */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
const root = resolve(process.argv[2] ?? '../.local/document-reuse-benchmark/2026-10-13')
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
const norm = (v: unknown) => String(v ?? '').trim().toLocaleLowerCase('tr-TR').replace(/,/g, '.').replace(/[%\s_’'“”"():;-]/g, '').replace(/\.$/, '')
const same = (a: unknown, b: unknown) => {
  const x = norm(a), y = norm(b)
  if (x === y) return true
  if (y === 'maldivler' && x === 'maldivlercumhuriyeti') return true
  if (/^\d+(\.\d+)?$/.test(x) && /^\d+(\.\d+)?$/.test(y)) return Number(x) === Number(y)
  return false
}
// Explicit semantic equivalents, applied only to the corresponding numeric question.
// Preserve strict scores as well: format differences must not masquerade as factual errors.
const numericAliases: Record<string, Record<string, string>> = {
  temporary: { 'geçicimadde31': '31' }, repealedArticle: { ek2: '2' },
  repealedParagraph: { 'onaltıncıfıkra': '16' }, repealedSentence: { 'ikincicümle': '2' },
}
function score(doc: any, answer: any) {
  const questions = doc.questions.map((q: any) => {
    const actual = answer.answers?.filter((a: any) => a.id === q.id) ?? []
    const strictCorrect = actual.length === 1 && same(actual[0].value, q.expected)
    return { id: q.id, expected: q.expected, actual: actual.map((a: any) => a.value), strictCorrect, correct: strictCorrect || actual.length === 1 && same(numericAliases[q.id]?.[norm(actual[0].value)], q.expected), pageCorrect: q.page == null ? null : actual.length === 1 && actual[0].evidencePage === q.page }
  })
  const rows = doc.goldRows.map((gold: any) => {
    const actual = answer.rows?.filter((a: any) => same(a.cells?.[0], gold.cells[0])) ?? []
    return { key: gold.cells[0], correct: actual.length === 1 && gold.cells.length === actual[0].cells.length && gold.cells.every((v: string, i: number) => same(actual[0].cells[i], v)), pageCorrect: actual.length === 1 && actual[0].page === gold.page, actual, expected: gold }
  })
  const extras = (answer.rows ?? []).filter((r: any) => !doc.goldRows.some((g: any) => same(g.cells[0], r.cells?.[0])))
  return { questionsCorrect: questions.filter((q: any) => q.correct).length, strictQuestionsCorrect: questions.filter((q: any) => q.strictCorrect).length, formattingDifferences: questions.filter((q: any) => q.correct && !q.strictCorrect), questionsTotal: questions.length, questionPagesCorrect: questions.filter((q: any) => q.pageCorrect).length, questionPagesTotal: questions.filter((q: any) => q.pageCorrect !== null).length, rowsCorrect: rows.filter((r: any) => r.correct).length, rowsTotal: rows.length, rowPagesCorrect: rows.filter((r: any) => r.pageCorrect).length, actualRowCount: answer.rows?.length ?? 0, extraRows: extras, questionFailures: questions.filter((q: any) => !q.correct || q.pageCorrect === false), rowFailures: rows.filter((r: any) => !r.correct || !r.pageCorrect) }
}
const runs: any[] = []
for (const file of (await readdir(join(root, 'runs'))).sort()) {
  if (!file.endsWith('.json')) continue
  const run = JSON.parse(await readFile(join(root, 'runs', file), 'utf8'))
  const doc = manifest.documents.find((d: any) => run.key.startsWith(d.id + '-'))
  if (!doc) continue
  const { raw, json, ...data } = run
  const metrics: any = { ...data, document: doc.id, outputCharacters: raw?.length ?? 0 }
  if (run.status === 'COMPLETED' && !run.key.endsWith('-extract')) {
    const scoringDoc = run.key.includes('-targeted-') ? { ...doc, questions: doc.questions.filter((q: any) => ['effective', 'origin', 'list'].includes(q.id)), goldRows: doc.goldRows.filter((r: any) => ['0303.91.10.00.00', '0305.54.30.00.00', '0307.43.38.00.00'].includes(r.cells[0])) } : doc
    metrics.score = score(scoringDoc, run.key.endsWith('-combined') ? json.answer : json)
  }
  if (run.status === 'COMPLETED' && (run.key.endsWith('-extract') || run.key.endsWith('-combined'))) {
    const dossier = run.key.endsWith('-combined') ? json.dossier : json
    const pageNumbers = (dossier.pages ?? []).map((p: any) => p.number)
    metrics.coverage = { expectedPages: doc.pages, reportedPages: pageNumbers, allPagesReportedExactlyOnce: pageNumbers.length === doc.pages && Array.from({ length: doc.pages }, (_, i) => i + 1).every(i => pageNumbers.filter((p: number) => p === i).length === 1), unreadable: (dossier.pages ?? []).flatMap((p: any) => (p.unreadable ?? []).map((u: any) => ({ page: p.number, issue: u }))), limitations: dossier.limitations, note: 'Page presence is structural coverage only, not a completeness guarantee.' }
  }
  runs.push(metrics)
}
const mean = (arr: any[], f: (v: any) => number) => arr.length ? arr.reduce((sum, v) => sum + f(v), 0) / arr.length : null
const summary = manifest.documents.map((doc: any) => {
  const direct = runs.filter(r => r.key.startsWith(`${doc.id}-direct-`) && r.status === 'COMPLETED')
  const reuse = runs.filter(r => r.key.startsWith(`${doc.id}-reuse-`) && r.status === 'COMPLETED')
  const extract = runs.find(r => r.key === `${doc.id}-extract`)
  const combined = runs.find(r => r.key === `${doc.id}-combined`)
  const avg = (arr: any[]) => ({ n: arr.length, elapsedMs: mean(arr, r => r.elapsedMs), inputTokens: mean(arr, r => r.usage?.promptTokenCount ?? 0), outputTokens: mean(arr, r => r.usage?.candidatesTokenCount ?? 0), reasoningTokens: mean(arr, r => r.usage?.thoughtsTokenCount ?? 0), totalTokens: mean(arr, r => r.usage?.totalTokenCount ?? 0), scores: arr.map(r => r.score) })
  const d = avg(direct), u = avg(reuse)
  const saving = d.totalTokens != null && u.totalTokens != null ? d.totalTokens - u.totalTokens : null
  return { document: doc.id, pages: doc.pages, direct: d, reuse: u, extractionTokens: extract?.usage?.totalTokenCount, extractionMs: extract?.elapsedMs, inputReductionPercent: d.inputTokens ? 100 * (1 - (u.inputTokens ?? 0) / d.inputTokens) : null, totalReductionPercent: d.totalTokens ? 100 * (1 - (u.totalTokens ?? 0) / d.totalTokens) : null, tokenBreakEvenUses: saving && saving > 0 ? Math.ceil(extract.usage.totalTokenCount / saving) : null, combinedTokens: combined?.usage?.totalTokenCount, combinedMs: combined?.elapsedMs, combinedScore: combined?.score }
})
const targeted = ['direct', 'reuse'].map(path => {
  const selected = runs.filter(r => r.key.startsWith(`import-tariffs-targeted-${path}-`) && r.status === 'COMPLETED')
  return { path, n: selected.length, elapsedMs: mean(selected, r => r.elapsedMs), inputTokens: mean(selected, r => r.usage.promptTokenCount), totalTokens: mean(selected, r => r.usage.totalTokenCount), scores: selected.map(r => r.score) }
})
const result = { generatedAt: new Date().toISOString(), methodology: manifest.goldMethod, caveats: ['Two samples per answer path; one extraction per document; no confidence intervals.', 'Token totals are provider reports, not currency prices; reasoning and output are not equally priced to input.', 'No explicit cache or public search; report any provider cachedContentTokenCount separately.', 'Selected questions and all table rows scored; not proof of complete semantic preservation.', 'All PDFs are 2–4 pages; large-document worker splitting remains untested.', 'Four Turkish numeric phrase equivalents were added after viewing outputs; strict scores retained separately.', 'The no-footnote question has no unique page; its page citation is excluded from scoring.'], runs, summary, targeted }
await writeFile(join(root, 'results.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(summary, null, 2))
