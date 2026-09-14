import { AiProviderError } from '../../ai/domain/ai-errors'
import type { AnalysisResult } from '../domain/analysis-schemas'
import { ReportSpecSchema, type ReportSpec } from '../domain/report-spec-schemas'
import type { CreateTopicReportRevisionInput, RunReportContext, StoredTopicReport, TopicObjectStore } from './ports'
import { buildReportSpec } from './build-report-spec'
import { renderReportHtml } from './render-report-html'
import { validateReportHtml } from './validate-report-html'

export interface TopicAnalysisOutput {
  id: string
  version: number
  analysisObjectKey: string
  markdownObjectKey: string
  analysis: AnalysisResult
}

interface OrchestrationRepository {
  ensureTopics(runId: string): Promise<Array<{ id: string; documentId: string; status: string }>>
  getRunReportContext(runId: string): Promise<RunReportContext | null>
  nextReportVersion(runId: string, topicId: string | null): Promise<number>
  createReportRevision(input: CreateTopicReportRevisionInput): Promise<StoredTopicReport>
  markTopicRendering(topicId: string): Promise<void>
  markTopicValidating(topicId: string): Promise<void>
  markTopicCompleted(topicId: string): Promise<void>
  markTopicBlocked(topicId: string, message: string): Promise<void>
}

interface Dependencies {
  repository: OrchestrationRepository
  objectStore: TopicObjectStore
  concurrency: number
  executeTopic(topicId: string): Promise<TopicAnalysisOutput>
  lifecycle?: {
    analysisStarted(total: number): Promise<void>
    analysisItemFinished(): Promise<void>
    analysisFinished(): Promise<void>
    reportsStarted(total: number): Promise<void>
    reportItemFinished(): Promise<void>
    reportsFinished(): Promise<void>
  }
}

export interface RunAnalysisResult {
  status: 'COMPLETED' | 'AWAITING_RETRY' | 'PARTIAL' | 'FAILED'
  topicReports: StoredTopicReport[]
  noChangeReport: StoredTopicReport | null
  counts: { total: number; completed: number; awaitingRetry: number; failed: number; reports: number }
}

export async function executeRunTopicAnalyses(runId: string, dependencies: Dependencies): Promise<RunAnalysisResult> {
  const topics = await dependencies.repository.ensureTopics(runId)
  const context = await dependencies.repository.getRunReportContext(runId)
  if (!context) throw new Error(`Run rapor bağlamı bulunamadı: ${runId}`)
  await dependencies.lifecycle?.analysisStarted(topics.length)

  if (topics.length === 0) {
    await dependencies.lifecycle?.analysisFinished()
    await dependencies.lifecycle?.reportsStarted(1)
    const noChangeReport = await createNoChangeReport(context, dependencies)
    await dependencies.lifecycle?.reportItemFinished()
    await dependencies.lifecycle?.reportsFinished()
    return { status: 'COMPLETED', topicReports: [], noChangeReport, counts: { total: 0, completed: 0, awaitingRetry: 0, failed: 0, reports: 1 } }
  }

  const outcomes = await executePool(topics.map((topic) => topic.id), dependencies.concurrency, async (topicId) => {
    try { return await dependencies.executeTopic(topicId) }
    finally { await dependencies.lifecycle?.analysisItemFinished() }
  })
  await dependencies.lifecycle?.analysisFinished()
  const successes = outcomes.flatMap((outcome) => outcome.ok ? [outcome.value] : [])
  const failures = outcomes.flatMap((outcome, index) => outcome.ok ? [] : [{ topicId: topics[index]!.id, error: outcome.error }])
  const passAnalyses = successes.filter((item) => item.analysis.status === 'PASS')
  const noContentAnalyses = successes.filter((item) => item.analysis.status === 'PASS_NO_RELEVANT_CONTENT')

  if (failures.length === 0 && passAnalyses.length === 0) {
    await Promise.all(noContentAnalyses.map((item) => dependencies.repository.markTopicCompleted(item.analysis.topicId)))
    await dependencies.lifecycle?.reportsStarted(1)
    const noChangeReport = await createNoChangeReport(context, dependencies)
    await dependencies.lifecycle?.reportItemFinished()
    await dependencies.lifecycle?.reportsFinished()
    return { status: 'COMPLETED', topicReports: [], noChangeReport, counts: { total: topics.length, completed: topics.length, awaitingRetry: 0, failed: 0, reports: 1 } }
  }

  await Promise.all(noContentAnalyses.map((item) => dependencies.repository.markTopicCompleted(item.analysis.topicId)))
  await dependencies.lifecycle?.reportsStarted(passAnalyses.length)
  const topicReports: StoredTopicReport[] = []
  for (const item of passAnalyses) {
    const sequence = topics.findIndex((topic) => topic.id === item.analysis.topicId) + 1
    try {
      topicReports.push(await publishTopic(context, item, sequence, dependencies))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Rapor üretimi başarısız.'
      await dependencies.repository.markTopicBlocked(item.analysis.topicId, message)
      failures.push({ topicId: item.analysis.topicId, error })
    } finally {
      await dependencies.lifecycle?.reportItemFinished()
    }
  }
  await dependencies.lifecycle?.reportsFinished()

  const retryable = failures.filter((failure) => failure.error instanceof AiProviderError && failure.error.retryable).length
  const terminal = failures.length - retryable
  const status: RunAnalysisResult['status'] = failures.length === 0
    ? 'COMPLETED'
    : terminal === 0
      ? 'AWAITING_RETRY'
      : topicReports.length > 0
        ? 'PARTIAL'
        : 'FAILED'
  return {
    status,
    topicReports,
    noChangeReport: null,
    counts: {
      total: topics.length,
      completed: noContentAnalyses.length + topicReports.length,
      awaitingRetry: retryable,
      failed: terminal,
      reports: topicReports.length,
    },
  }
}

async function publishTopic(context: RunReportContext, output: TopicAnalysisOutput, sequence: number, dependencies: Dependencies): Promise<StoredTopicReport> {
  const topicId = output.analysis.topicId
  await dependencies.repository.markTopicRendering(topicId)
  const spec = buildReportSpec(output.analysis, { sequence })
  const version = await dependencies.repository.nextReportVersion(context.runId, topicId)
  const revision = `r${String(version).padStart(2, '0')}`
  const basename = `${String(sequence).padStart(2, '0')}-${topicId}.html`
  const root = `runs/${context.targetDate.replaceAll('-', '/')}/${context.runId}/topics/${topicId}/reports/${revision}`
  const specObjectKey = `${root}/report-spec.json`
  const htmlObjectKey = `${root}/report.html`
  const html = await renderReportHtml(spec)
  await dependencies.repository.markTopicValidating(topicId)
  validateReportHtml(html, { card: spec.card, topicId, basename })
  await dependencies.objectStore.putRunFile(specObjectKey, Buffer.from(JSON.stringify(spec)), 'application/json')
  await dependencies.objectStore.putRunFile(htmlObjectKey, Buffer.from(html), 'text/html; charset=utf-8')
  return dependencies.repository.createReportRevision({
    scanRunId: context.runId,
    topicId,
    analysisRevisionId: output.id,
    title: spec.documentTitle,
    basename,
    card: spec.card,
    version,
    specObjectKey,
    htmlObjectKey,
  })
}

async function createNoChangeReport(context: RunReportContext, dependencies: Dependencies): Promise<StoredTopicReport> {
  const index = (await dependencies.objectStore.getContent(context.indexObjectKey)).toString('utf8')
  const issueNumber = extractIssueNumber(index)
  if (!issueNumber) throw new Error('BLOCKED_DATA: Resmî Gazete sayı bilgisi indeks belgesinde bulunamadı.')
  const version = await dependencies.repository.nextReportVersion(context.runId, null)
  const revision = `r${String(version).padStart(2, '0')}`
  const spec = ReportSpecSchema.parse({
    schemaVersion: 1,
    templateFamily: 'bulten-v2',
    reportId: `${compactDate(context.targetDate)}-00`,
    topicId: null,
    card: 'K6',
    documentTitle: 'ATEZ Mevzuat Radarı Günlük Raporu — Değişiklik Yok',
    issueNumber,
    displayDate: displayDate(context.targetDate),
    emptyDayText: `İncelenen ${context.inspectedDocumentCount} resmî belgede raporlanabilir gümrük veya dış ticaret değişikliği bulunmadı.`,
    source: { label: 'T.C. Resmî Gazete', url: context.indexSourceUrl },
    blocks: ['B1', 'B10'],
  } satisfies ReportSpec)
  const basename = '00-degisiklik-yok.html'
  const root = `runs/${context.targetDate.replaceAll('-', '/')}/${context.runId}/reports/${revision}`
  const specObjectKey = `${root}/report-spec.json`
  const htmlObjectKey = `${root}/${basename}`
  const html = await renderReportHtml(spec)
  validateReportHtml(html, { card: 'K6', topicId: null, basename })
  await dependencies.objectStore.putRunFile(specObjectKey, Buffer.from(JSON.stringify(spec)), 'application/json')
  await dependencies.objectStore.putRunFile(htmlObjectKey, Buffer.from(html), 'text/html; charset=utf-8')
  return dependencies.repository.createReportRevision({
    scanRunId: context.runId, topicId: null, analysisRevisionId: null, title: spec.documentTitle, basename,
    card: 'K6', version, specObjectKey, htmlObjectKey,
  })
}

type PoolResult<T> = { ok: true; value: T } | { ok: false; error: unknown }

async function executePool<T>(ids: string[], concurrency: number, execute: (id: string) => Promise<T>): Promise<Array<PoolResult<T>>> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Topic concurrency en az 1 olmalıdır.')
  const results = new Array<PoolResult<T>>(ids.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      const id = ids[index]
      if (id === undefined) return
      try { results[index] = { ok: true, value: await execute(id) } }
      catch (error) { results[index] = { ok: false, error } }
    }
  })
  await Promise.all(workers)
  return results
}

function extractIssueNumber(html: string): string | null {
  return html.match(/(?:ve\s+)?(\d{4,6})\s+Sayılı\s+Resm[iî]\s+Gazete/i)?.[1] ?? null
}

function compactDate(value: string): string {
  const [year, month, day] = value.split('-')
  return `${day}${month}${year?.slice(-2)}`
}

function displayDate(value: string): string {
  const formatted = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', weekday: 'long', timeZone: 'Europe/Istanbul' }).format(new Date(`${value}T12:00:00.000Z`))
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}
