import { Prisma, type PrismaClient } from '@prisma/client'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { getActorContext, hasPermission } from '../../platform/actor-context'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => DateTime.fromISO(value, {zone: 'Europe/Istanbul'}).isValid)
export const usageQuerySchema = z.object({
  recordedOnly: z.enum(['true','false']).optional(),
  from: date.optional(), to: date.optional(), userId: z.string().max(200).optional(),
  type: z.enum(['GENERAL', 'REPORT', 'AUTOMATION', 'OPERATION', 'TEMPLATE', 'RESEARCH']).optional(), query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  conversationId: z.string().max(200).optional(),
}).refine(value => !value.from || !value.to || value.from <= value.to, 'Başlangıç tarihi bitiş tarihinden sonra olamaz.')
export type UsageQuery = z.infer<typeof usageQuerySchema>
export function usagePeriod(query: UsageQuery) {
  const now = DateTime.now().setZone('Europe/Istanbul')
  const from = query.from ?? now.startOf('month').toISODate()!
  const to = query.to ?? now.toISODate()!
  return {from, to, start: DateTime.fromISO(from, {zone: 'Europe/Istanbul'}).startOf('day').toJSDate(), end: DateTime.fromISO(to, {zone: 'Europe/Istanbul'}).plus({days: 1}).startOf('day').toJSDate()}
}

/** Legacy revision calls are read from their original ledger; never copied or summed twice. */
export function usageEvents(query: UsageQuery): Prisma.Sql {
  const actor = getActorContext()
  const team = !actor || hasPermission(actor, 'admin.manage')
  const workspace = actor?.workspaceId ?? null
  const user = actor?.userId ?? null
  const period = usagePeriod(query)
  return Prisma.sql`WITH raw_events AS (
    SELECT e."id", e."workspaceId", e."actorUserId", e."conversationId", e."conversationType", e."messageId",
      e."provider", e."model", e."mode", e."status", e."inputTokens", e."outputTokens", e."totalTokens", e."cachedTokens", e."reasoningTokens", e."startedAt", e."completedAt"
    FROM "ChatUsageEvent" e
    WHERE e."workspaceId" IS NOT DISTINCT FROM ${workspace} AND (${team} OR e."actorUserId" = ${user})
    UNION ALL
    SELECT 'legacy:' || e."id", r."workspaceId", m."initiatorUserId", r."id", 'REPORT', e."requestMessageId",
      'gemini', e."model", 'REVISION', e."status"::text, e."inputTokens", e."outputTokens", e."totalTokens", e."cachedTokens", e."reasoningTokens", e."startedAt", e."completedAt"
    FROM "TopicAiExecution" e JOIN "TopicReport" r ON r."topicId" = e."topicId"
      JOIN "ChatMessage" m ON m."id" = e."requestMessageId"
    WHERE e."requestMessageId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ChatUsageEvent" tracked WHERE tracked."messageId" = e."requestMessageId") AND r."workspaceId" IS NOT DISTINCT FROM ${workspace}
      AND (${team} OR m."initiatorUserId" = ${user})
    UNION ALL
    SELECT 'unmeasured:' || m."id", s."workspaceId", s."ownerId", s."id", 'GENERAL', m."id",
      NULL, NULL, 'CHAT', 'UNMEASURED', NULL::integer, NULL::integer, NULL::integer, NULL::integer, NULL::integer, m."createdAt", NULL::timestamp
    FROM "GeneralChatMessage" m JOIN "ChatSession" s ON s."id" = m."sessionId"
    WHERE m."role" = 'USER' AND s."workspaceId" IS NOT DISTINCT FROM ${workspace}
      AND (${team} OR s."ownerId" = ${user})
      AND NOT EXISTS (SELECT 1 FROM "ChatUsageEvent" e WHERE e."messageId" = m."id")
    UNION ALL
    SELECT 'unmeasured-report:' || m."id", r."workspaceId", m."authorId", r."id", 'REPORT', m."id",
      NULL, NULL, 'REVISION', 'UNMEASURED', NULL::integer, NULL::integer, NULL::integer, NULL::integer, NULL::integer, m."createdAt", NULL::timestamp
    FROM "ReportConversationMessage" m JOIN "ReportConversation" c ON c."id" = m."conversationId" JOIN "TopicReport" r ON r."id" = c."reportId"
    WHERE m."role" = 'USER' AND r."workspaceId" IS NOT DISTINCT FROM ${workspace}
      AND (${team} OR m."authorId" = ${user})
      AND NOT EXISTS (SELECT 1 FROM "ChatUsageEvent" e WHERE e."messageId" = m."id")
      AND NOT EXISTS (SELECT 1 FROM "TopicAiExecution" e WHERE e."requestMessageId" = m."id")
  ), visible_events AS (
    SELECT e.*, u."name" AS "userName", u."email" AS "userEmail",
      CASE WHEN e."conversationType" NOT IN ('GENERAL','REPORT') THEN COALESCE(meta."usageLabel", 'AI işlemi')
      WHEN e."conversationType" = 'GENERAL' THEN
        CASE WHEN s."id" IS NULL THEN 'Silinmiş sohbet' WHEN ${user}::text IS NULL OR s."ownerId" = ${user} THEN COALESCE(s."title", 'Yeni sohbet') ELSE 'Özel sohbet' END
      ELSE CASE WHEN r."id" IS NULL THEN 'Silinmiş rapor sohbeti'
        WHEN ${user}::text IS NULL OR (${hasPermission(actor, 'report.read')} AND (r."visibility" = 'WORKSPACE' OR r."ownerUserId" = ${user})) THEN r."title" ELSE 'Özel rapor sohbeti' END END AS "title",
      CASE WHEN e."conversationType" = 'GENERAL' AND s."id" IS NOT NULL AND (${user}::text IS NULL OR s."ownerId" = ${user}) THEN '/chat/' || s."id"
        WHEN e."conversationType" = 'REPORT' AND r."id" IS NOT NULL AND (${user}::text IS NULL OR (${hasPermission(actor, 'report.read')} AND (r."visibility" = 'WORKSPACE' OR r."ownerUserId" = ${user}))) THEN '/chat?report=' || COALESCE(r."topicId", r."id") ELSE NULL END AS "target"
    FROM raw_events e LEFT JOIN "ChatUsageEvent" meta ON meta."id" = e."id" LEFT JOIN "User" u ON u."id" = e."actorUserId"
      LEFT JOIN "ChatSession" s ON e."conversationType" = 'GENERAL' AND s."id" = e."conversationId" AND s."workspaceId" IS NOT DISTINCT FROM ${workspace}
      LEFT JOIN "TopicReport" r ON e."conversationType" = 'REPORT' AND r."id" = e."conversationId" AND r."workspaceId" IS NOT DISTINCT FROM ${workspace}
  ), events AS (
    SELECT * FROM visible_events e WHERE e."startedAt" >= ${period.start} AND e."startedAt" < ${period.end}
      ${query.recordedOnly === 'true' ? Prisma.sql`AND e."status" <> 'UNMEASURED' AND e."mode" <> 'NO_MODEL'` : Prisma.empty}
      ${query.userId ? Prisma.sql`AND e."actorUserId" = ${query.userId}` : Prisma.empty}
      ${query.type ? Prisma.sql`AND e."conversationType" = ${query.type}` : Prisma.empty}
      ${query.conversationId ? Prisma.sql`AND e."conversationId" = ${query.conversationId}` : Prisma.empty}
      ${query.query ? Prisma.sql`AND strpos(lower(e."title"), lower(${query.query})) > 0` : Prisma.empty}
  )`
}
const metrics = Prisma.sql`
  SUM("inputTokens")::float8 AS "inputTokens",
  SUM("outputTokens")::float8 AS "outputTokens",
  CASE WHEN COUNT(*) = 0 THEN 0 WHEN COUNT("totalTokens") + COUNT("inputTokens") + COUNT("outputTokens") + COUNT("reasoningTokens") = 0 THEN NULL ELSE SUM(COALESCE("totalTokens", COALESCE("inputTokens", 0) + COALESCE("outputTokens", 0) + COALESCE("reasoningTokens", 0)))::float8 END AS "totalTokens",
  COUNT(*) FILTER (WHERE "totalTokens" IS NULL)::int AS "unmeasuredCount",
  COUNT(*) FILTER (WHERE "mode" NOT IN ('NO_MODEL') AND "status" <> 'UNMEASURED')::int AS "callCount",
  COUNT(*) FILTER (WHERE "mode" = 'NO_MODEL')::int AS "noModelCount"`
export async function getConversationUsage(prisma: PrismaClient, query: UsageQuery): Promise<Record<string, unknown> & {page: number; pageSize: number; from: string; to: string; teamAccess: boolean}> {
  const cte = usageEvents(query)
  // A single statement gives counters and pagination the same database snapshot.
  const [result] = await prisma.$queryRaw<Array<{data: Record<string, unknown>}>>(Prisma.sql`${cte}, grouped AS (
    SELECT "conversationId", "conversationType", MAX("title") AS title, MAX("target") AS target,
      MIN("startedAt") AS "firstAt", MAX("startedAt") AS "lastAt", COUNT(DISTINCT "messageId")::int AS "messageCount",
      ARRAY_AGG(DISTINCT "model") FILTER (WHERE "model" IS NOT NULL) AS models,
      jsonb_agg(DISTINCT jsonb_build_object('id', "actorUserId", 'name', "userName", 'email', "userEmail")) AS users,
      ${metrics}
    FROM events GROUP BY "conversationId", "conversationType"
  ) SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(t) FROM (SELECT * FROM grouped ORDER BY "lastAt" DESC, "conversationId" LIMIT 20 OFFSET ${(query.page - 1) * 20}) t), '[]'::jsonb),
    'total', (SELECT COUNT(*)::int FROM grouped),
    'summary', (SELECT row_to_json(t) FROM (SELECT ${metrics}, COUNT(DISTINCT ("conversationType", "conversationId"))::int AS "conversationCount",
      SUM(COALESCE("totalTokens",CASE WHEN "inputTokens" IS NOT NULL OR "outputTokens" IS NOT NULL OR "reasoningTokens" IS NOT NULL THEN COALESCE("inputTokens",0)+COALESCE("outputTokens",0)+COALESCE("reasoningTokens",0) END)) FILTER (WHERE "conversationType"='AUTOMATION')::float8 AS "automationTokens",
      SUM(COALESCE("totalTokens",CASE WHEN "inputTokens" IS NOT NULL OR "outputTokens" IS NOT NULL OR "reasoningTokens" IS NOT NULL THEN COALESCE("inputTokens",0)+COALESCE("outputTokens",0)+COALESCE("reasoningTokens",0) END)) FILTER (WHERE "conversationType" IN ('GENERAL','REPORT'))::float8 AS "chatTokens",
      SUM(COALESCE("totalTokens",CASE WHEN "inputTokens" IS NOT NULL OR "outputTokens" IS NOT NULL OR "reasoningTokens" IS NOT NULL THEN COALESCE("inputTokens",0)+COALESCE("outputTokens",0)+COALESCE("reasoningTokens",0) END)) FILTER (WHERE "conversationType" IN ('OPERATION','TEMPLATE','RESEARCH'))::float8 AS "otherTokens"
      FROM events) t),
    'users', COALESCE((SELECT jsonb_agg(t) FROM (SELECT DISTINCT "actorUserId" AS id, "userName" AS name, "userEmail" AS email FROM visible_events WHERE "actorUserId" IS NOT NULL ORDER BY name, email) t), '[]'::jsonb)
  ) AS data`)
  const actor = getActorContext()
  const {from, to} = usagePeriod(query)
  return {...result!.data, page: query.page, pageSize: 20, from, to, teamAccess: !actor || hasPermission(actor, 'admin.manage')}
}
export async function getUsageDetails(prisma: PrismaClient, query: UsageQuery) {
  const [result] = await prisma.$queryRaw<Array<{data: Record<string, unknown>}>>(Prisma.sql`${usageEvents(query)} SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(t) FROM (SELECT * FROM events ORDER BY "startedAt" DESC, id LIMIT 50 OFFSET ${(query.page - 1) * 50}) t), '[]'::jsonb),
    'total', (SELECT COUNT(*)::int FROM events)
  ) AS data`)
  return {...result!.data, page: query.page, pageSize: 50}
}
