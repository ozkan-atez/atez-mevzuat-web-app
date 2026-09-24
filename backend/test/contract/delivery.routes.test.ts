import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../src/app'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
import { PrismaTopicAnalysisRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'
import { PrismaDeliveryRepository } from '../../src/modules/delivery/infrastructure/prisma-delivery-repository'
import type { MailMessage, MailSender, PdfRenderer } from '../../src/modules/delivery/application/ports'

const prisma = new PrismaClient()
const scanRepository = new PrismaScanRepository(prisma)
const topicRepository = new PrismaTopicAnalysisRepository(prisma)
const deliveryRepository = new PrismaDeliveryRepository(prisma)

const analysisJson = {
  schemaVersion: 1,
  topicId: '4f2a6c1e-1111-4222-8333-444455556666',
  status: 'PASS',
  document: { title: 'İthalat Tebliği', gazetteDate: '2026-09-11', gazetteNumber: '33367', sourceUrl: 'https://www.resmigazete.gov.tr/doc.htm' },
  change: { type: 'AMENDMENT', detailedAnalysis: 'Ayrıntı.', summary: 'Özet.', operationalImpact: 'Etki.' },
  affectedParties: [], effectiveDates: [], comparisons: [], tables: [],
  officialSources: [{ id: 's1', label: 'Tebliğ metni', url: 'https://www.resmigazete.gov.tr/doc.htm', evidenceIds: ['e1'] }],
  supportingSources: [{ id: 's2', label: 'Bakanlık duyurusu', url: 'https://ticaret.gov.tr/duyuru', evidenceIds: ['e1'] }],
  evidence: [{ id: 'e1', objectKey: 'runs/doc.htm', locator: 'p.1' }],
  unresolvedReferences: [],
  emailTitle: 'İthalat Tebliğinde Değişiklik',
  emailSummary: 'Özet gövde.',
}

const objectStore = {
  getContent: async (key: string) => Buffer.from(
    key.endsWith('.json') ? JSON.stringify(analysisJson) : '<!doctype html><p>ATEZ bülteni</p>',
  ),
}

const pdfRenderer: PdfRenderer = { renderHtml: async () => Buffer.from('%PDF-1.4 test') }

async function seedTopic() {
  const run = await prisma.scanRun.create({
    data: {
      requestKey: crypto.randomUUID(), targetDate: new Date('2026-09-11T00:00:00.000Z'), indexSourceUrl: 'https://www.resmigazete.gov.tr/11.09.2026', indexObjectKey: 'index.html', indexSha256: 'a'.repeat(64),
      editions: { create: { publicationDate: new Date('2026-09-11T00:00:00.000Z'), type: 'MAIN', indexUrl: 'https://www.resmigazete.gov.tr/11.09.2026', discoveryOrder: 0, documents: { create: { title: 'İthalat Tebliği', sourceUrl: 'https://www.resmigazete.gov.tr/doc.htm', publicationOrder: 0 } } } },
    }, include: { editions: { include: { documents: true } } },
  })
  const document = run.editions[0]!.documents[0]!
  const job = await prisma.aiJob.create({ data: { scanRunId: run.id, kind: 'DOCUMENT_FILTER', status: 'COMPLETED', model: 'gemini-3.7-flash', titlePromptVersion: 'v1', contentPromptVersion: 'v1', configurationHash: 'b'.repeat(64) } })
  await prisma.documentFilterDecision.create({ data: { aiJobId: job.id, documentId: document.id, titleDecision: 'IN', titleReason: 'İlgili', titleConfidence: 0.99, finalDecision: 'IN' } })
  const topic = (await topicRepository.ensureTopics(run.id))[0]!
  const analysis = await topicRepository.createAnalysisRevision({ topicId: topic.id, version: 1, status: 'PASS', analysisObjectKey: 'runs/analysis.json', markdownObjectKey: 'runs/analysis.md', model: 'gemini-3.7-flash', promptVersion: 'topic-analysis-v1', schemaVersion: 1, inputTokens: 10, outputTokens: 5 })
  await topicRepository.createReportRevision({ scanRunId: run.id, topicId: topic.id, analysisRevisionId: analysis.id, title: 'İthalat Tebliği', basename: `01-${topic.id}.html`, card: 'K1', version: 1, specObjectKey: 'runs/report-spec.json', htmlObjectKey: 'runs/report.html' })
  return { runId: run.id, topicId: topic.id }
}

function stubSender(configured: boolean, sent: MailMessage[] = []): MailSender {
  return {
    configured,
    send: async (message) => { sent.push(message); return { status: 'SENT', providerMessageId: 'graph-1' } },
  }
}

describe('delivery HTTP contract', () => {
  beforeEach(async () => {
    await prisma.scanRun.deleteMany()
    await prisma.customerGroup.deleteMany()
  })
  afterAll(() => prisma.$disconnect())

  it('builds the draft and source list from the analysis revision', async () => {
    const { topicId } = await seedTopic()
    const app = await buildApp({ scanRepository, topicRepository, deliveryRepository, objectStore, pdfRenderer })

    const response = await app.inject({ method: 'GET', url: `/api/v1/topics/${topicId}/reports/1/delivery` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      reportVersion: 1,
      targetDate: '2026-09-11',
      draft: { subject: '[ATEZ Mevzuat Radarı] İthalat Tebliğinde Değişiklik' },
      sender: { configured: false },
    })
    expect(response.json().sources.map((source: { url: string }) => source.url)).toEqual([
      'https://www.resmigazete.gov.tr/doc.htm',
      'https://ticaret.gov.tr/duyuru',
    ])
    await app.close()
  })

  it('renders the validated bulletin as a downloadable PDF', async () => {
    const { topicId } = await seedTopic()
    const app = await buildApp({ scanRepository, topicRepository, deliveryRepository, objectStore, pdfRenderer })

    const response = await app.inject({ method: 'GET', url: `/api/v1/topics/${topicId}/reports/1/pdf` })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/pdf')
    expect(response.headers['content-disposition']).toContain('.pdf')
    await app.close()
  })

  it('sends to manual recipients merged with the selected groups, without duplicates', async () => {
    const { topicId } = await seedTopic()
    const group = await deliveryRepository.createCustomerGroup({
      name: 'Gümrük Operasyon', description: null, emails: ['ops@atez.com', 'ortak@atez.com'], isActive: true,
    })
    const sent: MailMessage[] = []
    const app = await buildApp({ scanRepository, topicRepository, deliveryRepository, objectStore, pdfRenderer, mailSender: stubSender(true, sent) })

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/topics/${topicId}/dispatches`,
      headers: { 'idempotency-key': crypto.randomUUID() },
      payload: { reportVersion: 1, groupIds: [group.id], recipients: ['Ortak@atez.com', 'yonetim@atez.com'], subject: 'konu', bodyText: 'Gövde metni.', attachPdf: true },
    })

    expect(response.statusCode).toBe(202)
    expect(response.json().status).toBe('SENT')
    expect(sent[0]?.to).toEqual(['ortak@atez.com', 'yonetim@atez.com', 'ops@atez.com'])
    expect(sent[0]?.attachments[0]?.mediaType).toBe('application/pdf')
    expect(sent[0]?.html).toContain('Gövde metni.')
    expect(sent[0]?.html).toContain('https://ticaret.gov.tr/duyuru')
    await app.close()
  })

  it('records a simulated dispatch when Graph is not configured', async () => {
    const { topicId } = await seedTopic()
    const app = await buildApp({ scanRepository, topicRepository, deliveryRepository, objectStore, pdfRenderer, mailSender: stubSender(false) })

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/topics/${topicId}/dispatches`,
      headers: { 'idempotency-key': crypto.randomUUID() },
      payload: { reportVersion: 1, recipients: ['yonetim@atez.com'], subject: 'konu', bodyText: 'Gövde metni.', attachPdf: false },
    })

    expect(response.statusCode).toBe(202)
    expect(response.json().status).toBe('SIMULATED')
    expect(await deliveryRepository.listTopicDispatches(topicId)).toMatchObject([{ status: 'SIMULATED' }])
    await app.close()
  })

  it('refuses a repeated idempotency key so one bulletin is not mailed twice', async () => {
    const { topicId } = await seedTopic()
    const key = crypto.randomUUID()
    const sent: MailMessage[] = []
    const app = await buildApp({ scanRepository, topicRepository, deliveryRepository, objectStore, pdfRenderer, mailSender: stubSender(true, sent) })
    const payload = { reportVersion: 1, recipients: ['yonetim@atez.com'], subject: 'konu', bodyText: 'Gövde metni.', attachPdf: false }

    const first = await app.inject({ method: 'POST', url: `/api/v1/topics/${topicId}/dispatches`, headers: { 'idempotency-key': key }, payload })
    const second = await app.inject({ method: 'POST', url: `/api/v1/topics/${topicId}/dispatches`, headers: { 'idempotency-key': key }, payload })

    expect(first.statusCode).toBe(202)
    expect(second.statusCode).toBe(409)
    expect(sent).toHaveLength(1)
    await app.close()
  })

  it('rejects a dispatch without any recipient', async () => {
    const { topicId } = await seedTopic()
    const app = await buildApp({ scanRepository, topicRepository, deliveryRepository, objectStore, pdfRenderer, mailSender: stubSender(true) })

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/topics/${topicId}/dispatches`,
      headers: { 'idempotency-key': crypto.randomUUID() },
      payload: { reportVersion: 1, recipients: [], groupIds: [], subject: 'konu', bodyText: 'Gövde metni.', attachPdf: false },
    })

    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('marks the dispatch failed when the provider rejects it', async () => {
    const { topicId } = await seedTopic()
    const failing: MailSender = { configured: true, send: vi.fn().mockRejectedValue(new Error('boom')) }
    const app = await buildApp({ scanRepository, topicRepository, deliveryRepository, objectStore, pdfRenderer, mailSender: failing })

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/topics/${topicId}/dispatches`,
      headers: { 'idempotency-key': crypto.randomUUID() },
      payload: { reportVersion: 1, recipients: ['yonetim@atez.com'], subject: 'konu', bodyText: 'Gövde metni.', attachPdf: false },
    })

    expect(response.statusCode).toBe(502)
    expect(await deliveryRepository.listTopicDispatches(topicId)).toMatchObject([{ status: 'FAILED' }])
    await app.close()
  })

  it('manages customer groups over the CRUD contract', async () => {
    const app = await buildApp({ scanRepository, topicRepository, deliveryRepository })

    const created = await app.inject({ method: 'POST', url: '/api/v1/customer-groups', payload: { name: 'Yönetim', emails: ['Yonetim@atez.com'] } })
    expect(created.statusCode).toBe(201)
    expect(created.json().emails).toEqual(['yonetim@atez.com'])

    const duplicate = await app.inject({ method: 'POST', url: '/api/v1/customer-groups', payload: { name: 'Yönetim', emails: ['baska@atez.com'] } })
    expect(duplicate.statusCode).toBe(409)

    const patched = await app.inject({ method: 'PATCH', url: `/api/v1/customer-groups/${created.json().id}`, payload: { isActive: false } })
    expect(patched.json()).toMatchObject({ isActive: false })

    const removed = await app.inject({ method: 'DELETE', url: `/api/v1/customer-groups/${created.json().id}` })
    expect(removed.statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/v1/customer-groups' })).json()).toEqual({ groups: [] })
    await app.close()
  })
})
