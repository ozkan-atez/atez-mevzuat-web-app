import { DateTime } from 'luxon'
import { Prisma, type PrismaClient } from '@prisma/client'
import type { PgBoss } from 'pg-boss'
import { scanSupported } from './catalog'

export const workspaceAutomationQueue = 'atez-workspace-daily-automation'
export async function validateAutomation(prisma: PrismaClient, data: { sourceIds: string[]; groupIds: string[]; templateId: string | null }) {
  const sources = await prisma.source.findMany({ where: { id: { in: data.sourceIds }, isActive: true }, include: { endpoints: true, profiles: { select: { status: true } }, credentials: { select: { id: true } } } })
  if (!sources.length || sources.length !== new Set(data.sourceIds).size || sources.some(source => !scanSupported(source))) throw new Error('Seçilen kaynağın etkin tarama bağlayıcısı veya gerekli hesap yapılandırması bulunamadı.')
  if (await prisma.customerGroup.count({ where: { id: { in: data.groupIds }, isActive: true } }) !== new Set(data.groupIds).size) throw new Error('Seçilen dağıtım gruplarından biri bulunamadı veya etkin değil.')
  if (data.templateId && !await prisma.reportTemplate.findFirst({ where: { id: data.templateId, isActive: true } })) throw new Error('Rapor şablonu bulunamadı veya etkin değil.')
}
export async function runAutomation(prisma: PrismaClient, id: string, requestKey?: string, scheduledAt?: string, expectedVersion?: number) {
  const automation = await prisma.workspaceAutomation.findUniqueOrThrow({ where: { id } })
  await validateAutomation(prisma, automation)
  const now = (scheduledAt ? DateTime.fromISO(scheduledAt) : DateTime.now()).setZone(automation.timezone)
  if (!now.isValid) throw new Error('Geçersiz çalışma zamanı.')
  const targetDate = now.toFormat('yyyy-MM-dd')
  const key = requestKey ? `automation:${id}:manual:${requestKey}` : `automation:${id}:${now.toUTC().startOf('minute').toISO()}`
  const sourceKeys = (await prisma.source.findMany({ where: { id: { in: automation.sourceIds } }, select: { key: true } })).map(source => source.key)
  const template = automation.templateId ? await prisma.reportTemplate.findUnique({ where: { id: automation.templateId } }) : null
  const result = await prisma.$transaction(async tx => {
    if (expectedVersion !== undefined) {
      // The update locks the configuration until run + outbox creation commits.
      const claim = await tx.workspaceAutomation.updateMany({ where: { id, isActive: true, scheduleVersion: expectedVersion }, data: { lastError: null } })
      if (!claim.count) throw new AutomationSupersededError()
    }
    const existing = await tx.scanRun.findUnique({ where: { requestKey: key } })
    if (existing) return existing
    const run = await tx.scanRun.create({ data: {
      ...jobInitiatorFields(),
      requestKey: key, sourceKeys, automationId: id, trigger: requestKey ? 'MANUAL' : 'CRON', timezone: automation.timezone,
      targetDate: new Date(`${targetDate}T00:00:00Z`),
      workspaceConfig: { automationName: automation.name, datePolicy: automation.datePolicy, sourceIds: automation.sourceIds, groupIds: automation.groupIds, templateId: automation.templateId, template: template ? { html: template.html, sections: template.sections } : null, deliveryMode: 'MANUAL_APPROVAL' } as Prisma.InputJsonValue,
      outbox: { create: { requestKey: key, ...jobInitiatorFields() } },
    } })
    await tx.workspaceAutomation.update({ where: { id }, data: { lastRunId: run.id, lastRunAt: new Date(), lastError: null } })
    return run
  }).catch(async error => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.scanRun.findUnique({ where: { requestKey: key } })
      if (existing) return existing
    }
    throw error
  })
  return { id: result.id, runId: result.id, status: result.status, targetDate }
}
export function automationTimes(automation: { times?: string[]; hour: number; minute: number }) {
  return automation.times?.length ? automation.times : [`${String(automation.hour).padStart(2, '0')}:${String(automation.minute).padStart(2, '0')}`]
}
export function automationSlots(automation: { id: string; times?: string[]; hour: number; minute: number; weekdays?: number[] }) {
  const days = automation.weekdays?.length ? automation.weekdays : [1,2,3,4,5,6,7]
  const dayExpression = days.length === 7 ? '*' : days.map(day => day % 7).sort().join(',')
  return automationTimes(automation).map(time => {
    const [hour, minute] = time.split(':').map(Number)
    return { key: automation.times?.length ? `${automation.id}/${time.replace(':', '')}` : automation.id, cron: `${minute} ${hour} * * ${dayExpression}` }
  })
}
export async function reconcileAutomationSchedules(prisma: PrismaClient, queue: PgBoss) {
  const automations = await prisma.workspaceAutomation.findMany()
  const active = automations.filter(a => a.isActive)
  const existing = (await queue.getSchedules()).filter(s => s.name === workspaceAutomationQueue)
  const desiredKeys = new Set(active.flatMap(a => automationSlots(a).map(slot => slot.key)))
  for (const schedule of existing) if (!desiredKeys.has(schedule.key ?? '')) await queue.unschedule(workspaceAutomationQueue, schedule.key ?? '')
  for (const automation of active) {
    try {
      await validateAutomation(prisma, automation)
      for (const slot of automationSlots(automation)) await queue.schedule(workspaceAutomationQueue, slot.cron, {
        automationId: automation.id,
        ...(automation.scheduleVersion ? { version: automation.scheduleVersion } : {}),
      }, { tz: automation.timezone, key: slot.key })
    } catch (error) {
      for (const slot of automationSlots(automation)) await queue.unschedule(workspaceAutomationQueue, slot.key)
      await prisma.workspaceAutomation.update({ where: { id: automation.id }, data: { lastError: error instanceof Error ? error.message : 'Zamanlama kurulamadı.' } })
    }
  }
}

class AutomationSupersededError extends Error {}
export async function executeAutomationCommand(prisma: PrismaClient, input: { automationId: string; scheduledAt: string; version?: number }) {
  const automation = await prisma.workspaceAutomation.findUnique({ where: { id: input.automationId } })
  if (!automation?.isActive || (input.version !== undefined && automation.scheduleVersion !== input.version)) return
  try {
    await runAutomation(prisma, automation.id, undefined, input.scheduledAt, input.version ?? automation.scheduleVersion)
  } catch (error) {
    if (error instanceof AutomationSupersededError) return
    await prisma.workspaceAutomation.updateMany({ where: { id: automation.id, scheduleVersion: automation.scheduleVersion }, data: { lastError: error instanceof Error ? error.message : 'Tarama oluşturulamadı.' } })
    throw error
  }
}
import { jobInitiatorFields } from '../../platform/actor-context'
