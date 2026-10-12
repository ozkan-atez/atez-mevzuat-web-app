import type { WebResearch } from '../application/web-grounding'
import { getActorContext, privateActorScope, resourceOwnership, chatAccessWhere } from '../../../platform/actor-context'
import { Prisma, type PrismaClient } from '@prisma/client'
import {
  ChatSessionNotFoundError,
  type AppendChatMessageInput,
  type ChatHistoryItem,
  type ChatMessageView,
  type ChatRepository,
  type ChatSessionView,
} from '../application/ports'

const TITLE_LENGTH = 72
const PREVIEW_LENGTH = 120

export class PrismaChatRepository implements ChatRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createSession(): Promise<ChatSessionView> {
    const session = await this.prisma.chatSession.create({ data: {...(getActorContext()?{workspaceId:getActorContext()!.workspaceId,ownerId:getActorContext()!.userId,visibility:'PRIVATE'}:{})} })
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    }
  }

  async sessionExists(id: string): Promise<boolean> {
    return (await this.prisma.chatSession.count({ where: { id, ...chatAccessWhere() } })) === 1
  }

  async getMessages(sessionId: string): Promise<ChatMessageView[]> {
    const messages = await this.prisma.generalChatMessage.findMany({
      where: { sessionId, session:chatAccessWhere() },
      orderBy: { createdAt: 'asc' },
    })
    return messages.map(toMessageView)
  }

  /**
   * Writes the message and the session's activity together: the history list is
   * ordered by the session, so a message that landed without moving its session
   * would leave the conversation buried where the user cannot find it.
   */
  async appendMessage(input: AppendChatMessageInput): Promise<ChatMessageView> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.chatSession.findFirst({ where: { id: input.sessionId,...chatAccessWhere() } })
      if (!session) throw new ChatSessionNotFoundError('Sohbet bulunamadı.')
      const message = await tx.generalChatMessage.create({
        data: {
          ...(input.research ? {research:input.research as unknown as Prisma.InputJsonValue} : {}),
          sessionId: input.sessionId,
          role: input.role,
          content: input.content,
          status: input.status,
          errorDetail: input.errorDetail ?? null,
          documentVersionIds: input.documentVersionIds ?? [],
          operationRequestIds: input.operationRequestIds ?? [],
        },
      })
      if (input.documentVersionIds?.length) {
        await tx.documentLink.createMany({ data: [...new Set(input.documentVersionIds)].map(documentVersionId => ({
          ...resourceOwnership(),actorScope:privateActorScope(), documentVersionId, sessionId: input.sessionId, messageId: message.id, role: 'ATTACHMENT',
        })) })
      }
      // The first thing the user said names the conversation; later messages never
      // rename it, so the list stays stable as the user reads it.
      const title = session.title ?? (input.role === 'USER' ? firstLine(input.content, TITLE_LENGTH) : null)
      await tx.chatSession.update({
        where: { id: input.sessionId,...chatAccessWhere() },
        data: { updatedAt: new Date(), ...(title && !session.title ? { title } : {}) },
      })
      return toMessageView(message)
    })
  }

  async listHistory(): Promise<ChatHistoryItem[]> {
    // Report threads are internal audit records, not user-created conversations.
    const sessions = await this.prisma.chatSession.findMany({
      where:chatAccessWhere(),
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 }, _count: { select: { messages: true } } },
    })

    const general: ChatHistoryItem[] = sessions.map((session) => ({
      id: session.id,
      type: 'GENERAL',
      title: session.title ?? 'Yeni sohbet',
      preview: session.messages[0] ? firstLine(session.messages[0].content, PREVIEW_LENGTH) : null,
      messageCount: session._count.messages,
      updatedAt: session.updatedAt.toISOString(),
      target: `/chat/${session.id}`,
    }))

    return general

  }

  /**
   * Scoped to general sessions on purpose: a revision thread is part of a report's
   * audit trail, and passing its id here must delete nothing.
   */
  async deleteSession(id: string): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      const deleted = await tx.chatSession.deleteMany({ where: { id, ...chatAccessWhere() } })
      if (deleted.count) await tx.documentLink.deleteMany({ where: { actorScope:privateActorScope(), sessionId: id } })
      return deleted.count === 1
    })
  }
}

function toMessageView(message: {
  research?: Prisma.JsonValue | null
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  status: 'COMPLETED' | 'FAILED'
  errorDetail: string | null
  createdAt: Date
  documentVersionIds?: string[]
  operationRequestIds?: string[]
}): ChatMessageView {
  return {
    ...(message.research ? {research:message.research as unknown as WebResearch} : {}),
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status,
    errorDetail: message.errorDetail,
    createdAt: message.createdAt.toISOString(),
    documentVersionIds: message.documentVersionIds ?? [],
    operationRequestIds: message.operationRequestIds ?? [],
  }
}

function firstLine(content: string, limit: number): string {
  const text = content.trim().split('\n', 1)[0]?.trim() ?? ''
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}
