import { documentAccessWhere, privateResourceWhere, reportAccessWhere,topicContentAccessWhere } from '../../../platform/actor-context'
import { load } from 'cheerio'
import { extractPdfText } from '../../managed-sources/pdf-text'
import { sourcePriority } from '../../managed-sources/source-priority'
import type { PrismaClient } from '@prisma/client'
import { normalizeDocumentContent } from '../../scan-runs/application/normalize-document-content'
import { ReportSpecSchema, type ReportSpec } from '../../topic-analysis/domain/report-spec-schemas'
import type {
  ManagedSourceSummary,
  ManagedSourceDetail,
  AnalysisDetail,
  AssistantKnowledge,
  CustomerGroupSummary,
  DeliverySummary,
  DocumentSummary,
  DocumentText,
  PreviousSourceSummary,
  ReportDetail,
  ReportSummary,
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
  ) {}

  async listOperationSources() {
    return this.prisma.source.findMany({where:{isActive:true},select:{id:true,key:true,name:true,authorityType:true},orderBy:{name:'asc'},take:30})
  }

  async listAutomations(input: { date?: string; limit: number }) {
    const automations = await this.prisma.workspaceAutomation.findMany({ orderBy: { name: 'asc' }, take: Math.min(input.limit, 20) })
    return Promise.all(automations.map(async automation => {
      const runs = await this.prisma.scanRun.findMany({
        where: { automationId: automation.id, ...(input.date ? { targetDate: new Date(`${input.date}T00:00:00Z`) } : {}) },
        orderBy: { createdAt: 'desc' }, take: 5,
        include: { stages: true, sourceRuns: { include: { stages: true, source: { select: { name: true } } } } },
      })
      const operations = process.env.MODULAR_OPERATIONS_ENABLED === 'true' ? await this.prisma.operationRequest.findMany({
        where: { ...privateResourceWhere(), parameters: { path: ['automationId'], equals: automation.id }, ...(input.date ? { createdAt: { gte: new Date(`${input.date}T00:00:00+03:00`), lt: new Date(new Date(`${input.date}T00:00:00+03:00`).getTime() + 86400000) } } : {}) },
        orderBy: { createdAt: 'desc' }, take: 10, include: { tasks: true },
      }) : []
      return {
        id: automation.id, name: automation.name, isActive: automation.isActive,
        times: automation.times, timezone: automation.timezone, lastError: automation.lastError,
        operations: operations.map(operation => ({ id: operation.id, operation: operation.operation, status: operation.status, createdAt: operation.createdAt.toISOString(), tasks: operation.tasks.map(task => ({ stage: task.operation, status: task.status, error: task.errorMessage })) })),
        runs: runs.map(run => ({ runId: run.id, targetDate: isoDay(run.targetDate), status: run.status, errorSummary: run.errorSummary,
          stages: [...run.stages.map(stage => ({ stage: stage.stage, status: stage.status, error: stage.errorSummary })),
            ...run.sourceRuns.flatMap(sourceRun => [
              ...(sourceRun.errorSummary ? [{ stage: 'SOURCE', status: sourceRun.status, error: sourceRun.errorSummary, source: sourceRun.source.name ?? 'Kaynak' }] : []),
              ...sourceRun.stages.map(stage => ({ stage: stage.stage, status: stage.status, error: stage.error, source: sourceRun.source.name ?? 'Kaynak' })),
            ])],
        })),
      }
    }))
  }

  async searchArchiveDocuments(input: { query?: string; from?: string; to?: string; limit: number }) {
    const range = dateRange(input.from, input.to)
    const documents = await this.prisma.document.findMany({
      where: { ...documentAccessWhere(), ...(input.query ? { title: { contains: input.query, mode: 'insensitive' } } : {}), ...(range ? { publishedOn: range } : {}) },
      include: { versions: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { createdAt: 'desc' }, take: Math.min(input.limit, 50),
    })
    return documents.flatMap(document => document.versions.map(version => ({ documentId: document.id, versionId: version.id, title: document.title, origin: document.origin, publishedOn: document.publishedOn ? isoDay(document.publishedOn) : null, sourceUrl: document.canonicalUrl, mimeType: version.mimeType, extractionStatus: version.extractionStatus })))
  }

  async getArchiveDocumentVersion(input: { versionId: string }) {
    const version = await this.prisma.documentVersion.findFirst({ where: { id: input.versionId, document:documentAccessWhere() }, include: { document: true } })
    if (!version) return null
    return { documentId: version.documentId, versionId: version.id, title: version.document.title, origin: version.document.origin, publishedOn: version.document.publishedOn ? isoDay(version.document.publishedOn) : null, sourceUrl: version.document.canonicalUrl, mimeType: version.mimeType, extractionStatus: version.extractionStatus, text: version.extractedText ? truncate(version.extractedText, MAX_DOCUMENT_CHARACTERS) : null }
  }

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
      orderBy: { updatedAt: 'desc' }, take: 100,
    })
    const ranks = await sourcePriority(this.prisma, sources)
    return sources.sort((a, b) => (ranks.get(a.id) ?? 4) - (ranks.get(b.id) ?? 4)).slice(0, Math.max(1, Math.min(input.limit, 20))).map((source) => ({
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
    const reports = await this.prisma.topicReport.findMany({
      where: { AND:[reportAccessWhere()],revisions: { some: {} }, ...(range ? { OR: [{ scanRun: { targetDate: range } }, { operationTaskId: { not: null }, revisions: { some: { createdAt: { ...(range.gte ? { gte: range.gte } : {}), ...(range.lte ? { lt: new Date(range.lte.getTime() + 86400000) } : {}) } } } }] } : {}) },
      include: { revisions: { orderBy: { version: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
      take: input.query ? Math.max(limit * 5, 50) : limit,
    })

    const summaries = await Promise.all(reports.map(async (report) => {
      const revision = report.revisions[0]
      if (!revision) return null
      if (report.operationTaskId) return this.readStandaloneSummary(report.id, revision.specObjectKey, revision.version, revision.createdAt)
      const spec = await this.readSpec(revision.specObjectKey)
      return spec ? { ...this.toSummary(report.topicId ?? report.id, spec, revision.version, revision.createdAt), ...(!report.topicId ? { reportUrl: `/runs/${report.scanRunId}/reports/${report.id}`, revisionEditable: report.card === 'K6' } : {}) } : null
    }))

    const found = summaries.flatMap((item) => (item ? [item] : []))
    if (!input.query) return found.slice(0, limit)
    return found.filter((item) => matches(item, input.query!)).slice(0, limit)
  }

  async getReport(input: { topicId: string; version?: number }): Promise<ReportDetail | null> {
    const revision = await this.prisma.reportRevision.findFirst({
      where: { report: { AND:[reportAccessWhere(),{ OR: [{ topicId: input.topicId }, { id: input.topicId }] }] }, ...(input.version ? { version: input.version } : {}) },
      orderBy: { version: 'desc' },
    })
    if (!revision) return null
    const report = await this.prisma.topicReport.findUnique({ where: { id: revision.reportId } })
    if (report?.operationTaskId) {
      const summary = await this.readStandaloneSummary(report.id, revision.specObjectKey, revision.version, revision.createdAt)
      if (!summary) return null
      const data = JSON.parse((await this.readText(revision.specObjectKey)) ?? '{}') as Record<string, unknown>
      return { ...summary, content: load(typeof data.html === 'string' ? data.html : '').text().slice(0, MAX_DOCUMENT_CHARACTERS), pendingDraftChanges: 0 }
    }
    const spec = await this.readSpec(revision.specObjectKey)
    if (!spec) return null
    const draft = await this.prisma.reportDraft.findFirst({
      where: { topicId: input.topicId, status: 'OPEN' },
      include: { _count: { select: { edits: true } } },
    })
    return {
      ...this.toSummary(input.topicId, spec, revision.version, revision.createdAt),
      ...(report && !report.topicId ? { reportUrl: `/runs/${report.scanRunId}` } : {}),
      content: renderSpecAsText(spec),
      pendingDraftChanges: draft?._count.edits ?? 0,
    }
  }

  async getAnalysis(input: { topicId: string; version?: number }): Promise<AnalysisDetail | null> {
    const revision = await this.prisma.analysisRevision.findFirst({
      where: { topicId: input.topicId,topic:topicContentAccessWhere(), ...(input.version ? { version: input.version } : {}) },
      orderBy: { version: 'desc' },
    })
    if (!revision) {
      const report = await this.prisma.topicReport.findFirst({ where: { id: input.topicId, ...privateResourceWhere(), operationTaskId: { not: null } }, include: { revisions: { orderBy: { version: 'desc' }, take: 1 } } })
      const latest = report?.revisions[0]
      if (!latest) return null
      const raw = await this.readText(latest.specObjectKey)
      if (!raw) return null
      let spec: Record<string,unknown>
      try { spec = JSON.parse(raw) } catch { return null }
      if (typeof spec.analysisTaskId !== 'string') return null
      const task = await this.prisma.operationTask.findFirst({ where: { id: spec.analysisTaskId, ...privateResourceWhere(), status: 'SUCCEEDED' }, include: { artifacts: true } })
      const payload = task?.artifacts.find(a => a.kind === 'ANALYSIS')?.data as Record<string,unknown> | undefined
      if (!payload) return null
      return { topicId: input.topicId, version: latest.version, status: 'PASS', markdown: truncate(`${payload.title ?? ''}\n\n${payload.summary ?? ''}\n\n${payload.detailedAnalysis ?? ''}`, MAX_DOCUMENT_CHARACTERS), createdAt: task!.createdAt.toISOString() }
    }
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
    const bytes = await this.objectStore.getContent(stored.objectKey)
    if (stored.mediaType === 'application/pdf') {
      const text = await extractPdfText(bytes).catch(() => null)
      return { documentId: document.id, title: document.title, sourceUrl: document.sourceUrl, mediaType: stored.mediaType, text, ...(!text ? { note: 'PDF okunamadı; OCR veya kilit çözümü gerekebilir.' } : {}) }
    }
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

  private async readStandaloneSummary(reportId: string, objectKey: string, version: number, publishedAt: Date): Promise<ReportSummary | null> {
    const raw = await this.readText(objectKey)
    if (!raw) return null
    let data: Record<string, unknown>
    try { data = JSON.parse(raw) } catch { return null }
    if (typeof data.title !== 'string' || typeof data.html !== 'string') return null
    const content = data.reportContent as Record<string, unknown> | undefined
    const sources = Array.isArray(data.sourceContext) ? data.sourceContext as Array<{ url?: string | null }> : []
    return { topicId: reportId, title: data.title, revisionEditable: false, card: 'K5', version, gazetteDate: isoDay(publishedAt), issueNumber: 'Belge raporu; yayımlanma tarihi', summary: typeof content?.summary === 'string' ? content.summary : '', sourceUrl: sources.find(s => s.url)?.url ?? '', reportUrl: `/reports/documents/${reportId}?revision=${version}`, publishedAt: publishedAt.toISOString() }
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
