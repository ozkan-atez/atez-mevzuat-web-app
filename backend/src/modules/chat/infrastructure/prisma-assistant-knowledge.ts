import type { PrismaClient } from '@prisma/client'
import { normalizeDocumentContent } from '../../scan-runs/application/normalize-document-content'
import { ReportSpecSchema, type ReportSpec } from '../../topic-analysis/domain/report-spec-schemas'
import type {
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
      where: { topicId: { not: null }, ...(range ? { scanRun: { targetDate: range } } : {}) },
      include: { revisions: { orderBy: { version: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
      take: input.query ? Math.max(limit * 5, 50) : limit,
    })

    const summaries = await Promise.all(reports.map(async (report) => {
      const revision = report.revisions[0]
      if (!revision) return null
      const spec = await this.readSpec(revision.specObjectKey)
      return spec ? this.toSummary(report.topicId!, spec, revision.version, revision.createdAt) : null
    }))

    const found = summaries.flatMap((item) => (item ? [item] : []))
    if (!input.query) return found.slice(0, limit)
    return found.filter((item) => matches(item, input.query!)).slice(0, limit)
  }

  async getReport(input: { topicId: string; version?: number }): Promise<ReportDetail | null> {
    const revision = await this.prisma.reportRevision.findFirst({
      where: { report: { topicId: input.topicId }, ...(input.version ? { version: input.version } : {}) },
      orderBy: { version: 'desc' },
    })
    if (!revision) return null
    const spec = await this.readSpec(revision.specObjectKey)
    if (!spec) return null
    const draft = await this.prisma.reportDraft.findFirst({
      where: { topicId: input.topicId, status: 'OPEN' },
      include: { _count: { select: { edits: true } } },
    })
    return {
      ...this.toSummary(input.topicId, spec, revision.version, revision.createdAt),
      content: renderSpecAsText(spec),
      pendingDraftChanges: draft?._count.edits ?? 0,
    }
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
      return {
        documentId: document.id, title: document.title, sourceUrl: document.sourceUrl, mediaType: stored.mediaType, text: null,
        note: 'Bu belge PDF olduğu için metni burada çıkarılmıyor. İçerik için analiz_getir veya rapor_getir kullanın.',
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
