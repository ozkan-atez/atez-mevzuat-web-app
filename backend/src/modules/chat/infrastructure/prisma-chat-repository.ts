import type { PrismaClient } from '@prisma/client'
import {
  ChatSessionNotFoundError,
  type ChatAttachmentInput,
  type AppendChatMessageInput,
  type ChatHistoryItem,
  type ChatMessageView,
  type ChatRepository,
  type ChatSessionView,
} from '../application/ports'
import { randomUUID } from 'node:crypto'

const PREVIEW_LENGTH = 120

export class PrismaChatRepository implements ChatRepository {
  constructor(private readonly prisma: PrismaClient, private readonly objectStore?: {
    putRunFile(key: string, body: Buffer, mediaType: string): Promise<unknown>
    getContent(key: string): Promise<Buffer>
    deleteRunFile?(key: string): Promise<void>
  }) {}

  async createSession(): Promise<ChatSessionView> {
    const session = await this.prisma.chatSession.create({ data: {} })
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    }
  }

  async sessionExists(id: string): Promise<boolean> {
    return (await this.prisma.chatSession.count({ where: { id } })) === 1
  }

  async getMessages(sessionId: string): Promise<ChatMessageView[]> {
    const messages = await this.prisma.generalChatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      include: { attachment: true },
    })
    return messages.map(toMessageView)
  }

  async getSessionTitle(sessionId: string): Promise<string | null> {
    return (await this.prisma.chatSession.findUnique({ where: { id: sessionId }, select: { title: true } }))?.title ?? null
  }

  async setTitleIfMatches(sessionId: string, expectedTitle: string | null, title: string): Promise<void> {
    // A title change is presentation metadata, not new conversation activity.
    // Prisma's @updatedAt would move old chats to the top of the history list.
    await this.prisma.$executeRaw`UPDATE "ChatSession" SET "title" = ${title} WHERE "id" = ${sessionId} AND "title" IS NOT DISTINCT FROM ${expectedTitle}`
  }

  /**
   * Writes the message and the session's activity together: the history list is
   * ordered by the session, so a message that landed without moving its session
   * would leave the conversation buried where the user cannot find it.
   */
  async appendMessage(input: AppendChatMessageInput): Promise<ChatMessageView> {
    if (input.attachment && !this.objectStore) throw new Error('Sohbet dosya deposu yapılandırılmamış.')
    const objectKey = input.attachment ? `chat-attachments/${input.sessionId}/${randomUUID()}` : null
    if (objectKey && input.attachment) await this.objectStore!.putRunFile(objectKey, input.attachment.bytes, input.attachment.mediaType)
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.chatSession.findUnique({ where: { id: input.sessionId } })
      if (!session) throw new ChatSessionNotFoundError('Sohbet bulunamadı.')
      const message = await tx.generalChatMessage.create({
        data: {
          sessionId: input.sessionId,
          role: input.role,
          content: input.content,
          status: input.status,
          errorDetail: input.errorDetail ?? null,
          ...(objectKey && input.attachment ? { attachment: { create: {
            name: input.attachment.name, mediaType: input.attachment.mediaType,
            byteSize: input.attachment.bytes.length, objectKey,
          } } } : {}),
        },
        include: { attachment: true },
      })
      await tx.chatSession.update({
        where: { id: input.sessionId },
        data: { updatedAt: new Date() },
      })
      return toMessageView(message)
    })
  }

  async getAttachment(sessionId: string, attachmentId: string): Promise<(ChatAttachmentInput & { id: string }) | null> {
    const attachment = await this.prisma.generalChatAttachment.findFirst({
      where: { id: attachmentId, message: { sessionId } },
    })
    if (!attachment || !this.objectStore) return null
    return {
      id: attachment.id, name: attachment.name, mediaType: attachment.mediaType,
      bytes: await this.objectStore.getContent(attachment.objectKey),
    }
  }

  async listHistory(): Promise<ChatHistoryItem[]> {
    const [sessions, threads, firstUserMessages] = await Promise.all([
      this.prisma.chatSession.findMany({
        include: {
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.analysisThread.findMany({
        include: {
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { messages: true } },
          topic: { select: { id: true, document: { select: { title: true } }, scanRun: { select: { id: true, targetDate: true, status: true } } } },
        },
      }),
      this.prisma.generalChatMessage.findMany({
        where: { role: 'USER' }, orderBy: { createdAt: 'asc' }, distinct: ['sessionId'],
        select: { sessionId: true, content: true },
      }),
    ])

    const firstUserBySession = new Map(firstUserMessages.map((message) => [message.sessionId, message.content]))

    const general: ChatHistoryItem[] = sessions.map((session) => ({
      id: session.id,
      type: 'GENERAL',
      title: session.title ?? 'Yeni sohbet',
      titlePending: session.title === null || session.title === firstLine(firstUserBySession.get(session.id) ?? '', 72),
      preview: session.messages[0] ? firstLine(session.messages[0].content, PREVIEW_LENGTH) : null,
      messageCount: session._count.messages,
      updatedAt: session.updatedAt.toISOString(),
      target: `/chat/${session.id}`,
    }))

    const revisions: ChatHistoryItem[] = threads.map((thread) => ({
      id: thread.id,
      type: 'REPORT_REVISION',
      title: thread.title ?? thread.topic.document.title,
      preview: thread.messages[0] ? firstLine(thread.messages[0].content, PREVIEW_LENGTH) : null,
      messageCount: thread._count.messages,
      updatedAt: thread.updatedAt.toISOString(),
      target: `/reports/${thread.topic.id}`,
      run: { id: thread.topic.scanRun.id, targetDate: thread.topic.scanRun.targetDate.toISOString(), status: thread.topic.scanRun.status },
    }))

    return [...general, ...revisions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * Scoped to general sessions on purpose: a revision thread is part of a report's
   * audit trail, and passing its id here must delete nothing.
   */
  async deleteSession(id: string): Promise<boolean> {
    const attachments = await this.prisma.generalChatAttachment.findMany({ where: { message: { sessionId: id } }, select: { objectKey: true } })
    const deleted = (await this.prisma.chatSession.deleteMany({ where: { id } })).count === 1
    if (deleted && this.objectStore?.deleteRunFile) {
      await Promise.allSettled(attachments.map((attachment) => this.objectStore!.deleteRunFile!(attachment.objectKey)))
    }
    return deleted
  }
}

function toMessageView(message: {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  status: 'COMPLETED' | 'FAILED'
  errorDetail: string | null
  createdAt: Date
  attachment?: { id: string; name: string; mediaType: string; byteSize: number } | null
}): ChatMessageView {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status,
    errorDetail: message.errorDetail,
    createdAt: message.createdAt.toISOString(),
    ...(message.attachment ? { attachment: {
      id: message.attachment.id, name: message.attachment.name,
      mediaType: message.attachment.mediaType, byteSize: message.attachment.byteSize,
    } } : {}),
  }
}

function firstLine(content: string, limit: number): string {
  const text = content.trim().split('\n', 1)[0]?.trim() ?? ''
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}
