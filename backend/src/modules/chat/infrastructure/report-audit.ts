import type { Prisma } from '@prisma/client'
import { getActorContext, reportAccessWhere } from '../../../platform/actor-context'

export async function reportActor(tx: Prisma.TransactionClient) {
  const id = getActorContext()?.userId
  if (!id || getActorContext()?.serviceActor) return {id: null, name: null}
  const user = await tx.user.findUnique({where: {id}, select: {name: true, email: true}})
  return {id, name: user?.name || user?.email || null}
}

export async function recordReportMessage(tx: Prisma.TransactionClient, topicId: string, message: {id: string; role: string; content: string; createdAt: Date}) {
  if (message.role === 'SYSTEM') return
  const report = await tx.topicReport.findFirst({where: {AND:[reportAccessWhere()],OR: [{topicId}, {id: topicId, topicId: null}]}})
  if (!report) return
  await tx.topicReport.update({where: {id: report.id}, data: {updatedAt: new Date()}})
  const actor = await reportActor(tx)
  const conversationId = `report:${report.id}`
  await tx.reportConversation.upsert({where: {id: conversationId}, create: {id: conversationId, reportId: report.id, title: report.title, createdBy: actor.id, createdByName: actor.name}, update: {updatedAt: new Date()}})
  await tx.reportConversationMessage.upsert({where: {id: message.id}, create: {id: message.id, conversationId, role: message.role, content: message.content, authorId: message.role === 'USER' ? actor.id : null, authorName: message.role === 'USER' ? actor.name : null, baseVersion: report.latestVersion, createdAt: message.createdAt}, update: {}})
}
