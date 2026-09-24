import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import type { AiModelClient } from '../ai/application/ai-model-client'

const DuplicateGroupsSchema = z.object({
  groups: z.array(z.object({
    reportIds: z.array(z.string()).min(2),
    reason: z.string().trim().min(1).max(240),
  }).strict()).max(20),
}).strict()

export interface ReportDuplicateGroup { reportIds: string[]; reason: string }

export async function checkReportDuplicates(prisma: PrismaClient, runId: string, aiModel: AiModelClient, model: string): Promise<void> {
  const run = await prisma.scanRun.findUnique({
    where: { id: runId },
    include: {
      topicReports: { where: { card: { not: 'K6' } }, include: { topic: { include: { document: { select: { title: true, sourceUrl: true } } } } } },
      sourceRuns: { include: { source: { select: { name: true, key: true } }, documents: { select: { title: true, url: true, contentText: true } } } },
    },
  })
  if (!run) throw new Error(`Tarama bulunamadı: ${runId}`)
  const candidates = [
    ...run.topicReports.map((report) => ({
      id: `report:${report.id}`,
      source: 'Resmî Gazete',
      title: report.title,
      details: `${report.topic?.document.title ?? report.title}\n${report.topic?.document.sourceUrl ?? ''}`,
    })),
    ...run.sourceRuns.filter((sourceRun) => sourceRun.documents.length > 0 && Boolean(sourceRun.reportHtml)).map((sourceRun) => ({
      id: `source:${sourceRun.id}`,
      source: sourceRun.source.name ?? sourceRun.source.key,
      title: `${sourceRun.source.name ?? sourceRun.source.key} kaynak raporu`,
      details: sourceRun.documents.map((document) => `${document.title}\n${document.url}\n${(document.contentText ?? '').replace(/\s+/g, ' ').slice(0, 700)}`).join('\n\n').slice(0, 8_000),
    })),
  ]
  if (candidates.length < 2) {
    await saveResult(prisma, runId, [])
    return
  }

  await prisma.scanRun.update({ where: { id: runId }, data: { reportDuplicateStatus: 'RUNNING', reportDuplicateError: null } })
  try {
    const result = await aiModel.generateStructured({
      model,
      systemInstruction: [
        'ATEZ mevzuat raporları arasındaki gerçek tekrarları belirle.',
        'Yalnızca aynı hukuki düzenlemeyi, kararı, tebliği veya aynı değişiklik olayını anlatan raporları eşleştir.',
        'Başlıkların benzer olması tek başına yeterli değildir.',
        'Resmî Gazete metninin başka bir sitede özeti, yorumu veya yeniden sunumu aynı düzenlemenin tekrarıdır.',
        'Farklı düzenlemeleri ve yalnızca aynı konuyu paylaşan raporları eşleştirme.',
        'Her rapor kimliğini yalnızca verilen listeden aynen kullan. Tekrar yoksa groups boş dizi olsun.',
      ].join('\n'),
      parts: [{ text: JSON.stringify({ reports: candidates }) }],
      responseJsonSchema: {
        type: 'object', additionalProperties: false, required: ['groups'],
        properties: { groups: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['reportIds', 'reason'], properties: { reportIds: { type: 'array', minItems: 2, items: { type: 'string' } }, reason: { type: 'string', maxLength: 240 } } } } },
      },
    })
    const parsed = DuplicateGroupsSchema.parse(result.json)
    const allowed = new Set(candidates.map((candidate) => candidate.id))
    const groups = parsed.groups.flatMap((group) => {
      const reportIds = [...new Set(group.reportIds)].filter((id) => allowed.has(id))
      return reportIds.length >= 2 ? [{ reportIds, reason: group.reason }] : []
    })
    await saveResult(prisma, runId, groups)
  } catch (error) {
    await prisma.scanRun.update({ where: { id: runId }, data: { reportDuplicateStatus: 'FAILED', reportDuplicateGroups: Prisma.JsonNull, reportDuplicateError: error instanceof Error ? error.message.slice(0, 500) : 'Mükerrer rapor kontrolü tamamlanamadı.' } })
  }
}

async function saveResult(prisma: PrismaClient, runId: string, groups: ReportDuplicateGroup[]) {
  await prisma.scanRun.update({ where: { id: runId }, data: { reportDuplicateStatus: 'COMPLETED', reportDuplicateGroups: groups as unknown as Prisma.InputJsonValue, reportDuplicateError: null } })
}
