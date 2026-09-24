import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import type { AiModelClient } from '../ai/application/ai-model-client'
import { buildPresetHtml, templateBaseHtml, templateComponents, templatePresets, validateTemplateHtml } from './template-composer'
import { suggestTemplate, templateSuggestionInput } from './suggest-template'

const fields = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable(),
  html: z.string().trim().min(1).max(500_000),
})

const updateFields = fields.extend({ revision: z.number().int().positive() })

export async function reportTemplateRoutes(app: FastifyInstance, options: { prisma: PrismaClient; model?: AiModelClient; modelName?: string }) {
  app.get('/catalog', async () => ({ baseHtml: templateBaseHtml(), components: templateComponents, presets: templatePresets }))

  app.post('/suggest', async (request, reply) => {
    const input = templateSuggestionInput.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ message: 'Geçerli bir şablon isteği ve HTML içeriği gereklidir.' })
    if (!options.model || !options.modelName) return reply.code(503).send({ message: 'AI şablon düzenleyicisi yapılandırılmamış.' })
    try {
      return reply.send(await suggestTemplate(input.data, options.model, options.modelName))
    } catch (error) {
      request.log.error({ err: error }, 'Şablon önerisi üretilemedi')
      return reply.code(502).send({ message: 'Şablon düzenlenemedi. İsteği sadeleştirip yeniden deneyin.' })
    }
  })

  app.post('/presets/:key', async (request, reply) => {
    const key = (request.params as { key: string }).key
    try { return reply.send({ html: buildPresetHtml(key) }) }
    catch { return reply.code(404).send({ message: 'Hazır şablon bulunamadı.' }) }
  })

  app.get('/', async () => ({
    templates: await options.prisma.reportTemplate.findMany({
      select: { id: true, name: true, description: true, revision: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    }),
  }))

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const template = await options.prisma.reportTemplate.findUnique({ where: { id } })
    return template ? reply.send(template) : reply.code(404).send({ message: 'Şablon bulunamadı' })
  })

  app.post('/', async (request, reply) => {
    const parsed = fields.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Şablon adı ve HTML içeriği gereklidir' })
    try { validateTemplateHtml(parsed.data.html) } catch (error) { return reply.code(400).send({ message: error instanceof Error ? error.message : 'Geçersiz HTML.' }) }
    const template = await options.prisma.reportTemplate.create({ data: parsed.data })
    return reply.code(201).send(template)
  })

  app.put('/:id', async (request, reply) => {
    const parsed = updateFields.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Geçerli şablon alanları ve sürüm gereklidir' })
    try { validateTemplateHtml(parsed.data.html) } catch (error) { return reply.code(400).send({ message: error instanceof Error ? error.message : 'Geçersiz HTML.' }) }
    const { id } = request.params as { id: string }
    const { revision, ...data } = parsed.data
    const result = await options.prisma.reportTemplate.updateMany({
      where: { id, revision },
      data: { ...data, revision: { increment: 1 } },
    })
    if (result.count === 0) {
      const exists = await options.prisma.reportTemplate.findUnique({ where: { id }, select: { id: true } })
      return reply.code(exists ? 409 : 404).send({ message: exists ? 'Şablon başka bir yerde güncellendi. Sayfayı yenileyin.' : 'Şablon bulunamadı' })
    }
    return reply.send(await options.prisma.reportTemplate.findUniqueOrThrow({ where: { id } }))
  })
}
