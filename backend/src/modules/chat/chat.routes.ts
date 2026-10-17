import { generateChatTitle } from './application/generate-chat-title'
import type { BrowserResearch } from './application/browser-research'
import { installLocalWorkspaceBoundary } from '../../platform/local-workspace-access'
import type { ChatOperations } from './application/chat-operations'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import type { ChatModelClient, ChatStreamEvent } from './application/chat-model-client'
import type { ChatRepository } from './application/ports'
import type { AssistantKnowledge } from './application/assistant-knowledge'
import type { ChatScanStarter } from './application/chat-tools'
import { MAX_MESSAGE_LENGTH, sendChatMessage } from './application/send-chat-message'
import type { TariffLookup } from '../tariff/tariff-lookup'

export interface ChatRouteOptions {
  prepareDocument?: (versionId: string) => Promise<void>
  reportCreator?: import('./application/create-chat-report').ChatReportCreator
  usageRecorder?: import('../usage/measurement').UsageRecorder
  browserResearch?:BrowserResearch
  repository: ChatRepository
  model: ChatModelClient
  modelName: string
  knowledge: AssistantKnowledge
  scanStarter: ChatScanStarter
  tariffLookup?: TariffLookup | undefined
  operations?: ChatOperations | undefined
  componentStudio?: import('./application/component-studio').ComponentStudio | undefined
}

const messageBodySchema = z.object({
  sourceIds: z.array(z.string().uuid()).max(10).default([]),
  templateId: z.string().uuid().optional(),
  browserAgent:z.boolean().optional(),
  webSearch:z.boolean().optional(),
  content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  documentVersionIds: z.array(z.string().uuid()).max(10).default([]),
  operationMode: z.enum(['REUSE_ONLY', 'FILL_MISSING', 'FORCE']).optional(),
}).strict()

export async function chatRoutes(app: FastifyInstance, options: ChatRouteOptions) {
  const active=new Map<string,{controller:AbortController;startedAt:number;stage:string;content:string}>()
  if(options.operations)installLocalWorkspaceBoundary(app)
  app.get('/report-threads/:id', async (request, reply) => {
    const thread = await options.repository.getReportThread?.((request.params as {id: string}).id)
    return thread ? reply.send(thread) : reply.code(404).send({message: 'Rapor sohbeti bulunamadı veya erişilemiyor.'})
  })
  app.get('/context', async (request, reply) => {
    const query = z.object({query: z.string().trim().max(200).optional()}).safeParse(request.query)
    if (!query.success) return reply.code(400).send({message: 'Geçerli bir kaynak araması girin.'})
    const [sources, templates] = await Promise.all([options.knowledge.searchChatSources?.({...(query.data.query ? {query: query.data.query} : {}), limit: 100}) ?? [], options.knowledge.listChatTemplates?.() ?? []])
    return {sources, templates}
  })
  app.get('/reports', async (request, reply) => {
    const parsed = z.object({ query: z.string().trim().max(200).optional() }).safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ message: 'Geçerli bir rapor araması girin.' })
    const reports = await options.knowledge.searchReports({ ...(parsed.data.query ? { query: parsed.data.query } : {}), limit: 50 })
    return { reports: reports.filter(report => report.version > 0 && report.revisionEditable !== false).map(({ topicId, title, version, gazetteDate }) => ({ topicId, title, version, gazetteDate })) }
  })

  app.get('/sessions', async (_request, reply) => reply.send({ sessions: await options.repository.listHistory() }))

  app.post('/sessions', async (_request, reply) => reply.code(201).send(await options.repository.createSession()))

  app.get('/sessions/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!await options.repository.sessionExists(id)) return reply.code(404).send({ message: 'Sohbet bulunamadı.' })
    const running=active.get(id)
    return reply.send({sessionId:id,messages:await options.repository.getMessages(id),active:running?{startedAt:running.startedAt,stage:running.stage,content:running.content,stopping:running.controller.signal.aborted}:null})
  })

  app.post('/sessions/:id/stop',async(request,reply)=>{
    const {id}=request.params as {id:string}
    if(!await options.repository.sessionExists(id))return reply.code(404).send({message:'Sohbet bulunamadı.'})
    const running=active.get(id)
    if(running){
      request.log.info({sessionId:id,outcome:'USER_STOPPED',lastStage:running.stage},'chat.turn')
      running.controller.abort(new Error('USER_STOPPED'))
    }
    return {stopping:Boolean(running)}
  })

  app.delete('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if(!await options.repository.sessionExists(id))return reply.code(404).send({message:'Sohbet bulunamadı.'})
    if(active.has(id))return reply.code(409).send({message:'Bu sohbette işlem devam ediyor. Silmeden önce durdur düğmesini kullanın.'})
    return await options.repository.deleteSession(id)
      ? reply.code(204).send()
      : reply.code(404).send({ message: 'Sohbet bulunamadı.' })
  })

  app.post('/sessions/:id/messages', async (request, reply) => {
    const body = messageBodySchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ message: `Mesaj 1-${MAX_MESSAGE_LENGTH} karakter olmalıdır.` })
    const { id } = request.params as { id: string }
    if (!await options.repository.sessionExists(id)) return reply.code(404).send({ message: 'Sohbet bulunamadı.' })

    if (body.data.webSearch || body.data.browserAgent) return reply.code(400).send({message: 'Google Search ve tarayıcı ajanı şu anda kapalı. Seçili kaynakları, arşiv belgelerini veya otomasyon kayıtlarını kullanın.'})
    if(body.data.browserAgent&&body.data.webSearch)return reply.code(400).send({message:'Bir araştırma aracı seçin.'})
    if((body.data.webSearch||body.data.browserAgent) && body.data.documentVersionIds.length)return reply.code(400).send({message:'Web araması için ekli belgeleri kaldırın; özel belge içeriği arama sorgusuna eklenmez.'})
    if ((body.data.webSearch || body.data.browserAgent) && (body.data.sourceIds.length || body.data.templateId)) return reply.code(400).send({message: 'Kaynak ve şablon seçimi için web araştırmasını kapatın.'})
    if (body.data.sourceIds.length && body.data.documentVersionIds.length) return reply.code(400).send({message: 'Yalnızca seçili kaynağı kullanmak için ekli belgeleri kaldırın.'})
    for (const sourceId of new Set(body.data.sourceIds)) {
      if (!await options.knowledge.getChatSource?.(sourceId)) return reply.code(404).send({message: 'Seçilen kaynak bulunamadı veya sohbet için etkin değil.'})
    }
    if (body.data.templateId && !await options.knowledge.getChatTemplate?.(body.data.templateId)) return reply.code(404).send({message: 'Seçilen şablon bulunamadı veya etkin değil.'})
    for (const versionId of new Set(body.data.documentVersionIds)) {
      if (!await options.knowledge.getArchiveDocumentVersion?.({ versionId })) return reply.code(404).send({ message: 'Seçilen belge sürümü bulunamadı veya erişilemiyor.' })
    }

    // A subscriber leaving must not cancel the server-owned conversation turn.
    if(active.has(id))return reply.code(409).send({message:'Bu sohbette bir işlem zaten devam ediyor.'})
    const controller = new AbortController()
    const startedAt=Date.now()
    const running={controller,startedAt,stage:'Yanıt hazırlanıyor',content:''}
    active.set(id,running)
    let userMessageId:string|null=null,terminal=false,lastStage='Yanıt hazırlanıyor'
    const audit=(outcome:string)=>({sessionId:id,userMessageId,outcome,lastStage,durationMs:Date.now()-startedAt})
    request.log.info(audit('STARTED'),'chat.turn')
    reply.raw.once('close', () => {
      if (!reply.raw.writableEnded){
        request.log.info(audit('SUBSCRIBER_DISCONNECTED'),'chat.turn')
      }
    })

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const heartbeat=setInterval(()=>{
      if(!terminal && !controller.signal.aborted && !reply.raw.writableEnded)writeEvent(reply,{type:'tool',name:'progress',label:`${lastStage} · ${Math.floor((Date.now()-startedAt)/1000)} sn`})
    },15000)
    const deadline=setTimeout(()=>{
      if(terminal)return
      request.log.warn(audit('TIMEOUT'),'chat.turn')
      terminal=true
      writeEvent(reply,{type:'error',message:`Yanıt süresi aşıldı. Mesajınız kaydedildi; yeniden deneyebilirsiniz. (Takip: ${userMessageId??request.id})`})
      controller.abort(new Error('CHAT_TIMEOUT'))
      reply.raw.end()
    },180000)
    let checking = false
    const sessionTimer = request.assertSessionActive ? setInterval(async () => {
      if (checking || controller.signal.aborted) return
      checking = true
      try { await request.assertSessionActive!() }
      catch {
        request.log.warn(audit('SESSION_EXPIRED'),'chat.turn')
        terminal=true
        controller.abort(new Error('SESSION_EXPIRED'))
        if (!reply.raw.writableEnded) { writeEvent(reply, { type: 'error', message: 'Oturum veya erişim izni sona erdi.' }); reply.raw.end() }
      } finally { checking = false }
    }, 3000) : null
    try {
      for await (const event of sendChatMessage(
        { sessionId: id, content: body.data.content, sourceIds: body.data.sourceIds, ...(body.data.templateId ? {templateId: body.data.templateId} : {}), ...(body.data.webSearch?{webSearch:true}:{}), ...(body.data.browserAgent?{browserAgent:true}:{}), documentVersionIds: body.data.documentVersionIds, ...(body.data.operationMode ? { operationMode: body.data.operationMode } : {}), signal: controller.signal },
        { ...options, onFailure: (error) => request.log.error({...audit('STEP_FAILED'),category: error && typeof error==='object' && 'category' in error?String(error.category):error instanceof Error ? error.message.match(/^[A-Z_]+(?=:)/)?.[0]??error.name:'UNKNOWN'}, 'chat.turn.failure') },
      )) {
        if (controller.signal.aborted) break
        if(event.type==='message' && event.message.role==='USER')userMessageId=event.message.id
        if(event.type==='tool'){lastStage=event.label;running.stage=event.label;request.log.info({...audit('TOOL_STARTED'),tool:event.name},'chat.turn.stage')}
        if(event.type==='delta'){lastStage='Yanıt yazılıyor';running.stage=lastStage;running.content+=event.content}
        if(event.type==='complete' || event.type==='error'){
          terminal=true
          request.log.info(audit(event.type==='complete'?'COMPLETED':'FAILED'),'chat.turn')
        }
        writeEvent(reply, event)
        if(event.type==='message' && event.message.role==='USER') {
          void generateChatTitle({sessionId:id,messageId:event.message.id},options).catch(error=>request.log.warn({err:error},'Sohbet başlığı oluşturulamadı'))
        }
      }
      if(!terminal && !controller.signal.aborted){
        terminal=true
        request.log.error(audit('INCOMPLETE_STREAM'),'chat.turn')
        writeEvent(reply,{type:'error',message:`Yanıt tamamlanamadı. Yeniden deneyebilirsiniz. (Takip: ${userMessageId??request.id})`})
      }
    } catch(error) {
      request.log.error({...audit('UNHANDLED_FAILURE'),errorType:error instanceof Error?error.name:'UNKNOWN'},'chat.turn')
      if(!reply.raw.writableEnded && !controller.signal.aborted)writeEvent(reply,{type:'error',message:`Yanıt kaydedilemedi veya tamamlanamadı. (Takip: ${userMessageId??request.id})`})
    } finally {
      if(active.get(id)===running)active.delete(id)
      clearInterval(heartbeat)
      clearTimeout(deadline)
      if (sessionTimer) clearInterval(sessionTimer)
      reply.raw.end()
    }
    return reply
  })
}

function writeEvent(reply: FastifyReply, event: ChatStreamEvent): void {
  if(reply.raw.destroyed || reply.raw.writableEnded)return
  reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}
