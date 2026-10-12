import type { Prisma, PrismaClient } from '@prisma/client'
import { DateTime } from 'luxon'
import { chatAccessWhere, getActorContext, privateActorScope, reportAccessWhere } from '../../platform/actor-context'

export type ActivityKind = 'REPORT' | 'REVISION' | 'CHAT' | 'SCAN'
export interface ActivityItem { id: string; kind: ActivityKind; title: string; detail: string; at: string; href: string; version?: number }
const reportSelect = { id: true, title: true, topicId: true, scanRunId: true, operationTaskId: true } as const
function reportHref(report: { id: string; topicId: string | null; scanRunId: string | null; operationTaskId: string | null }) {
  return report.operationTaskId ? `/reports/documents/${report.id}` : report.topicId ? `/reports/${report.topicId}` : `/runs/${report.scanRunId}/reports/${report.id}`
}
function editSummary(paths: string[]) {
  const labels = paths.map(path => /title|heading/i.test(path) ? 'Başlık' : /summary/i.test(path) ? 'Özet' : /source|reference/i.test(path) ? 'Kaynaklar' : /analysis|impact/i.test(path) ? 'Değerlendirme' : /layout|style|section/i.test(path) ? 'Rapor düzeni' : 'İçerik')
  return [...new Set(labels)].join(', ')
}

export async function getDayActivity(prisma: PrismaClient, days: 1 | 7, kind?: ActivityKind, now: DateTime = DateTime.now()) {
  const local = now.setZone('Europe/Istanbul')
  const range = { gte: local.startOf('day').minus({ days: days - 1 }).toJSDate(), lte: local.toJSDate() }
  const actor = getActorContext()
  const canReport = !actor || actor.permissions.includes('report.read')
  const canChat = !actor || actor.permissions.includes('chat.read')
  // Keep standalone reports within the same personal scope as their detail route.
  const reportWhere: Prisma.TopicReportWhereInput = { AND: [reportAccessWhere(), { OR: [{ operationTaskId: null }, { actorScope: privateActorScope() }] }] }
  const revisionWhere: Prisma.ReportRevisionWhereInput = { status: 'VALIDATED', report: reportWhere, createdAt: range }
  const chatWhere: Prisma.ChatSessionWhereInput = { ...chatAccessWhere(), updatedAt: range, messages: { some: {} } }
  const scanWhere: Prisma.ScanRunWhereInput = { ...(actor ? { workspaceId: actor.workspaceId } : {}), status: 'COMPLETED', completedAt: range, OR: [{ NOT: { requestKey: { startsWith: 'external-processing:' } } }, { workspaceConfig: { path: ['internalSourceProcessing'], equals: false } }] }
  const [revisions, chats, scans, latest, reportCount, revisionCount, chatCount, scanCount] = await Promise.all([
    canReport && (!kind || kind === 'REPORT' || kind === 'REVISION') ? prisma.reportRevision.findMany({ where: { ...revisionWhere, ...(kind ? { version: kind === 'REPORT' ? 1 : { gt: 1 } } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 101, select: { id: true, version: true, createdAt: true, report: { select: reportSelect }, draft: { select: { edits: { select: { path: true } } } } } }) : [],
    canChat && (!kind || kind === 'CHAT') ? prisma.chatSession.findMany({ where: chatWhere, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 101, select: { id: true, title: true, updatedAt: true, _count: { select: { messages: true } } } }) : [],
    !kind || kind === 'SCAN' ? prisma.scanRun.findMany({ where: scanWhere, orderBy: [{ completedAt: 'desc' }, { id: 'desc' }], take: 101, select: { id: true, completedAt: true, targetDate: true } }) : [],
    canReport ? prisma.reportRevision.findFirst({ where: { status: 'VALIDATED', report: reportWhere }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, version: true, createdAt: true, report: { select: reportSelect } } }) : null,
    canReport ? prisma.reportRevision.count({ where: { ...revisionWhere, version: 1 } }) : 0,
    canReport ? prisma.reportRevision.count({ where: { ...revisionWhere, version: { gt: 1 } } }) : 0,
    canChat ? prisma.chatSession.count({ where: chatWhere }) : 0,
    prisma.scanRun.count({ where: scanWhere }),
  ])
  const items: ActivityItem[] = [
    ...revisions.map(revision => {
      const changed = editSummary(revision.draft?.edits.map(edit => edit.path) ?? [])
      return { id: `report:${revision.id}`, kind: (revision.version === 1 ? 'REPORT' : 'REVISION') as ActivityKind, title: revision.report.title, detail: revision.version === 1 ? 'Rapor hazırlandı' : changed ? `${changed} güncellendi` : 'Yeni rapor sürümü yayımlandı', at: revision.createdAt.toISOString(), href: reportHref(revision.report), version: revision.version }
    }),
    ...chats.map(chat => ({ id: `chat:${chat.id}`, kind: 'CHAT' as const, title: chat.title ?? 'Yeni sohbet', detail: `${chat._count.messages} mesaj · Sohbete devam et`, at: chat.updatedAt.toISOString(), href: `/chat/${chat.id}` })),
    ...scans.map(scan => ({ id: `scan:${scan.id}`, kind: 'SCAN' as const, title: 'Tarama tamamlandı', detail: `${DateTime.fromJSDate(scan.targetDate, { zone: 'utc' }).toFormat('dd.MM.yyyy')} tarihli tarama · Sonuçları gör`, at: scan.completedAt!.toISOString(), href: `/runs/${scan.id}` })),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
  return { items: items.slice(0, 100), hasMore: items.length > 100, summary: { reports: reportCount, revisions: revisionCount, chats: chatCount, scans: scanCount }, latestReport: latest ? { id: latest.report.id, title: latest.report.title, version: latest.version, at: latest.createdAt.toISOString(), href: reportHref(latest.report) } : null }
}
