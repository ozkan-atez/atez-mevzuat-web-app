import type { PrismaClient } from '@prisma/client'
import { extractPdfText } from './pdf-text'
import { normalizeDocumentContent } from '../../scan-runs/application/normalize-document-content'
import { sourcePriority } from '../../managed-sources/source-priority'
import { ReportSpecSchema, type ReportSpec } from '../../topic-analysis/domain/report-spec-schemas'
import type { OfficialLookup } from './official-document-lookup'
import type {
  AnalysisDetail,
  AssistantKnowledge,
  CustomerGroupSummary,
  DeliverySummary,
  DocumentSummary,
  DocumentText,
  DocumentConnections,
  DailyRunReport,
  DraftChanges,
  ReportFiles,
  RevisionHistory,
  ScanStages,
  OfficialDocument,
  OfficialSearchResult,
  ManagedSourceSummary,
  ManagedSourceDetail,
  PreviousSourceSummary,
  ReportDetail,
  ReportSummary,
  RunContents,
  ScanRunSummary,
} from '../application/assistant-knowledge'

interface ObjectReader {
  getContent(objectKey: string): Promise<Buffer>
}

const MAX_DOCUMENT_CHARACTERS = 20_000

export class PrismaAssistantKnowledge implements AssistantKnowledge {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly objectStore: ObjectReader,
    private readonly official?: OfficialLookup,
  ) {}

  async searchManagedSources(input: { query?: string; limit: number }): Promise<ManagedSourceSummary[]> {
    const query = input.query?.trim().slice(0, 200)
    const sources = await this.prisma.managedSource.findMany({
      where: {
        isActive: true, useInChat: true,
        ...(query ? { OR: [
          { title: { contains: query, mode: 'insensitive' as const } },
          { description: { contains: query, mode: 'insensitive' as const } },
          { keywords: { contains: query, mode: 'insensitive' as const } },
          { contentText: { contains: query, mode: 'insensitive' as const } },
        ] } : {}),
      },
      orderBy: { updatedAt: 'desc' }, take: Math.max(input.limit, 100),
    })
    const ranks = await sourcePriority(this.prisma, sources)
    return sources.sort((a, b) => (ranks.get(a.id) ?? 4) - (ranks.get(b.id) ?? 4)).slice(0, input.limit).map((source) => ({
      id: source.id, title: source.title, url: source.url, description: source.description,
      fetchedAt: source.fetchedAt?.toISOString() ?? null, readable: Boolean(source.contentText),
    }))
  }

  async getManagedSource(input: { id: string }): Promise<ManagedSourceDetail | null> {
    const source = await this.prisma.managedSource.findFirst({ where: { id: input.id, isActive: true, useInChat: true } })
    if (!source) return null
    return {
      id: source.id, title: source.title, url: source.url, description: source.description,
      fetchedAt: source.fetchedAt?.toISOString() ?? null, readable: Boolean(source.contentText),
      text: source.contentText?.slice(0, 20_000) ?? null,
    }
  }

  /**
   * Finds bulletins by the words a person would use.
   *
   * The match runs over the bulletin's own wording — its title and summary live in
   * the stored spec, not in the database row — so a candidate window is read first
   * and filtered after. At this corpus size that is cheaper than maintaining a
   * search index; when it stops being so, this is the one place to add one.
   */
  async searchReports(input: { query?: string; from?: string; to?: string; limit?: number }): Promise<ReportSummary[]> {
    const limit = input.limit ?? 10
    const range = dateRange(input.from, input.to)
    const found: ReportSummary[] = []
    // Read successive bounded pages; searching only the newest 50 silently misses
    // older bulletins whose title differs from the wording in their stored spec.
    for (let skip = 0; skip < 5_000 && found.length < limit; skip += 100) {
      const reports = await this.prisma.topicReport.findMany({
        where: { topicId: { not: null }, ...(range ? { scanRun: { targetDate: range } } : {}) },
        include: { revisions: { orderBy: { version: 'desc' }, take: 1 } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip, take: input.query ? 100 : limit,
      })
      for (const report of reports) {
        const revision = report.revisions[0]
        if (!revision) continue
        const spec = await this.readSpec(revision.specObjectKey)
        if (!spec) continue
        const summary = { ...this.toSummary(report.topicId!, spec, revision.version, revision.createdAt), reportId: report.id, runId: report.scanRunId }
        if (!input.query || matches(summary, input.query)) found.push(summary)
        if (found.length >= limit) break
      }
      if (reports.length < (input.query ? 100 : limit)) break
      if (!input.query) break
    }
    return found.slice(0, limit)
  }

  async getReport(input: { topicId?: string; reportId?: string; version?: number }): Promise<ReportDetail | null> {
    const report = await this.findReport(input)
    if (!report) return null
    const revision = await this.prisma.reportRevision.findFirst({
      where: { reportId: report.id, ...(input.version ? { version: input.version } : {}) },
      orderBy: { version: 'desc' },
    })
    if (!revision) return null
    const spec = await this.readSpec(revision.specObjectKey)
    if (!spec) return null
    const draft = report.topicId ? await this.prisma.reportDraft.findFirst({
      where: { topicId: report.topicId, status: 'OPEN' },
      include: { _count: { select: { edits: true } } },
    }) : null
    const pendingSpec = report.pendingSpecJson ? ReportSpecSchema.safeParse(report.pendingSpecJson) : null
    return {
      ...this.toSummary(report.topicId ?? '', spec, revision.version, revision.createdAt),
      reportId: report.id, runId: report.scanRunId,
      reportUrl: report.topicId ? `/reports/${report.topicId}?revision=${revision.version}` : `/runs/${report.scanRunId}/reports/${report.id}`,
      content: renderSpecAsText(spec),
      pendingDraftChanges: draft?._count.edits ?? 0,
      reviewStatus: report.reviewStatus,
      pendingDraft: report.reviewStatus === 'PENDING_APPROVAL' && pendingSpec?.success
        ? { baseVersion: report.pendingBaseVersion ?? revision.version, content: renderSpecAsText(pendingSpec.data), changes: 1 }
        : draft ? { baseVersion: draft.baseVersion, content: 'Alan değişiklikleri taslak_degisiklikleri_getir ile görülebilir.', changes: draft._count.edits } : null,
    }
  }

  async dailyReports(input: { date: string }): Promise<DailyRunReport[]> {
    const runs = await this.prisma.scanRun.findMany({
      where: { targetDate: new Date(`${input.date}T00:00:00.000Z`) }, orderBy: { createdAt: 'desc' },
      include: { topicReports: { include: { revisions: { orderBy: { version: 'desc' }, take: 1 } }, orderBy: { createdAt: 'asc' } } },
    })
    return runs.map((run) => ({
      runId: run.id, status: run.status,
      reports: run.topicReports.flatMap((report) => report.revisions[0] ? [{
        reportId: report.id, topicId: report.topicId, title: report.title,
        version: report.revisions[0]!.version, status: report.revisions[0]!.status, reviewStatus: report.reviewStatus,
        reportUrl: report.topicId ? `/reports/${report.topicId}?revision=${report.revisions[0]!.version}` : `/runs/${run.id}/reports/${report.id}`,
      }] : []),
    }))
  }

  async reportFiles(input: { topicId?: string; reportId?: string; version?: number }): Promise<ReportFiles | null> {
    const report = await this.findReport(input)
    if (!report) return null
    const revision = await this.prisma.reportRevision.findFirst({ where: { reportId: report.id, ...(input.version ? { version: input.version } : {}), status: 'VALIDATED' }, orderBy: { version: 'desc' } })
    if (!revision) return null
    return {
      reportId: report.id, version: revision.version,
      previewHtmlUrl: report.topicId ? `/api/v1/topics/${report.topicId}/reports/${revision.version}/html` : `/api/v1/scan-runs/${report.scanRunId}/reports/${report.id}/html?version=${revision.version}`,
      htmlUrl: report.topicId ? `/api/v1/topics/${report.topicId}/reports/${revision.version}/html?download=1` : `/api/v1/scan-runs/${report.scanRunId}/reports/${report.id}/html?version=${revision.version}&download=1`,
      pdfUrl: report.topicId ? `/api/v1/topics/${report.topicId}/reports/${revision.version}/pdf` : `/api/v1/scan-runs/${report.scanRunId}/reports/${report.id}/pdf?version=${revision.version}`,
      reportUrl: report.topicId ? `/reports/${report.topicId}?revision=${revision.version}` : `/runs/${report.scanRunId}/reports/${report.id}`,
    }
  }

  async revisionHistory(input: { topicId?: string; reportId?: string }): Promise<RevisionHistory | null> {
    const report = await this.findReport(input)
    if (!report) return null
    const [revisions, analyses] = await Promise.all([
      this.prisma.reportRevision.findMany({ where: { reportId: report.id }, orderBy: { version: 'asc' }, include: { report: { select: { topic: { select: { thread: { include: { messages: true } } } } } } } }),
      report.topicId ? this.prisma.analysisRevision.findMany({ where: { topicId: report.topicId }, orderBy: { version: 'asc' } }) : Promise.resolve([]),
    ])
    const messages = revisions[0]?.report.topic?.thread?.messages ?? []
    return {
      reportId: report.id, reviewStatus: report.reviewStatus,
      reportRevisions: revisions.map((revision) => ({ version: revision.version, status: revision.status, createdAt: revision.createdAt.toISOString(), request: messages.find((message) => message.id === revision.requestMessageId)?.content ?? null })),
      analysisRevisions: analyses.map((revision) => ({ version: revision.version, status: revision.status, createdAt: revision.createdAt.toISOString(), request: messages.find((message) => message.id === revision.requestMessageId)?.content ?? null })),
    }
  }

  async draftChanges(input: { topicId?: string; reportId?: string }): Promise<DraftChanges | null> {
    const report = await this.findReport(input)
    if (!report) return null
    const draft = report.topicId ? await this.prisma.reportDraft.findFirst({ where: { topicId: report.topicId, status: 'OPEN' }, orderBy: { createdAt: 'desc' }, include: { edits: { orderBy: { sequence: 'asc' } } } }) : null
    const pending = report.pendingSpecJson ? ReportSpecSchema.safeParse(report.pendingSpecJson) : null
    return {
      reportId: report.id, reviewStatus: report.reviewStatus, baseVersion: draft?.baseVersion ?? report.pendingBaseVersion,
      changes: draft?.edits.map((edit) => ({ sequence: edit.sequence, path: edit.path, previousValue: edit.previousValue, nextValue: edit.nextValue, source: edit.source, reverted: draft.edits.some((other) => other.revertsEditId === edit.id), createdAt: edit.createdAt.toISOString() })) ?? [],
      ...(pending?.success ? { pendingContent: renderSpecAsText(pending.data) } : {}),
    }
  }

  private async findReport(input: { topicId?: string; reportId?: string }) {
    if (input.reportId) return this.prisma.topicReport.findUnique({ where: { id: input.reportId } })
    if (input.topicId) return this.prisma.topicReport.findFirst({ where: { topicId: input.topicId } })
    return null
  }

  async getAnalysis(input: { topicId: string; version?: number }): Promise<AnalysisDetail | null> {
    const revision = await this.prisma.analysisRevision.findFirst({
      where: { topicId: input.topicId, ...(input.version ? { version: input.version } : {}) },
      orderBy: { version: 'desc' },
    })
    if (!revision) return null
    const markdown = await this.readText(revision.markdownObjectKey)
    return {
      topicId: input.topicId,
      version: revision.version,
      status: revision.status,
      markdown: truncate(markdown ?? '(analiz metni arşivde bulunamadı)', MAX_DOCUMENT_CHARACTERS),
      createdAt: revision.createdAt.toISOString(),
    }
  }

  async searchDocuments(input: { query?: string; from?: string; to?: string; onlyRelevant?: boolean; limit?: number }): Promise<DocumentSummary[]> {
    const range = dateRange(input.from, input.to)
    const documents = await this.prisma.collectedDocument.findMany({
      where: {
        ...(input.query ? { title: { contains: input.query, mode: 'insensitive' } } : {}),
        ...(range ? { edition: { publicationDate: range } } : {}),
        ...(input.onlyRelevant ? { filterDecisions: { some: { finalDecision: 'IN' } } } : {}),
      },
      include: {
        edition: { select: { publicationDate: true, type: true } },
        storedObject: { select: { mediaType: true } },
        topicProcess: { select: { id: true } },
        filterDecisions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: [{ edition: { publicationDate: 'desc' } }, { publicationOrder: 'asc' }],
      take: input.limit ?? 20,
    })

    return documents.map((document) => ({
      documentId: document.id,
      title: document.title,
      publicationDate: isoDay(document.edition.publicationDate),
      editionType: document.edition.type,
      sourceUrl: document.sourceUrl,
      filterDecision: document.filterDecisions[0]?.finalDecision ?? null,
      filterReason: document.filterDecisions[0]?.contentReason ?? document.filterDecisions[0]?.titleReason ?? null,
      hasTopic: document.topicProcess !== null,
      mediaType: document.storedObject?.mediaType ?? null,
    }))
  }

  async getDocumentText(input: { documentId: string }): Promise<DocumentText | null> {
    const document = await this.prisma.collectedDocument.findUnique({
      where: { id: input.documentId },
      include: { storedObject: true },
    })
    if (!document) return null
    const stored = document.storedObject
    if (!stored) {
      return { documentId: document.id, title: document.title, sourceUrl: document.sourceUrl, mediaType: 'bilinmiyor', text: null, note: 'Belgenin arşivlenmiş kopyası yok.' }
    }
    if (stored.mediaType === 'application/pdf') {
      let text: string | null = null
      try { text = await extractPdfText(await this.objectStore.getContent(stored.objectKey)) } catch { /* An unreadable PDF still has a valid source link. */ }
      return {
        documentId: document.id, title: document.title, sourceUrl: document.sourceUrl, mediaType: stored.mediaType, text,
        ...(text ? {} : { note: 'PDF metni çıkarılamadı; kaynak bağlantısını veya analizi inceleyin.' }),
      }
    }
    const bytes = await this.objectStore.getContent(stored.objectKey)
    const parts = normalizeDocumentContent({ id: document.id, title: document.title, mediaType: stored.mediaType, bytes })
    const text = parts.map((part) => ('text' in part ? part.text : '')).join('\n')
    return {
      documentId: document.id, title: document.title, sourceUrl: document.sourceUrl, mediaType: stored.mediaType,
      text: truncate(text, MAX_DOCUMENT_CHARACTERS),
    }
  }

  async listScanRuns(input: { date?: string; limit?: number }): Promise<ScanRunSummary[]> {
    const runs = await this.prisma.scanRun.findMany({
      ...(input.date ? { where: { targetDate: new Date(`${input.date}T00:00:00.000Z`) } } : {}),
      include: {
        _count: { select: { topicReports: true } },
        editions: { select: { _count: { select: { documents: true } } } },
        topicProcesses: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: input.limit ?? 10,
    })

    return runs.map((run) => ({
      runId: run.id,
      targetDate: isoDay(run.targetDate),
      trigger: run.scheduleSlot ? `CRON:${run.scheduleSlot}` : run.trigger,
      status: run.status,
      currentStage: run.currentStage,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      documents: run.editions.reduce((sum, edition) => sum + edition._count.documents, 0),
      relevantDocuments: run.topicProcesses.length,
      reports: run._count.topicReports,
      errorSummary: run.errorSummary,
    }))
  }

  async getRunContents(input: { runId: string }): Promise<RunContents | null> {
    const run = await this.prisma.scanRun.findUnique({
      where: { id: input.runId },
      select: {
        id: true, targetDate: true, status: true,
        topicReports: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, title: true,
            topic: { select: { document: { select: { sourceUrl: true } } } },
            revisions: { orderBy: { version: 'desc' }, take: 1, select: { version: true, status: true } },
          },
        },
        editions: {
          select: {
            indexUrl: true,
            documents: {
              select: {
                id: true, title: true, sourceUrl: true,
                filterDecisions: { where: { finalDecision: 'IN' }, take: 1, select: { id: true } },
              },
            },
          },
        },
      },
    })
    if (!run) return null
    const documents = run.editions.flatMap((edition) => edition.documents)
    return {
      runId: run.id,
      targetDate: isoDay(run.targetDate),
      status: run.status,
      totalDocuments: documents.length,
      reports: run.topicReports.flatMap((report) => {
        const revision = report.revisions[0]
        return revision?.status === 'VALIDATED' ? [{
          reportId: report.id,
          title: report.title,
          version: revision.version,
          reportUrl: `/runs/${run.id}/reports/${report.id}`,
          sourceUrl: report.topic?.document.sourceUrl ?? null,
        }] : []
      }),
      relevantDocuments: documents.filter((document) => document.filterDecisions.length > 0).map((document) => ({
        documentId: document.id,
        title: document.title,
        sourceUrl: document.sourceUrl,
      })),
      gazetteIndexes: run.editions.map((edition) => edition.indexUrl),
    }
  }

  async documentConnections(input: { documentId: string }): Promise<DocumentConnections | null> {
    const document = await this.prisma.collectedDocument.findUnique({
      where: { id: input.documentId },
      include: {
        filterDecisions: { orderBy: { createdAt: 'desc' }, take: 1 }, assets: { select: { sourceUrl: true, role: true } },
        topicProcess: { include: {
          analyses: { select: { version: true, status: true }, orderBy: { version: 'asc' } },
          reports: { include: { revisions: { select: { version: true }, orderBy: { version: 'desc' }, take: 1 } } },
        } },
      },
    })
    if (!document) return null
    const topic = document.topicProcess
    const sources = topic ? await this.listPreviousSources({ topicId: topic.id }) : []
    return {
      documentId: document.id, title: document.title, sourceUrl: document.sourceUrl,
      filterDecision: document.filterDecisions[0]?.finalDecision ?? null,
      filterReason: document.filterDecisions[0]?.contentReason ?? document.filterDecisions[0]?.titleReason ?? null,
      assets: document.assets, topicId: topic?.id ?? null, analyses: topic?.analyses ?? [],
      reports: topic?.reports.flatMap((report) => report.revisions[0] ? [{ reportId: report.id, version: report.revisions[0]!.version, reportUrl: `/reports/${topic.id}?revision=${report.revisions[0]!.version}` }] : []) ?? [],
      previousSources: sources,
    }
  }

  async scanStages(input: { runId: string }): Promise<ScanStages | null> {
    const run = await this.prisma.scanRun.findUnique({
      where: { id: input.runId },
      include: { stages: { orderBy: { createdAt: 'asc' } }, attempts: { where: { status: 'FAILED' }, orderBy: { createdAt: 'desc' }, take: 20 } },
    })
    if (!run) return null
    return {
      runId: run.id, status: run.status, currentStage: run.currentStage, errorSummary: run.errorSummary,
      stages: run.stages.map((stage) => ({ stage: stage.stage, status: stage.status, error: stage.errorSummary })),
      failedFetches: run.attempts.map((attempt) => ({ url: attempt.sourceUrl, status: attempt.status, error: attempt.errorMessage })),
    }
  }

  async searchOfficial(input: { query: string; endDate?: string; limit: number }): Promise<OfficialSearchResult> {
    if (!this.official) throw new Error('Resmî Gazete arama servisi yapılandırılmamış.')
    return this.official.search(input)
  }

  async getOfficialDocument(input: { sourceUrl: string; title?: string; publicationDate?: string }): Promise<OfficialDocument | null> {
    if (!this.official) throw new Error('Resmî Gazete belge servisi yapılandırılmamış.')
    return this.official.getDocument(input)
  }

  async listPreviousSources(input: { topicId: string }): Promise<PreviousSourceSummary[]> {
    const documents = await this.prisma.previousSourceDocument.findMany({
      where: { job: { document: { topicProcess: { id: input.topicId } } } },
      orderBy: { publicationDate: 'desc' },
    })
    return documents.map((document) => ({
      title: document.title,
      publicationDate: isoDay(document.publicationDate),
      gazetteNo: document.gazetteNo,
      sourceUrl: document.sourceUrl,
    }))
  }

  async listDeliveries(input: { topicId?: string; limit?: number }): Promise<DeliverySummary[]> {
    const dispatches = await this.prisma.emailDispatch.findMany({
      ...(input.topicId ? { where: { topicId: input.topicId } } : {}),
      orderBy: { createdAt: 'desc' },
      take: input.limit ?? 20,
    })
    return dispatches.map((dispatch) => ({
      topicId: dispatch.topicId,
      reportVersion: dispatch.reportVersion,
      subject: dispatch.subject,
      // The count, not the addresses: the assistant never needs to recite them.
      recipients: dispatch.recipients.length,
      status: dispatch.status,
      sentAt: dispatch.sentAt?.toISOString() ?? null,
      errorMessage: dispatch.errorMessage,
    }))
  }

  async listCustomerGroups(): Promise<CustomerGroupSummary[]> {
    const groups = await this.prisma.customerGroup.findMany({ orderBy: { name: 'asc' } })
    return groups.map((group) => ({
      name: group.name,
      description: group.description,
      recipients: group.emails.length,
      isActive: group.isActive,
    }))
  }

  private toSummary(topicId: string, spec: ReportSpec, version: number, publishedAt: Date): ReportSummary {
    return {
      topicId,
      title: spec.card === 'K6' ? spec.documentTitle : spec.title,
      card: spec.card,
      version,
      gazetteDate: spec.displayDate,
      issueNumber: spec.issueNumber,
      summary: spec.card === 'K6' ? spec.emptyDayText : spec.summary,
      sourceUrl: spec.source.url,
      reportUrl: `/reports/${topicId}?revision=${version}`,
      publishedAt: publishedAt.toISOString(),
    }
  }

  private async readSpec(objectKey: string): Promise<ReportSpec | null> {
    const raw = await this.readText(objectKey)
    if (!raw) return null
    const parsed = ReportSpecSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  }

  private async readText(objectKey: string): Promise<string | null> {
    try {
      return (await this.objectStore.getContent(objectKey)).toString('utf8')
    } catch {
      // An archived object that has gone missing must not take the answer down.
      return null
    }
  }
}

/** Renders a stored bulletin spec as the text a reader would see. */
export function renderSpecAsText(spec: ReportSpec): string {
  const lines: string[] = []
  if (spec.card === 'K6') {
    lines.push(spec.documentTitle, `Gazete: ${spec.displayDate} — Sayı ${spec.issueNumber}`, '', spec.emptyDayText)
    return lines.join('\n')
  }

  lines.push(
    `Başlık: ${spec.title}`,
    `Belge: ${spec.documentTitle}`,
    `Tür: ${spec.typeLabel}`,
    `Gazete: ${spec.displayDate} — Sayı ${spec.issueNumber}`,
    ...(spec.documentNumber ? [`Belge numarası: ${spec.documentNumber}`] : []),
    '',
    `Özet: ${spec.summary}`,
  )
  if (spec.affectedParties.length > 0) lines.push('', 'Etkilenen taraflar:', ...spec.affectedParties.map((item) => `- ${item}`))
  if (spec.dates.length > 0) lines.push('', 'Tarihler:', ...spec.dates.map((item) => `- ${item}`))
  if (spec.note) lines.push('', `Not: ${spec.note}`)

  if (spec.card === 'K2') {
    lines.push('', `Tablo: ${spec.table.title}`, spec.table.columns.join(' | '), ...spec.table.rows.map((row) => row.join(' | ')))
    if (spec.table.note) lines.push(`Tablo notu: ${spec.table.note}`)
  }
  if (spec.card === 'K3') {
    lines.push('', `Önceki son tarih: ${spec.oldDeadline}`, `Yeni son tarih: ${spec.newDeadline}`, 'Takvim:',
      ...spec.timeline.map((item) => `- ${item.date}: ${item.description}`))
  }
  if (spec.card === 'K4') {
    lines.push('', `Kaldırılan düzenleme: ${spec.removedRule}`,
      `Yerine gelen: ${spec.replacementRule ?? '(belirtilmemiş)'}`, `Kritik uyarı: ${spec.alert}`)
  }
  if (spec.card === 'K5') lines.push('', `Destekleyici kaynak: ${spec.supportingSource.label} — ${spec.supportingSource.url}`)

  lines.push('', `Kaynak: ${spec.source.label} — ${spec.source.url}`)
  return lines.join('\n')
}

function matches(summary: ReportSummary, query: string): boolean {
  const haystack = `${summary.title} ${summary.summary}`.toLocaleLowerCase('tr-TR')
  const words = query.toLocaleLowerCase('tr-TR').split(/\s+/).filter((word) => word.length > 2)
  return words.length === 0 || words.some((word) => haystack.includes(word))
}

function dateRange(from?: string, to?: string): { gte?: Date; lte?: Date } | null {
  if (!from && !to) return null
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
  }
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…\n(metin kısaltıldı)` : text
}
