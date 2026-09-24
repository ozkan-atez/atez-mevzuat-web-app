import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { fetchManagedSource, normalizeManagedSourceUrl } from './fetch-managed-source'
import { recordSourceSnapshot } from './record-source-snapshot'

const inputSchema = z.object({
  url: z.string().trim().min(1).max(2_000),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1_000).nullable().default(null),
  keywords: z.string().trim().max(500).nullable().default(null),
  useInChat: z.boolean().default(true),
  useInRuns: z.boolean().default(true),
  isActive: z.boolean().default(true),
})

const summary = {
  id: true, url: true, title: true, description: true, keywords: true,
  contentText: true, contentType: true, fetchError: true, fetchedAt: true,
  useInChat: true, useInRuns: true, isActive: true, createdAt: true, updatedAt: true,
} as const

function fetchMessage(error: unknown): string {
  if (error instanceof Error && /^(Kaynak|Yalnızca|Bağlantı)/.test(error.message)) return error.message.slice(0, 300)
  return 'Kaynak içeriği okunamadı. Bağlantıyı kontrol edip yeniden deneyin.'
}

async function readSource(url: string) {
  try {
    const result = await fetchManagedSource(url)
    return { ...result, fetchError: result.contentText ? null : 'Bu dosyadan okunabilir metin çıkarılamadı.' }
  } catch (error) {
    return { contentText: null, contentType: null, fetchedAt: null, fetchError: fetchMessage(error) }
  }
}

export async function managedSourceRoutes(app: FastifyInstance, options: { prisma: PrismaClient }) {
  app.get('/', async () => ({
    sources: await options.prisma.managedSource.findMany({ select: summary, orderBy: { updatedAt: 'desc' }, take: 200 }),
  }))

  app.post('/', async (request, reply) => {
    const parsed = inputSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Bağlantı ve kaynak adı gereklidir.' })
    let url: string
    try { url = normalizeManagedSourceUrl(parsed.data.url) }
    catch (error) { return reply.code(400).send({ message: error instanceof Error ? error.message : 'Geçersiz bağlantı.' }) }
    const fetched = await readSource(url)
    try {
      const source = await options.prisma.managedSource.create({ data: { ...parsed.data, url, ...fetched }, select: summary })
      await recordSourceSnapshot(options.prisma, source.id, { url: source.url, ...fetched })
      return reply.code(201).send(source)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply.code(409).send({ message: 'Bu bağlantı zaten eklenmiş.' })
      throw error
    }
  })

  app.put('/:id', async (request, reply) => {
    const parsed = inputSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Geçerli kaynak alanları gereklidir.' })
    const { id } = request.params as { id: string }
    const existing = await options.prisma.managedSource.findUnique({ where: { id }, select: { url: true } })
    if (!existing) return reply.code(404).send({ message: 'Kaynak bulunamadı.' })
    let url: string
    try { url = normalizeManagedSourceUrl(parsed.data.url) }
    catch (error) { return reply.code(400).send({ message: error instanceof Error ? error.message : 'Geçersiz bağlantı.' }) }
    try {
      const source = await options.prisma.managedSource.update({
        where: { id }, data: { ...parsed.data, url, ...(url !== existing.url ? await readSource(url) : {}) }, select: summary,
      })
      if (url !== existing.url) await recordSourceSnapshot(options.prisma, source.id, { url: source.url, contentText: source.contentText, contentType: source.contentType, fetchedAt: source.fetchedAt })
      return reply.send(source)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply.code(409).send({ message: 'Bu bağlantı zaten eklenmiş.' })
      throw error
    }
  })

  app.post('/:id/refresh', async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await options.prisma.managedSource.findUnique({ where: { id }, select: { url: true } })
    if (!existing) return reply.code(404).send({ message: 'Kaynak bulunamadı.' })
    const source = await options.prisma.managedSource.update({ where: { id }, data: await readSource(existing.url), select: summary })
    await recordSourceSnapshot(options.prisma, source.id, { url: source.url, contentText: source.contentText, contentType: source.contentType, fetchedAt: source.fetchedAt })
    return reply.send(source)
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = await options.prisma.managedSource.updateMany({ where: { id }, data: { isActive: false, useInChat: false, useInRuns: false } })
    return result.count ? reply.code(204).send() : reply.code(404).send({ message: 'Kaynak bulunamadı.' })
  })
}
