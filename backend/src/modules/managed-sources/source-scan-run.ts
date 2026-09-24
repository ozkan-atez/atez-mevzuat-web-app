import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { renderReportHtml } from '../topic-analysis/application/render-report-html'
import type { ReportSpec } from '../topic-analysis/domain/report-spec-schemas'
import { readSourceItem, scrapeSourceFeed } from './source-feed-scrapers'
import type { TariffCredentials } from './tariff-auth'

export async function createSourceRun(prisma: PrismaClient, input: { sourceId: string; scanRunId?: string; targetDate: string; requestKey: string; trigger: 'MANUAL' | 'CRON'; scheduleSlot?: string }) {
  const source = await prisma.source.findUnique({ where: { id: input.sourceId }, include: { endpoints: { where: { status: 'ACTIVE', adapter: { not: null } } } } })
  if (!source?.isActive || !source.endpoints.length || source.key === 'resmi-gazete') throw new Error('Bu kaynak için etkin tarihli tarama akışı bulunamadı.')
  const existing = await prisma.sourceScanRun.findUnique({ where: { requestKey: input.requestKey } })
  if (existing) return existing
  return prisma.sourceScanRun.create({ data: {
    sourceId: input.sourceId, scanRunId: input.scanRunId ?? null, requestKey: input.requestKey, targetDate: new Date(`${input.targetDate}T00:00:00.000Z`), trigger: input.trigger, scheduleSlot: input.scheduleSlot ?? null,
  } })
}

export async function executeSourceRun(prisma: PrismaClient, runId: string, tariffCredentials?: TariffCredentials | null): Promise<void> {
  const claimed = await prisma.sourceScanRun.updateMany({ where: { id: runId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date(), errorSummary: null } })
  if (!claimed.count) return
  const run = await prisma.sourceScanRun.findUniqueOrThrow({ where: { id: runId }, include: { source: { include: { endpoints: { where: { status: 'ACTIVE', adapter: { not: null } } } } } } })
  const targetDate = run.targetDate.toISOString().slice(0, 10)
  const failures: string[] = []
  try {
    if (!run.source.endpoints.length) throw new Error('Etkin tarama adresi bulunamadı.')
    if (run.source.key === 'tariff' && !tariffCredentials) throw new Error('TARIFF hesabı etkin değil; bu tarama başlatılamadı.')
    for (const feed of run.source.endpoints) {
      try {
        const items = await scrapeSourceFeed({ adapter: feed.adapter!, url: feed.url, sourceKey: run.source.key, targetDate, ...(tariffCredentials ? { credentials: tariffCredentials } : {}) })
        for (const item of items) {
          try {
            const contentText = await readSourceItem(item, feed.adapter!)
            await prisma.sourceScanDocument.upsert({ where: { runId_url: { runId, url: item.url } },
              create: { runId, url: item.url, title: item.title, publishedOn: new Date(`${item.publishedOn}T00:00:00Z`), contentText, contentHash: contentText ? createHash('sha256').update(contentText).digest('hex') : null, feedUrl: item.feedUrl },
              update: {},
            })
          } catch { failures.push(`${feed.title}: bir belge okunamadı`) }
        }
      } catch (error) { failures.push(`${feed.title}: ${error instanceof Error ? error.message : 'Erişim hatası'}`) }
    }
    const documents = await prisma.sourceScanDocument.findMany({ where: { runId }, orderBy: { title: 'asc' } })
    if (failures.length && !documents.length) throw new Error(failures.join('; ').slice(0, 500))
    const reportHtml = await renderSourceReport({
      sourceName: run.source.name ?? run.source.key,
      sourceType: run.source.authorityType,
      sourceUrl: run.source.baseUrl,
      targetDate,
      documents,
      failures,
    })
    await prisma.sourceScanRun.update({ where: { id: runId }, data: { reportHtml, status: failures.length ? 'PARTIAL' : 'COMPLETED', errorSummary: failures.length ? failures.join('; ').slice(0, 500) : null, completedAt: new Date() } })
  } catch (error) {
    await prisma.sourceScanRun.update({ where: { id: runId }, data: { status: 'FAILED', errorSummary: error instanceof Error ? error.message.slice(0, 500) : 'Kaynak taranamadı.', completedAt: new Date() } })
  }
}

export async function renderSourceReport(input: { sourceName: string; sourceType: string; sourceUrl: string; targetDate: string; documents: Array<{ title: string; url: string; contentText: string | null }>; failures: string[] }): Promise<string | null> {
  if (!input.documents.length) return null

  const identity = createHash('sha256').update(`${input.sourceName}:${input.targetDate}`).digest('hex')
  const topicId = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-4${identity.slice(13, 16)}-8${identity.slice(17, 20)}-${identity.slice(20, 32)}`
  const reportSuffix = String((Number.parseInt(identity.slice(0, 2), 16) % 90) + 10)
  const common = {
    schemaVersion: 1 as const,
    templateFamily: 'bulten-v2' as const,
    reportId: `${input.targetDate.replaceAll('-', '').slice(2)}-${reportSuffix}`,
    topicId,
    documentTitle: `ATEZ Mevzuat Radarı Günlük Raporu — ${input.sourceName}`,
    issueNumber: `${input.sourceName} · ${formatTurkishDate(input.targetDate)}`,
    displayDate: formatTurkishDate(input.targetDate),
    typeLabel: input.sourceType === 'OFFICIAL' ? 'Mevzuat Değişikliği' : 'Kaynak Güncellemesi',
    affectedParties: [] as string[],
    dates: [`Yayımlanma tarihi: ${formatTurkishDate(input.targetDate)}`],
    note: input.failures.length ? `Tarama kısmen tamamlandı: ${input.failures.join('; ').slice(0, 400)}` : null,
    source: { label: input.sourceName, url: input.documents.length === 1 ? input.documents[0]!.url : input.sourceUrl },
  }

  const spec: ReportSpec = input.documents.length === 1 ? {
    ...common,
    card: 'K1',
    title: input.documents[0]!.title,
    summary: summarizeSourceDocument(input.documents[0]!),
    blocks: ['B1', 'B2', 'B3', 'B4', 'B6', 'B8'],
  } : {
    ...common,
    card: 'K2',
    title: `${input.sourceName} günlük mevzuat değişiklikleri`,
    summary: `${formatTurkishDate(input.targetDate)} tarihinde ${input.sourceName} kaynağında ${input.documents.length} yeni mevzuat kaydı tespit edildi.`,
    table: {
      title: 'Tespit edilen düzenlemeler',
      columns: ['Düzenleme', 'Yayımlanma tarihi'],
      rows: input.documents.map((document) => [document.title, formatTurkishDate(input.targetDate)]),
      note: 'Belge bağlantıları tarama ayrıntısındaki bulunan kayıtlar bölümünde yer alır.',
    },
    blocks: ['B1', 'B2', 'B3', 'B4', 'B6', 'B9', 'B8'],
  }
  return renderReportHtml(spec)
}

function summarizeSourceDocument(document: { title: string; contentText: string | null }): string {
  const text = document.contentText?.replace(/\s+/g, ' ').trim()
  if (!text) return `${document.title} başlıklı mevzuat kaydı ilgili kaynakta yayımlandı. Ayrıntılar için kaynak bağlantısını açın.`
  return text.slice(0, 900)
}

function formatTurkishDate(value: string): string {
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}
