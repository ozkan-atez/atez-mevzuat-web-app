import type { PrismaClient } from '@prisma/client'
import { reportAccessWhere } from '../../../platform/actor-context'
import type { ChatHistoryItem, ChatMessageView } from '../application/ports'

export async function listReportThreads(prisma: PrismaClient): Promise<ChatHistoryItem[]> {
  const reports = await prisma.topicReport.findMany({where: {AND: [reportAccessWhere()], latestVersion: {gt: 0}, OR: [
    {conversations: {some: {messages: {some: {role: 'USER'}}}}},
    {topic: {thread: {messages: {some: {kind: 'REVISION_REQUEST'}}}}},
    {topic: {drafts: {some: {edits: {some: {}}}}}},
    {drafts: {some: {edits: {some: {}}}}},
    {revisions: {some: {draft: {edits: {some: {}}}}}} ,
  ]}, orderBy: {updatedAt: 'desc'}, take: 50, include: {conversations: {select: {updatedAt: true}}, topic: {select: {thread: {select: {messages: {where: {kind: {not: 'AUTOMATED_ANALYSIS'}}, orderBy: {createdAt: 'desc'}, take: 1}}}}}}})
  return reports.map(report => ({id: `report:${report.id}`, type: 'REPORT_REVISION', title: report.title,
    preview: report.topic?.thread?.messages[0]?.content.slice(0,120) ?? null, messageCount: 0,
    updatedAt: new Date(Math.max(report.updatedAt.getTime(), ...report.conversations.map(item => item.updatedAt.getTime()), report.topic?.thread?.messages[0]?.createdAt.getTime() ?? 0)).toISOString(),
    target: `/chat?report=${encodeURIComponent(report.topicId ?? report.id)}`}))
}

export async function getReportThread(prisma: PrismaClient, key: string) {
  const report = await prisma.topicReport.findFirst({where: {AND: [reportAccessWhere(), {OR: [{id: key}, {topicId: key}]}]}, include: {
    conversations: {include: {messages: {orderBy: [{createdAt: 'asc'}, {id: 'asc'}]}}},
    topic: {include: {thread: {include: {messages: {include: {initiator: {select: {name: true, email: true}}}, orderBy: [{createdAt: 'asc'}, {id: 'asc'}]}}}, drafts: {include: {edits: true, revision: true}}}},
    drafts: {include: {edits: true, revision: true}},
    revisions: {orderBy: {version: 'desc'}, select: {version: true, createdAt: true, requestMessageId: true, createdBy: true, createdByName: true, draft: {include: {edits: true}}}},
  }})
  if (!report) return null
  const messages = new Map<string, ChatMessageView>()
  const originals = report.topic?.thread?.messages ?? []
  const automaticIds = new Set(originals.filter(item => item.kind === 'AUTOMATED_ANALYSIS').map(item => item.id))
  for (const item of originals.filter(item => item.kind !== 'AUTOMATED_ANALYSIS' && item.role !== 'SYSTEM')) {
    messages.set(item.id, {id: item.id, role: item.role === 'USER' ? 'USER' : 'ASSISTANT', content: item.content, status: 'COMPLETED', errorDetail: null,
      createdAt: item.createdAt.toISOString(), authorId: item.initiatorUserId, authorName: item.initiator?.name || item.initiator?.email || null})
  }
  for (const conversation of report.conversations) for (const item of conversation.messages) {
    if (automaticIds.has(item.id) || item.role === 'SYSTEM') continue
    messages.set(item.id, {id: item.id, role: item.role === 'USER' ? 'USER' : 'ASSISTANT', content: item.content, status: item.status === 'FAILED' ? 'FAILED' : 'COMPLETED', errorDetail: item.status === 'FAILED' ? item.content : null,
      createdAt: item.createdAt.toISOString(), authorId: item.authorId, authorName: item.authorName, baseVersion: item.baseVersion})
  }
  const drafts = [...(report.topic?.drafts ?? []), ...report.drafts, ...report.revisions.flatMap(revision => revision.draft ? [{...revision.draft, revision}] : [])]
  const edits = new Set<string>()
  for (const draft of drafts) for (const edit of draft.edits) {
    if (edits.has(edit.id)) continue
    edits.add(edit.id)
    const prompt = edit.chatMessageId ? messages.get(edit.chatMessageId) : null
    if (prompt) {
      prompt.baseVersion ??= edit.baseVersion ?? draft.baseVersion
      if (draft.revision) prompt.reportVersion = draft.revision.version
      prompt.changePaths = [...new Set([...(prompt.changePaths ?? []), edit.path])]
    } else {
      const format = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value)
      messages.set(`edit:${edit.id}`, {id: `edit:${edit.id}`, role: 'USER', status: 'COMPLETED', errorDetail: null, createdAt: edit.createdAt.toISOString(),
        content: `${edit.prompt ? `Talep: ${edit.prompt}\n` : ''}${edit.revertsEditId ? 'Değişiklik geri alındı' : 'Alan değiştirildi'}: ${edit.path}\nÖnceki: ${format(edit.previousValue)}\nYeni: ${format(edit.nextValue)}`,
        authorId: edit.actorId, authorName: edit.actorName, baseVersion: edit.baseVersion ?? draft.baseVersion,
        ...(draft.revision ? {reportVersion: draft.revision.version} : {})})
    }
  }
  for (const revision of report.revisions) if (revision.requestMessageId && messages.has(revision.requestMessageId)) messages.get(revision.requestMessageId)!.reportVersion = revision.version
  return {reportId: report.id, topicId: report.topicId ?? report.id, title: report.title, latestVersion: report.latestVersion,
    messages: [...messages.values()].sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    revisions: report.revisions.map(item => ({version: item.version, createdAt: item.createdAt.toISOString(), createdBy: item.createdBy, createdByName: item.createdByName}))}
}
