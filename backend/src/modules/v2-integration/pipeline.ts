import { renderReportHtml } from '../topic-analysis/application/render-report-html'
import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient, type ScanStage } from '@prisma/client'
import { getActorContext, privateActorScope, resourceOwnership } from '../../platform/actor-context'
import type { ScanCommand, ObjectStore } from '../scan-runs/application/ports'
import { ReportSpecSchema } from '../topic-analysis/domain/report-spec-schemas'

export interface PipelineSnapshot {
 id:string; status:string; done:boolean; date:string
 steps:Array<{nodeId:string;total:number;succeeded:number;failed:number;skipped:number;closed:boolean}>
 documents:Array<{id:string;title:string;url:string;context:unknown;decision:string|null;reason:string;files:Array<{role:string;url:string|null;sha256:string;objectKey:string;mime:string;bytes:number}>}>
 reports:Array<{id:string;revision:number;htmlKey:string;html:string;spec:{headline:string;templateVersionId:string;sections:unknown[]};analysis:{summary:string;operationalImpact:string;affected:{parties:string[]};dates:{effective:Array<{date:string|null}>};documents:Array<{title:string;url:string|null}>}}>
 calls:Array<{id:string;purpose:string;provider:string;model:string;status:string;inputTokens:number|null;outputTokens:number|null;cachedTokens:number|null;thinkingTokens:number|null;createdAt:Date;latencyMs:number}>
 failures:Array<{node:string;error:unknown}>
 discovery:unknown
}
export interface ApplicationPipeline {
 start(id:string,input:{date:string;templateId?:string;templateRevision?:number},actor:{kind:'user'|'system';workspaceId:string;userId:string|null}):Promise<string>
 snapshot(id:string):Promise<PipelineSnapshot>
 close():Promise<void>
}
let runtime:Promise<ApplicationPipeline>|undefined
export function applicationPipeline():Promise<ApplicationPipeline> {
 if(!runtime){const entry=new URL('../../../../v2/apps/worker/src/application-pipeline.ts',import.meta.url).href;runtime=import(entry).then(m=>m.createApplicationPipeline(process.env));runtime=runtime!.catch(e=>{runtime=undefined;throw e})}
 return runtime
}
export function stableId(value:string){const h=createHash('sha256').update(value).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
const stageByNode:Record<string,ScanStage>={discover:'DISCOVERING',title:'AI_FILTERING',fetch:'DOWNLOADING_DOCUMENTS',normalize:'VALIDATING',profile:'AI_FILTERING',extract:'ANALYZING_TOPICS',lineage:'DISCOVERING_PREVIOUS_SOURCES',link:'ANALYZING_TOPICS',analyze:'ANALYZING_TOPICS',compose:'GENERATING_REPORTS',render:'GENERATING_REPORTS'}
export function mappedStages(snapshot:PipelineSnapshot){
 const groups=new Map<ScanStage,PipelineSnapshot['steps']>()
 for(const step of snapshot.steps){const key=stageByNode[step.nodeId];if(key)groups.set(key,[...(groups.get(key)??[]),step])}
 return [...groups].map(([stage,steps])=>{const totalItems=steps.reduce((n,s)=>n+s.total,0),completedItems=Math.min(totalItems,steps.reduce((n,s)=>n+s.succeeded+s.skipped,0)),failedItems=steps.reduce((n,s)=>n+s.failed,0);return {stage,totalItems,completedItems,failedItems,status:failedItems?'FAILED' as const:steps.every(s=>s.closed)?(totalItems?'COMPLETED' as const:'SKIPPED' as const):totalItems?'RUNNING' as const:'PENDING' as const}})
}

export async function executeV2Scan(prisma:PrismaClient,command:ScanCommand,store:Pick<ObjectStore,'putRunFile'|'getContent'>,pipeline?:ApplicationPipeline){
 const run=await prisma.scanRun.findUniqueOrThrow({where:{id:command.runId}})
 const config=(run.workspaceConfig??{}) as Record<string,unknown>
 const template=config.template as {studioSnapshot?:{id:string;revision:number}}|null
 if(config.templateId && !template?.studioSnapshot)throw new Error('Bu tarama için stüdyodan bir şablon seçilmelidir.')
 const actor=getActorContext()
 if(!actor)throw new Error('Tarama kullanıcı bağlamı bulunamadı.')
 if(run.workspaceId && (run.workspaceId!==actor.workspaceId || (run.initiatorUserId && run.initiatorUserId!==actor.userId)))throw new Error('Tarama sahibi uyuşmuyor.')
 const engine=pipeline??await applicationPipeline()
 const id=stableId(`pipeline:${command.outboxId}`)
 await engine.start(id,{date:run.targetDate.toISOString().slice(0,10),...(template?.studioSnapshot?{templateId:template.studioSnapshot.id,templateRevision:template.studioSnapshot.revision}:{})},{kind:actor.serviceActor?'system':'user',workspaceId:actor.workspaceId,userId:actor.serviceActor?null:actor.userId})
 const startedAt=run.startedAt??new Date()
 await prisma.scanRun.update({where:{id:run.id},data:{status:'RUNNING',startedAt,workspaceConfig:{...config,pipelineRunId:id,engine:'v2'} as Prisma.InputJsonValue}})
 while(true){
  const snapshot=await engine.snapshot(id)
  const stages=mappedStages(snapshot)
  await prisma.$transaction(async tx=>{
   for(const item of stages)await tx.stageExecution.upsert({where:{scanRunId_stage:{scanRunId:run.id,stage:item.stage}},create:{scanRunId:run.id,...item},update:item})
   await tx.scanRun.update({where:{id:run.id},data:{currentStage:stages.find(s=>s.status==='RUNNING')?.stage??'GENERATING_REPORTS',totalItems:stages.reduce((n,s)=>n+s.totalItems,0),completedItems:stages.reduce((n,s)=>n+s.completedItems,0),failedItems:stages.reduce((n,s)=>n+s.failedItems,0)}})
   for(const call of snapshot.calls){const data={workspaceId:actor.workspaceId,actorUserId:actor.serviceActor?null:actor.userId,conversationId:run.id,conversationType:run.automationId?'AUTOMATION':'OPERATION',messageId:`v2:${call.id}`,provider:call.provider,model:call.model,mode:'ANALYSIS',status:call.status==='OK'?'COMPLETED':call.status,usageLabel:call.purpose,inputTokens:call.inputTokens,outputTokens:call.outputTokens,cachedTokens:call.cachedTokens,reasoningTokens:call.thinkingTokens,startedAt:new Date(call.createdAt),completedAt:new Date(new Date(call.createdAt).getTime()+call.latencyMs)};await tx.chatUsageEvent.upsert({where:{id:`v2:${call.id}`},create:{id:`v2:${call.id}`,...data},update:data})}
  })
  if(snapshot.status==='WAITING_INPUT')throw new Error('V2 iş akışı ek girdi bekliyor; tarama ayrıntılarını kontrol edin.')
  if(snapshot.done){await importPipelineResults(prisma,run.id,snapshot,store);return}
  await new Promise(resolve=>setTimeout(resolve,1000))
 }
}

export async function importPipelineResults(prisma:PrismaClient,runId:string,snapshot:PipelineSnapshot,store:Pick<ObjectStore,'putRunFile'|'getContent'>){
 const scope=privateActorScope(),ownership=resourceOwnership()
 const issueNumber=String((snapshot.discovery as {precheck?:{editions?:Array<{issue?:string|number}>}}|undefined)?.precheck?.editions?.[0]?.issue??'—')
 const reports: Array<{id:string;report:Pick<PipelineSnapshot['reports'][number],'revision'>;spec:ReturnType<typeof ReportSpecSchema.parse>;key:string;htmlKey:string}>=[]
 for(const report of snapshot.reports){
  const id=stableId(`${runId}:report:${report.id}`),a=report.analysis
  const source=a.documents.find(d=>d.url)??a.documents[0]
  const date=new Date(`${snapshot.date}T00:00:00Z`)
  const spec=ReportSpecSchema.parse({schemaVersion:1,templateFamily:'bulten-v2',card:'K1',topicId:id,reportId:snapshot.date.slice(8,10)+snapshot.date.slice(5,7)+snapshot.date.slice(2,4)+'-01',documentTitle:report.spec.headline,title:report.spec.headline,issueNumber,displayDate:date.toLocaleDateString('tr-TR',{timeZone:'Europe/Istanbul'}),typeLabel:'Mevzuat analizi',summary:a.summary,affectedParties:a.affected.parties.slice(0,3),dates:a.dates.effective.flatMap(d=>d.date?[d.date]:[]).slice(0,3),note:a.operationalImpact||null,source:{label:source?.title??'Resmî Gazete',url:source?.url??''},blocks:['B1','B2','B3','B4','B7','B9','B10'],customization:{studioReport:{html:report.html,templateId:report.spec.templateVersionId,revision:report.revision,sections:report.spec.sections},sources:a.documents.slice(0,30).map((d,i)=>({id:`evidence-${i}`,label:d.title,url:d.url??'',content:JSON.stringify(a).slice(0,100000),kind:d.url?'URL':'TEXT'}))}})
  const key=`runs/${runId}/v2/${id}/r${report.revision}/spec.json`
  const htmlKey=key.replace(/spec\.json$/, 'report.html')
  if(!await prisma.reportRevision.findUnique({where:{id:stableId(`${id}:${report.revision}`)},select:{id:true}})) {
   await store.putRunFile(key,Buffer.from(JSON.stringify(spec)),'application/json')
   await store.putRunFile(htmlKey,Buffer.from(report.html),'text/html; charset=utf-8')
  }
  reports.push({id,report,spec,key,htmlKey})
 }
 if(!reports.length && snapshot.status==='COMPLETED' && !snapshot.failures.length && snapshot.documents.every(d=>d.decision==='OUT')) {
  const id=stableId(`${runId}:empty-day`)
  const spec=ReportSpecSchema.parse({schemaVersion:1,templateFamily:'bulten-v2',card:'K6',topicId:null,reportId:snapshot.date.slice(8,10)+snapshot.date.slice(5,7)+snapshot.date.slice(2,4)+'-00',documentTitle:'ATEZ Mevzuat Radarı Günlük Raporu — Değişiklik Yok',issueNumber,displayDate:new Date(snapshot.date).toLocaleDateString('tr-TR'),emptyDayText:`İncelenen ${snapshot.documents.length} resmî belgede raporlanabilir gümrük veya dış ticaret değişikliği bulunmadı.`,source:{label:'Resmî Gazete',url:'https://www.resmigazete.gov.tr'},blocks:['B1','B10']})
  const key=`runs/${runId}/v2/${id}/r1/spec.json`,htmlKey=key.replace('spec.json','report.html')
  if(!await prisma.reportRevision.findUnique({where:{id:stableId(`${id}:1`)},select:{id:true}})) {
   await store.putRunFile(key,Buffer.from(JSON.stringify(spec)),'application/json')
   await store.putRunFile(htmlKey,Buffer.from(await renderReportHtml(spec)),'text/html; charset=utf-8')
  }
  reports.push({id,report:{revision:1},spec,key,htmlKey})
 }
 const manifestKey=`runs/${runId}/v2/manifest.json`
 await store.putRunFile(manifestKey,Buffer.from(JSON.stringify({pipelineRunId:snapshot.id,date:snapshot.date,status:snapshot.status,documents:snapshot.documents,reports:reports.map(r=>({id:r.id,specKey:r.key,htmlKey:r.htmlKey}))})),'application/json')
 await prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${runId}))`
  const discovery=snapshot.discovery as {precheck?:{editions?:Array<{url:string;mukerrer:number|null;issue:string}>}}|undefined
  for(const edition of discovery?.precheck?.editions??[])await tx.gazetteEdition.upsert({where:{scanRunId_indexUrl:{scanRunId:runId,indexUrl:edition.url}},create:{scanRunId:runId,indexUrl:edition.url,publicationDate:new Date(snapshot.date),type:edition.mukerrer?'SUPPLEMENT':'MAIN',supplementNo:edition.mukerrer,discoveryOrder:edition.mukerrer??0},update:{}})
  const job=await tx.aiJob.upsert({where:{scanRunId_kind:{scanRunId:runId,kind:'DOCUMENT_FILTER'}},create:{scanRunId:runId,kind:'DOCUMENT_FILTER',status:snapshot.failures.length?'FAILED':'COMPLETED',model:'v2',titlePromptVersion:'v2',contentPromptVersion:'v2',configurationHash:createHash('sha256').update('v2').digest('hex')},update:{status:snapshot.failures.length?'FAILED':'COMPLETED'}})
  for(const [i,doc] of snapshot.documents.entries()){
   const ctx=(doc.context??{}) as {feed?:string;mukerrer?:number;position?:number}
   const indexUrl=ctx.feed??`https://www.resmigazete.gov.tr/eskiler/${snapshot.date.slice(0,4)}/${snapshot.date.slice(5,7)}/${snapshot.date.replaceAll('-','')}.htm`
   const edition=await tx.gazetteEdition.upsert({where:{scanRunId_indexUrl:{scanRunId:runId,indexUrl}},create:{scanRunId:runId,publicationDate:new Date(snapshot.date),type:ctx.mukerrer?'SUPPLEMENT':'MAIN',supplementNo:ctx.mukerrer??null,indexUrl,discoveryOrder:ctx.mukerrer??0},update:{}})
   let storedObjectId:string|undefined
   const original=doc.files.find(f=>f.role==='ORIGINAL')
   if(original){const stored=await tx.storedObject.upsert({where:{sha256:original.sha256},create:{sha256:original.sha256,bucket:process.env.S3_BUCKET??'resmi-gazete',objectKey:original.objectKey,mediaType:original.mime,byteSize:BigInt(original.bytes)},update:{}});storedObjectId=stored.id}
   const document=await tx.collectedDocument.upsert({where:{editionId_sourceUrl:{editionId:edition.id,sourceUrl:doc.url}},create:{editionId:edition.id,title:doc.title,sourceUrl:doc.url,publicationOrder:ctx.position??i,validationStatus:storedObjectId?'VALID':'PENDING',...(storedObjectId?{storedObjectId}:{})},update:{title:doc.title,...(storedObjectId?{storedObjectId,validationStatus:'VALID' as const}:{})}})
   for(const file of doc.files.filter(f=>f.role==='ATTACHMENT' && f.url)) {
    const asset=await tx.storedObject.upsert({where:{sha256:file.sha256},create:{sha256:file.sha256,bucket:process.env.S3_BUCKET??'resmi-gazete',objectKey:file.objectKey,mediaType:file.mime,byteSize:BigInt(file.bytes)},update:{}})
    await tx.documentAsset.upsert({where:{documentId_sourceUrl:{documentId:document.id,sourceUrl:file.url!}},create:{documentId:document.id,sourceUrl:file.url!,storedObjectId:asset.id,role:'ATTACHMENT',validationStatus:'VALID'},update:{storedObjectId:asset.id,validationStatus:'VALID'}})
   }
   if(original && storedObjectId) {
    const source=await tx.source.findUnique({where:{key:'resmi-gazete'},select:{id:true}})
    const library=await tx.document.upsert({where:{canonicalKey:`${scope}:${doc.url}`},create:{...ownership,actorScope:scope,canonicalKey:`${scope}:${doc.url}`,canonicalUrl:doc.url,title:doc.title,publishedOn:new Date(snapshot.date),sourceId:source?.id??null,origin:'SOURCE'},update:{}})
    const version=await tx.documentVersion.upsert({where:{documentId_contentHash:{documentId:library.id,contentHash:original.sha256}},create:{documentId:library.id,contentHash:original.sha256,storedObjectId,mimeType:original.mime,extractionStatus:'PENDING',extractionMetadata:{pipeline:'v2',pipelineDocumentId:doc.id}},update:{}})
    const linkId=stableId(`${runId}:document:${version.id}`)
    await tx.documentLink.upsert({where:{id:linkId},create:{id:linkId,...ownership,actorScope:scope,documentVersionId:version.id,scanRunId:runId,role:'SOURCE'},update:{}})
   }
   const decision=doc.decision==='IN'?'IN':doc.decision==='OUT'?'OUT':null
   await tx.documentFilterDecision.upsert({where:{aiJobId_documentId:{aiJobId:job.id,documentId:document.id}},create:{aiJobId:job.id,documentId:document.id,titleDecision:decision??'MAYBE',titleReason:doc.reason,titleConfidence:0,finalDecision:decision},update:{finalDecision:decision}})
  }
  for(const {id,report,spec,key,htmlKey} of reports){
   await tx.topicReport.upsert({where:{id},create:{id,scanRunId:runId,title:spec.documentTitle,basename:spec.card==='K6'?'00-degisiklik-yok.html':`01-${id}.html`,card:spec.card,latestVersion:1,actorScope:scope,...ownership},update:{}})
   const revisionId=stableId(`${id}:${report.revision}`)
   const existing=await tx.reportRevision.findUnique({where:{id:revisionId}})
   if(!existing){const current=await tx.topicReport.findUniqueOrThrow({where:{id}});const count=await tx.reportRevision.count({where:{reportId:id}});const version=count?current.latestVersion+1:1
    await tx.reportRevision.create({data:{id:revisionId,reportId:id,version,status:'VALIDATED',card:spec.card,specObjectKey:key,htmlObjectKey:htmlKey}})
    await tx.topicReport.update({where:{id},data:{latestVersion:version}})
   }
  }
  const attachments=snapshot.documents.reduce((n,d)=>n+d.files.filter(f=>f.role==='ATTACHMENT').length,0)
  for(const [stage,total] of [['DISCOVERING_ASSETS',snapshot.documents.filter(d=>d.files.length).length],['DOWNLOADING_ASSETS',attachments],['WRITING_MANIFEST',1]] as const) {
   const data={status:total?'COMPLETED' as const:'SKIPPED' as const,totalItems:total,completedItems:total,failedItems:0,completedAt:new Date()}
   await tx.stageExecution.upsert({where:{scanRunId_stage:{scanRunId:runId,stage}},create:{scanRunId:runId,stage,...data},update:data})
  }
  if(reports.length && !snapshot.failures.some(f=>f.node==='render'||f.node==='compose')) {
   const data={status:'COMPLETED' as const,totalItems:reports.length,completedItems:reports.length,failedItems:0,completedAt:new Date()}
   await tx.stageExecution.upsert({where:{scanRunId_stage:{scanRunId:runId,stage:'GENERATING_REPORTS'}},create:{scanRunId:runId,stage:'GENERATING_REPORTS',...data},update:data})
  }
  const status=snapshot.status==='CANCELLED'?'CANCELLED':snapshot.status==='COMPLETED' && !snapshot.failures.length?'COMPLETED':snapshot.reports.length?'PARTIAL':'FAILED'
  await tx.scanRun.update({where:{id:runId},data:{status,currentStage:'WRITING_MANIFEST',manifestObjectKey:manifestKey,completedAt:new Date(),discoveredDocumentCount:snapshot.documents.length,errorSummary:snapshot.failures.length?'Bazı belgelerin işlenmesi tamamlanamadı. İşlem ayrıntılarını kontrol edin.':null}})
 },{timeout:30000})
}
