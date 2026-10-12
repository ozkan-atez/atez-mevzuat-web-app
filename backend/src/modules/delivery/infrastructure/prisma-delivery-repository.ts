import {getActorContext,topicAccessWhere,reportAccessWhere} from '../../../platform/actor-context'
import { Prisma, type PrismaClient } from '@prisma/client'

export class CustomerGroupNotFoundError extends Error {}
export class CustomerGroupConflictError extends Error {}
export class DispatchConflictError extends Error {}

export interface CustomerGroupInput {
  name: string
  description: string | null
  emails: string[]
  isActive: boolean
}

export class PrismaDeliveryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getSuggestedGroupIds(runId: string): Promise<string[]> {
    const run = await this.prisma.scanRun.findUnique({ where: { id: runId }, select: { workspaceConfig: true } })
    const config = run?.workspaceConfig
    if (!config || typeof config !== 'object' || Array.isArray(config)) return []
    return Array.isArray(config.groupIds) ? config.groupIds.filter((value): value is string => typeof value === 'string') : []
  }

  async listCustomerGroups() {
    const groups = await this.prisma.customerGroup.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] })
    return groups.map(mapGroup)
  }

  async createCustomerGroup(input: CustomerGroupInput) {
    try {
      return mapGroup(await this.prisma.customerGroup.create({ data: input }))
    } catch (error) {
      throw toGroupError(error)
    }
  }

  async updateCustomerGroup(id: string, input: Partial<CustomerGroupInput>) {
    try {
      return mapGroup(await this.prisma.customerGroup.update({ where: { id }, data: input }))
    } catch (error) {
      throw toGroupError(error)
    }
  }

  async deleteCustomerGroup(id: string): Promise<void> {
    try {
      await this.prisma.customerGroup.delete({ where: { id } })
    } catch (error) {
      throw toGroupError(error)
    }
  }

  async resolveGroupRecipients(groupIds: string[]): Promise<string[]> {
    if (groupIds.length === 0) return []
    const groups = await this.prisma.customerGroup.findMany({
      where: { id: { in: groupIds }, isActive: true },
      select: { emails: true },
    })
    return groups.flatMap((group) => group.emails)
  }

  async listTopicDispatches(topicId: string) {
    const dispatches = await this.prisma.emailDispatch.findMany({
      where: { topicId,...(getActorContext()?{topic:{reports:{some:reportAccessWhere()}}}:{}) },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    return dispatches.map((dispatch) => ({
      id: dispatch.id,
      reportVersion: dispatch.reportVersion,
      recipients: dispatch.recipients,
      subject: dispatch.subject,
      status: dispatch.status,
      errorMessage: dispatch.errorMessage,
      sentAt: dispatch.sentAt?.toISOString() ?? null,
      createdAt: dispatch.createdAt.toISOString(),
    }))
  }

  /** Claims the idempotency key so a repeated submit cannot send the same bulletin twice. */
  async startDispatch(input: {
    topicId: string
    reportVersion: number
    requestKey: string
    recipients: string[]
    groupIds: string[]
    subject: string
    bodyHtml: string
    attachmentName: string | null
  }): Promise<{ id: string }> {
    if(getActorContext() && !await this.prisma.topicReport.findFirst({where:{topicId:input.topicId,...reportAccessWhere()},select:{id:true}}))throw new CustomerGroupNotFoundError('Rapor bulunamadı.')
    try {
      return await this.prisma.emailDispatch.create({ data: input, select: { id: true } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DispatchConflictError('Bu gönderim talebi zaten işlenmiş.')
      }
      throw error
    }
  }

  async completeDispatch(id: string, input: { status: 'SENT' | 'SIMULATED'; providerMessageId: string | null }): Promise<void> {
    await this.prisma.emailDispatch.update({
      where: { id },
      data: { status: input.status, providerMessageId: input.providerMessageId, sentAt: new Date(), errorMessage: null },
    })
  }

  async failDispatch(id: string, message: string): Promise<void> {
    await this.prisma.emailDispatch.update({ where: { id }, data: { status: 'FAILED', errorMessage: message } })
  }
}

function mapGroup(group: { id: string; name: string; description: string | null; emails: string[]; isActive: boolean; createdAt: Date; updatedAt: Date }) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    emails: group.emails,
    isActive: group.isActive,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  }
}

function toGroupError(error: unknown): Error {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return new CustomerGroupConflictError('Bu isimde bir müşteri grubu zaten var.')
    if (error.code === 'P2025') return new CustomerGroupNotFoundError('Müşteri grubu bulunamadı.')
  }
  return error instanceof Error ? error : new Error('Müşteri grubu işlemi başarısız oldu.')
}
