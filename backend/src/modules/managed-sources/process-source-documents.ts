import type { SourceStage } from './source-stages'
import type { CapturedSourceFile } from './source-attachments'
import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { AiModelClient } from '../ai/application/ai-model-client'
import { executePreviousSourceDiscovery } from '../scan-runs/application/execute-previous-source-discovery'
import type { ObjectStore, OfficialHttp, PreviousSourceSearch } from '../scan-runs/application/ports'
import type { TariffLookup } from '../tariff/tariff-lookup'
import { PrismaScanRepository } from '../scan-runs/infrastructure/prisma-scan-repository'
import { executeDocumentFilter } from '../scan-runs/application/execute-document-filter'
import { PrismaTopicAnalysisRepository } from '../topic-analysis/infrastructure/prisma-topic-analysis-repository'
import { executeTopicAnalysis } from '../topic-analysis/application/execute-topic-analysis'
import { recoverAnalysisForRetry } from '../topic-analysis/application/retry-topic-analysis'
import { publishTopicAnalysis } from '../topic-analysis/application/execute-run-topic-analyses'

export interface SourceProcessingDependencies {
  aiModel: AiModelClient
  http: OfficialHttp
  objectStore: ObjectStore
  model: string
  maxAttempts: number
  maxContentBytes: number
  maxRunBytes: bigint
  onStage?: (stage: SourceStage, status: string, total?: number, completed?: number) => Promise<void>
  previousSourceSearch?: PreviousSourceSearch
  tariffLookup?: TariffLookup
}

/** External feeds have an isolated filter job, but share the persisted topic/report pipeline. */
export async function processSourceDocuments(prisma: PrismaClient, sourceRunId: string, dependencies: SourceProcessingDependencies): Promise<{failures:string[];readyReports:number}> {
  const run = await prisma.sourceScanRun.findUniqueOrThrow({where:{id:sourceRunId},include:{source:true,documents:{orderBy:{id:'asc'}}}})
  if (!run.documents.length) return {failures:[],readyReports:0}
  const pipeline = await prisma.scanRun.upsert({where:{requestKey:`external-processing:${run.id}`},update:{},create:{requestKey:`external-processing:${run.id}`,targetDate:run.targetDate,trigger:run.trigger==='CRON'?'CRON':'MANUAL',sourceKeys:[run.source.key],status:'RUNNING',workspaceConfig:{internalSourceProcessing:Boolean(run.scanRunId),sourceRunId:run.id},indexSourceUrl:run.source.baseUrl,stages:{create:{stage:'AI_FILTERING'}}}})
  await prisma.sourceScanRun.update({where:{id:run.id},data:{processingScanRunId:pipeline.id,reportHtml:null}})
  const parentRunId = run.scanRunId ?? pipeline.id
  const parent = await prisma.scanRun.findUniqueOrThrow({where:{id:parentRunId}})
  const failures:string[]=[]
  for (const [index,document] of run.documents.entries()) {
    if (['PARTIAL','FAILED'].includes(document.captureStatus)) {
      const reason = document.captureError ?? 'Belge ve eklerinin indirilmesi tamamlanmadı.'
      await prisma.sourceScanDocument.update({where:{id:document.id},data:{processingStatus:'FAILED',processingError:reason}})
      failures.push(reason); continue
    }
    const originalFiles=(Array.isArray(document.capturedFiles)?document.capturedFiles:[]) as unknown as CapturedSourceFile[]
    if (!document.contentText?.trim()&&!originalFiles.some(f=>f.status==='STORED'&&f.objectKey&&f.mediaType==='application/pdf')) {
      const reason='Belge metni okunamadığı için AI analizi yapılamadı.'
      await prisma.sourceScanDocument.update({where:{id:document.id},data:{processingStatus:'FAILED',processingError:reason}})
      failures.push(reason);continue
    }
    const bytes=Buffer.from(`Yayın tarihi: ${document.publishedOn?.toISOString().slice(0,10)??'bilinmiyor; tarama tarihi yayın tarihi değildir'}.\n\n${document.contentText??'Özgün belge metin çıkarımı yapılmadan ek olarak sunulmuştur; eklerin tamamını okuyun.'}`)
    const primaryPdf=originalFiles.find(f=>f.role==='DOCUMENT'&&f.status==='STORED'&&f.mediaType==='application/pdf'&&f.objectKey&&f.sha256)
    const stored=await dependencies.objectStore.putRunFile(`external-sources/${run.id}/${document.id}.txt`,bytes,'text/plain')
    const sha256=createHash('sha256').update(bytes).digest('hex')
    const primary=primaryPdf?{sha256:primaryPdf.sha256!,bucket:primaryPdf.bucket!,objectKey:primaryPdf.objectKey!,mediaType:primaryPdf.mediaType!,byteSize:BigInt(primaryPdf.byteSize!)}:{sha256,bucket:stored.bucket,objectKey:stored.objectKey,mediaType:'text/plain',byteSize:BigInt(bytes.length)}
    const object=await prisma.storedObject.upsert({where:{sha256:primary.sha256},update:{},create:primary})
    // Content deduplication may reuse an object key from an earlier capture. Restore missing bytes at that canonical key.
    if (!await dependencies.objectStore.exists(object.objectKey)) await dependencies.objectStore.putRunFile(object.objectKey,primaryPdf?await dependencies.objectStore.getContent(primaryPdf.objectKey!):bytes,object.mediaType)
    const editionUrl=`${run.source.baseUrl}#publication=${document.publishedOn?.toISOString().slice(0,10)??'unknown'}`
    const edition=await prisma.gazetteEdition.upsert({where:{scanRunId_indexUrl:{scanRunId:pipeline.id,indexUrl:editionUrl}},update:{},create:{scanRunId:pipeline.id,indexUrl:editionUrl,publicationDate:document.publishedOn??run.targetDate,type:'EXTERNAL',discoveryOrder:index}})
    const collected = await prisma.collectedDocument.upsert({where:{externalSourceDocumentId:document.id},update:{},create:{externalSourceDocumentId:document.id,sourceAuthority:run.source.authorityType,sourceName:run.source.name??run.source.key,editionId:edition.id,title:document.title,sourceUrl:document.url,publicationOrder:index,storedObjectId:object.id,validationStatus:'VALID'}})
    for (const file of (Array.isArray(document.capturedFiles) ? document.capturedFiles : []) as unknown as CapturedSourceFile[]) {
      if(file.status !== 'STORED' || !file.objectKey || !file.sha256 || !file.mediaType || !file.byteSize || !file.bucket) continue
      if(!['application/pdf','text/html','text/plain','image/png','image/jpeg','image/gif','image/webp'].includes(file.mediaType)) continue
      const assetObject = await prisma.storedObject.upsert({where:{sha256:file.sha256},update:{},create:{sha256:file.sha256,bucket:file.bucket,objectKey:file.objectKey,mediaType:file.mediaType,byteSize:BigInt(file.byteSize)}})
      if (!await dependencies.objectStore.exists(assetObject.objectKey)) await dependencies.objectStore.putRunFile(assetObject.objectKey,await dependencies.objectStore.getContent(file.objectKey),file.mediaType)
      await prisma.documentAsset.upsert({where:{documentId_sourceUrl:{documentId:collected.id,sourceUrl:file.url}},update:{storedObjectId:assetObject.id,validationStatus:'VALID'},create:{documentId:collected.id,sourceUrl:file.url,referenceText:file.title,role:file.role==='IMAGE'?'IMAGE':'ATTACHMENT',storedObjectId:assetObject.id,validationStatus:'VALID'}})
    }
    if (document.processingStatus !== 'COMPLETED') await prisma.sourceScanDocument.update({where:{id:document.id},data:{processingStatus:'FILTERING',processingError:null}})
  }
  const filterDocuments=await prisma.collectedDocument.count({where:{edition:{scanRunId:pipeline.id}}})
  if (!filterDocuments) {
    await prisma.scanRun.update({where:{id:pipeline.id},data:{status:'FAILED',completedAt:new Date(),errorSummary:failures.join('; ').slice(0,500)}})
    return {failures,readyReports:0}
  }
  const scanRepository=new PrismaScanRepository(prisma)
  const topicRepository=new PrismaTopicAnalysisRepository(prisma)
  const completedFilter=await prisma.aiJob.findUnique({where:{scanRunId_kind:{scanRunId:pipeline.id,kind:'DOCUMENT_FILTER'}}})
  if(completedFilter?.status === 'COMPLETED' && await prisma.documentFilterDecision.count({where:{aiJobId:completedFilter.id,finalDecision:{not:null}}}) !== filterDocuments) {
    await prisma.aiJob.update({where:{id:completedFilter.id},data:{status:'QUEUED',completedAt:null}})
  }
  try {
    await dependencies.onStage?.('FILTER','RUNNING',filterDocuments,0)
    await executeDocumentFilter(pipeline.id,{...dependencies,repository:scanRepository})
  } catch (error) {
    const job = await prisma.aiJob.findUnique({ where: { scanRunId_kind: { scanRunId: pipeline.id, kind: 'DOCUMENT_FILTER' } } })
    const reason = job?.lastErrorCategory === 'PROVIDER_UNAVAILABLE'
      ? 'AI hizmeti geçici olarak kullanılamıyor. Rapor oluşturulmadı; daha sonra yeniden deneyebilirsiniz.'
      : job?.lastErrorCategory === 'TIMEOUT' ? 'AI değerlendirmesi zaman aşımına uğradı. Yeniden deneyebilirsiniz.'
      : job?.lastErrorMessage ?? (error instanceof Error ? error.message : 'AI filtresi tamamlanamadı.')
    await prisma.sourceScanDocument.updateMany({where:{runId:run.id,processingStatus:'FILTERING'},data:{processingStatus:'FAILED',processingError:reason}})
    await prisma.scanRun.update({where:{id:pipeline.id},data:{status:'FAILED',errorSummary:reason}})
    throw new Error(reason)
  }
  await dependencies.onStage?.('FILTER','COMPLETED',filterDocuments,filterDocuments)
  const datedIds=run.documents.filter(d=>d.publishedOn).map(d=>d.id)
  const datedDocuments=await prisma.collectedDocument.findMany({where:{edition:{scanRunId:pipeline.id},externalSourceDocumentId:{in:datedIds}},select:{id:true}})
  if(dependencies.previousSourceSearch && datedDocuments.length) {
    await dependencies.onStage?.('PREVIOUS_SOURCES','RUNNING',datedDocuments.length,0)
    await executePreviousSourceDiscovery(pipeline.id,{repository:scanRepository,aiModel:dependencies.aiModel,search:dependencies.previousSourceSearch,http:dependencies.http,objectStore:dependencies.objectStore,model:dependencies.model,maxAttempts:dependencies.maxAttempts,concurrency:2,maxRunBytes:dependencies.maxRunBytes,documentIds:datedDocuments.map(d=>d.id)})
    await dependencies.onStage?.('PREVIOUS_SOURCES','COMPLETED',datedDocuments.length,datedDocuments.length)
  } else await dependencies.onStage?.('PREVIOUS_SOURCES','SKIPPED')
  await dependencies.onStage?.('ANALYSIS','RUNNING',filterDocuments,0)
  const decisions=await prisma.documentFilterDecision.findMany({where:{document:{edition:{scanRunId:pipeline.id}}},include:{document:true}})
  let readyReports=0
  for (const decision of decisions) {
    const documentId=decision.document.externalSourceDocumentId!
    if(run.documents.some(item=>item.id===documentId && ['PARTIAL','FAILED'].includes(item.captureStatus))) continue
    const reason=decision.contentReason??decision.titleReason
    await prisma.sourceScanDocument.update({where:{id:documentId},data:{filterDecision:decision.finalDecision,filterReason:reason}})
    if(decision.finalDecision!=='IN') {
      await prisma.sourceScanDocument.update({where:{id:documentId},data:{processingStatus:'EXCLUDED',processingError:null}});continue
    }
    const topic=await prisma.topicProcess.upsert({where:{documentId:decision.documentId},update:{},create:{documentId:decision.documentId,scanRunId:parentRunId,evidenceBundle:{create:{}},thread:{create:{title:decision.document.title}}}})
    await prisma.sourceScanDocument.update({where:{id:documentId},data:{topicId:topic.id,processingStatus:'ANALYZING',processingError:null}})
    try {
      const existing=await topicRepository.getTopicDetail(topic.id)
      if(existing?.reportVersion && existing.status==='COMPLETED') {
        await prisma.sourceScanDocument.update({where:{id:documentId},data:{processingStatus:'COMPLETED',reportVersion:existing.reportVersion}});readyReports++;continue
      }
      if (existing?.status === 'COMPLETED' && existing.latestAnalysis?.status === 'PASS_NO_RELEVANT_CONTENT') {
        await prisma.sourceScanDocument.update({where:{id:documentId},data:{processingStatus:'EXCLUDED',filterReason:'AI analizi raporlanabilir değişiklik bulamadı.'}});continue
      }
      const topicDependencies={repository:topicRepository,objectStore:dependencies.objectStore,aiModel:dependencies.aiModel,model:dependencies.model,maxAttempts:dependencies.maxAttempts,maxContextBytes:dependencies.maxContentBytes,...(dependencies.tariffLookup?{tariffLookup:dependencies.tariffLookup}:{})}
      const output=existing ? await recoverAnalysisForRetry(existing,topicDependencies) : await executeTopicAnalysis(topic.id,topicDependencies)
      if(output.analysis.status!=='PASS') {
        await topicRepository.markTopicCompleted(topic.id)
        await prisma.sourceScanDocument.update({where:{id:documentId},data:{processingStatus:'EXCLUDED',filterReason:'AI analizi raporlanabilir değişiklik bulamadı.'}});continue
      }
      const sequence=await topicRepository.getTopicSequence(topic.id)
      const report=await publishTopicAnalysis({runId:parentRunId,targetDate:run.targetDate.toISOString().slice(0,10),indexSourceUrl:run.source.baseUrl,indexObjectKey:'',inspectedDocumentCount:run.documents.length,workspaceConfig:parent.workspaceConfig,sourceOrigin:{name:run.source.name??run.source.key,authority:run.source.authorityType,...(!run.documents.find(d=>d.id===documentId)?.publishedOn?{publicationDateKnown:false}:{})}},output,sequence,{repository:topicRepository,objectStore:dependencies.objectStore,aiModel:dependencies.aiModel,model:dependencies.model})
      await topicRepository.markTopicCompleted(topic.id)
      await prisma.sourceScanDocument.update({where:{id:documentId},data:{processingStatus:'COMPLETED',reportVersion:report.version,processingError:null}})
      readyReports++
    }catch(error){
      const message=error instanceof Error?error.message:'Belge analizi tamamlanamadı.'
      await prisma.sourceScanDocument.update({where:{id:documentId},data:{processingStatus:'FAILED',processingError:message.slice(0,500)}})
      failures.push(`${decision.document.title}: ${message}`)
    }
  }
  await dependencies.onStage?.('ANALYSIS',failures.length?'PARTIAL':'COMPLETED',decisions.length,decisions.length)
  await dependencies.onStage?.('REPORT',failures.length?'PARTIAL':'COMPLETED',readyReports,readyReports)
  await prisma.scanRun.update({where:{id:pipeline.id},data:{status:failures.length?(readyReports?'PARTIAL':'FAILED'):'COMPLETED',completedAt:new Date(),errorSummary:failures.length?failures.join('; ').slice(0,500):null}})
  return {failures,readyReports}
}
