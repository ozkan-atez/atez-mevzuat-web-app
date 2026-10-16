import { backfillDocumentArchive } from '../documents/application/backfill-document-archive'
import {jobInitiatorFields} from '../../platform/actor-context'
import { captureSourceDocument } from './source-attachments'
import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { processSourceDocuments, type SourceProcessingDependencies } from './process-source-documents'
import { sourceProfileSchema } from './source-profile'
import { activeSourceProfile } from './source-profile-store'
import { sourceLogin } from './source-secrets'
import { openSourceSession, type SourceSession } from './source-session'
import { collectSource } from './source-collector'
import { initializeSourceStages, recordSourceStage, stopPendingStages, type SourceStage } from './source-stages'
import type { TariffCredentials } from './tariff-auth'

export async function createSourceRun(prisma: PrismaClient, input: { sourceId: string; scanRunId?: string; targetDate: string; requestKey: string; trigger: 'MANUAL' | 'CRON'; scheduleSlot?: string }) {
  const source = await prisma.source.findUnique({ where: { id: input.sourceId }, include: { endpoints: { where: { status: 'ACTIVE', adapter: { not: null } } } } })
  if (!source?.isActive || source.key === 'resmi-gazete') throw new Error('Bu kaynak için etkin tarihli tarama akışı bulunamadı.')
  const existing = await prisma.sourceScanRun.findUnique({ where: { requestKey: input.requestKey } })
  if (existing) return existing
  return prisma.sourceScanRun.create({ data: {
    ...jobInitiatorFields(),
    sourceId: input.sourceId, scanRunId: input.scanRunId ?? null, requestKey: input.requestKey, targetDate: new Date(`${input.targetDate}T00:00:00.000Z`), trigger: input.trigger, scheduleSlot: input.scheduleSlot ?? null,
  } }).catch(async error => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.sourceScanRun.findUnique({ where: { requestKey: input.requestKey } })
      if (existing) return existing
    }
    throw error
  })
}

export async function executeSourceRun(prisma: PrismaClient, runId: string, tariffCredentials?: TariffCredentials | null, queueVersion?: number, processing?: SourceProcessingDependencies): Promise<void> {
  const claimed = await prisma.sourceScanRun.updateMany({ where: { id: runId, status: 'QUEUED', ...(queueVersion !== undefined ? { queueVersion } : {}) }, data: { status: 'RUNNING', startedAt: new Date(), errorSummary: null } })
  if (!claimed.count) return
  const run = await prisma.sourceScanRun.findUniqueOrThrow({ where: { id: runId }, include: { source: true, scanRun: true } })
  const targetDate = run.targetDate.toISOString().slice(0, 10)
  let session: SourceSession | undefined; let active: SourceStage = 'ACCESS'
  const failures: string[] = []
  const stage = async (name: SourceStage, status: string, total=0, completed=0, error:string|null=null) => { active=name; await recordSourceStage(prisma,runId,name,status,total,completed,error) }
  try {
    await initializeSourceStages(prisma,runId);await stage('ACCESS','RUNNING')
    const saved=run.profileSnapshot as {id:string;version:number;config:unknown}|null
    const profile=saved?{...saved,config:sourceProfileSchema.parse(saved.config)}:await activeSourceProfile(prisma,run.source)
    const login=await sourceLogin(prisma,run.sourceId,run.source.key) ?? (run.source.key==='tariff'?tariffCredentials:null) ?? null
    session=await openSourceSession(profile.config,login)
    const parentConfig=run.scanRun?.workspaceConfig as Record<string,unknown>|null
    const datePolicy=parentConfig?.datePolicy==='NEW_OR_CHANGED'?'NEW_OR_CHANGED':run.datePolicy
    await prisma.sourceScanRun.update({where:{id:runId},data:{profileSnapshot:profile as unknown as Prisma.InputJsonValue,datePolicy}})
    await stage('ACCESS','COMPLETED');await stage('DISCOVERY','RUNNING')
    const collected=await collectSource(profile.config,targetDate,session,login,datePolicy)
    for(const item of collected.items) await prisma.sourceObservation.upsert({where:{sourceId_scope_url:{sourceId:run.sourceId,scope:'inventory',url:item.url}},create:{sourceId:run.sourceId,url:item.url,title:item.title,publishedOn:item.publishedOn?new Date(item.publishedOn):null},update:{title:item.title,publishedOn:item.publishedOn?new Date(item.publishedOn):null,lastSeenAt:new Date()}})
    await prisma.sourceScanRun.update({where:{id:runId},data:{coverage:{notes:collected.notes??[],pages:collected.pages,warnings:collected.warnings,observed:collected.observed,oldestDate:collected.oldestDate,newestDate:collected.newestDate}}})
    if(!collected.pages.length)throw new Error(collected.warnings.join('; ')||'Kaynak listesine erişilemedi.')
    const items=collected.items.filter(item=>datePolicy==='NEW_OR_CHANGED'||item.publishedOn===targetDate)
    await stage('DISCOVERY',collected.warnings.length?'PARTIAL':'COMPLETED',collected.observed,collected.observed)
    await stage('CAPTURE','RUNNING',items.length)
    if (!processing) throw new Error('Kaynak AI filtreleme ve rapor servisi yapılandırılmamış.')
    let budget=Math.min(Number(processing.maxRunBytes),100_000_000);let completed=0;let unchanged=0
    const scope=run.scanRun?.automationId??`manual:${run.sourceId}`
    for(const item of items) {
      try {
        const existing=await prisma.sourceScanDocument.findUnique({where:{runId_url:{runId,url:item.url}}})
        const capture=existing?.captureStatus==='COMPLETED'?null:await captureSourceDocument(item.url,run.source.baseUrl,processing.objectStore,item.attachments??[],budget,item.capturedHtml?async(url,maxBytes)=>url===item.url?{body:Buffer.from(item.capturedHtml!),contentType:'text/html'}:session!.binary(url,maxBytes):session.binary,{extractPdfText:false,maxFileBytes:profile.config.maxFileBytes??25_000_000})
        const files=capture?.files??(Array.isArray(existing?.capturedFiles)?existing.capturedFiles:[])
        budget-=files.reduce((sum:number,file:any)=>sum+(file.status==='STORED'?Number(file.byteSize??0):0),0)
        const contentText=item.capturedContent??capture?.contentText??existing?.contentText??null
        const hash=(contentText||files.some((f:any)=>f.sha256))?createHash('sha256').update(JSON.stringify({text:contentText,files:files.map((file:any)=>({url:file.url,sha256:file.sha256})).sort((a:any,b:any)=>a.url.localeCompare(b.url))})).digest('hex'):null
        const receipt=(run.scanRun?.automationId || datePolicy==='NEW_OR_CHANGED')?await prisma.sourceObservation.findUnique({where:{sourceId_scope_url:{sourceId:run.sourceId,scope,url:item.url}}}):null
        if(!existing&&hash&&receipt?.contentHash===hash&&capture?.status==='COMPLETED'){completed++;unchanged++;continue}
        if(capture?.errors.length)failures.push(...capture.errors)
        await prisma.sourceScanDocument.upsert({where:{runId_url:{runId,url:item.url}},create:{runId,url:item.url,title:item.title,publishedOn:item.publishedOn?new Date(item.publishedOn):null,dateBasis:item.publishedOn?'PUBLISHED':'FIRST_SEEN',contentText,contentHash:hash,feedUrl:item.feedUrl,captureStatus:capture?.status??'COMPLETED',capturedFiles:files as Prisma.InputJsonValue,captureError:capture?.errors.join('; ').slice(0,1000)||null},update:existing?.captureStatus==='COMPLETED'?{}:{contentText,contentHash:hash,captureStatus:capture?.status??'FAILED',capturedFiles:files as Prisma.InputJsonValue,captureError:capture?.errors.join('; ').slice(0,1000)||null}})
        completed++
      }catch(error){failures.push(`${item.title}: ${error instanceof Error?error.message:'Belge okunamadı.'}`)}
      await stage('CAPTURE','RUNNING',items.length,completed)
    }
    await backfillDocumentArchive(prisma,{apply:true,sourceRunId:runId})
    await stage('CAPTURE',failures.length?'PARTIAL':'COMPLETED',items.length,completed)
    if(unchanged)await prisma.sourceScanRun.update({where:{id:runId},data:{coverage:{notes:[...(collected.notes??[]),`${unchanged} belge önceki çalışmayla aynı; yeniden analiz edilmedi.`],pages:collected.pages,warnings:collected.warnings,observed:collected.observed,oldestDate:collected.oldestDate,newestDate:collected.newestDate}}})
    const documents=await prisma.sourceScanDocument.findMany({where:{runId}})
    const valid=documents.filter(d=>d.captureStatus==='COMPLETED'&&d.contentText)
    await stage('VALIDATION',valid.length===documents.length?'COMPLETED':'PARTIAL',documents.length,valid.length)
    if(documents.length) {
      const processed=await processSourceDocuments(prisma,runId,{...processing,onStage:async(name,status,total,done)=>stage(name,status,total,done)})
      failures.push(...processed.failures)
    } else {for(const name of ['FILTER','PREVIOUS_SOURCES','ANALYSIS','REPORT'] as const)await stage(name,'SKIPPED',0,0,'Seçilen kapsamda yeni belge yok; AI çağrısı gerekmedi.')}
    const finished=await prisma.sourceScanDocument.findMany({where:{runId}})
    for(const document of finished.filter(d=>['COMPLETED','EXCLUDED'].includes(d.processingStatus)&&d.contentHash)) await prisma.sourceObservation.upsert({where:{sourceId_scope_url:{sourceId:run.sourceId,scope,url:document.url}},create:{sourceId:run.sourceId,scope,url:document.url,title:document.title,publishedOn:document.publishedOn,contentHash:document.contentHash},update:{contentHash:document.contentHash,lastSeenAt:new Date()}})
    const successful=finished.some(d=>['COMPLETED','EXCLUDED'].includes(d.processingStatus))
    const status=failures.length?(successful?'PARTIAL':'FAILED'):collected.warnings.length?'PARTIAL':'COMPLETED'
    const errorSummary=[...failures,...collected.warnings].join('; ').slice(0,1000)||null
    await stage('COMPLETE',status,items.length,completed,errorSummary)
    await prisma.sourceScanRun.update({where:{id:runId},data:{status,errorSummary,completedAt:new Date(),reportHtml:null}})
    await prisma.source.update({where:{id:run.sourceId},data:{lastScanned:new Date()}})
  }catch(error){
    const message=error instanceof Error?error.message:'Kaynak taranamadı.'
    await stage(active,/AUTH_REQUIRED|USER_ACTION_REQUIRED|SUBSCRIPTION_REQUIRED/.test(message)?'BLOCKED':'FAILED',0,0,message.slice(0,1000));await stopPendingStages(prisma,runId)
    await prisma.sourceScanRun.update({where:{id:runId},data:{status:'FAILED',errorSummary:message.slice(0,1000),completedAt:new Date()}})
  }finally{await session?.close()}
}
