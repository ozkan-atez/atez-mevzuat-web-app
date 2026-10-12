import type { PrismaClient } from '@prisma/client'
import { documentAccessWhere, privateResourceWhere, getActorContext, reportAccessWhere } from '../../../platform/actor-context'
import { sourceAccessWhere, templateAccessWhere, sourceProfileAccessWhere } from '../../managed-sources/source-access'
import type { AssistantKnowledge } from '../application/assistant-knowledge'
import { ChatScopeError, type ChatContext, type ChatScopeResolver } from '../application/chat-context'

export class PrismaChatScopeResolver implements ChatScopeResolver {
 constructor(private prisma:PrismaClient,private base:AssistantKnowledge) {}
 async resolve(context:ChatContext) {
  const sourceIds=[...new Set(context.sourceIds)]
  const sources=await this.prisma.source.findMany({where:{AND:[sourceAccessWhere(),{id:{in:sourceIds},isActive:true}]},include:{profiles:{where:sourceProfileAccessWhere(),orderBy:{version:'desc'},take:1}}})
  if(sources.length!==sourceIds.length)throw new ChatScopeError('Seçilen kaynaklardan biri bulunamadı veya erişiminiz yok. Kaynak seçimini güncelleyin.')
  if(sources.some(s=>s.setupStatus!=='READY'))throw new ChatScopeError('Seçilen kaynaklardan biri henüz hazır değil. Kaynaklar sayfasında kurulumu veya erişim bilgilerini kontrol edin.')
  const explicit=[...new Set(context.documentVersionIds)]
  const versions=await this.prisma.documentVersion.findMany({where:{id:{in:explicit},document:documentAccessWhere()},select:{id:true}})
  if(versions.length!==explicit.length)throw new ChatScopeError('Seçilen belge sürümüne erişilemiyor. Belge seçimini güncelleyin.')
  if(context.templateId) {
   const template=await this.prisma.reportTemplate.findFirst({where:{AND:[templateAccessWhere(),{id:context.templateId,isActive:true}]}})
   if(!template)throw new ChatScopeError('Seçilen rapor şablonuna erişilemiyor.')
   if(context.templateRevision && template.revision!==context.templateRevision)throw new ChatScopeError('Şablon güncellendi. Yeni sürümü seçin.')
   const required=await this.prisma.sourceTemplateBinding.findMany({where:{templateId:context.templateId,required:true,source:sourceAccessWhere()},select:{sourceId:true,sectionId:true}})
   const missing=required.filter(binding=>!sourceIds.includes(binding.sourceId))
   if(missing.length)throw new ChatScopeError('Şablondaki şu bölümler için kaynak seçilmelidir: '+missing.map(b=>b.sectionId).join(', '))
  }
  const pinned=await this.prisma.sourceDocument.findMany({where:{sourceId:{in:sourceIds}},select:{documentVersionId:true}})
  const pinnedIds=pinned.map(row=>row.documentVersionId)
  const readablePinned=await this.prisma.documentVersion.count({where:{id:{in:pinnedIds},document:documentAccessWhere()}})
  if(readablePinned!==new Set(pinnedIds).size)throw new ChatScopeError('Kaynağa bağlı belgelerden birine erişiminiz yok.')
  const canReadVersion=async(id:string)=>Boolean(await this.prisma.documentVersion.findFirst({where:{id,document:documentAccessWhere(),OR:[{id:{in:[...explicit,...pinnedIds]}},{document:{sourceId:{in:sourceIds}}}]}}))
  const denied=()=>{throw new ChatScopeError('Bu işlem seçili kaynaklarla sınırlandırılamıyor. İlgili belgeyi seçin veya raporun kendi sohbetini açın.')}
  const sourceKeys=sources.map(s=>s.key)
  const actor=getActorContext()
  const sourceRunAccess=actor?{workspaceId:actor.workspaceId,OR:[{initiatorUserId:actor.userId},{scanRun:{topicReports:{some:reportAccessWhere()}}}]}:{workspaceId:null}
  const canReadCollected=async(documentId:string)=>{
   const row=await this.prisma.collectedDocument.findUnique({where:{id:documentId},select:{externalSourceDocumentId:true,sourceUrl:true}})
   if(!row)return false
   if(row.externalSourceDocumentId)return Boolean(await this.prisma.sourceScanDocument.findFirst({where:{id:row.externalSourceDocumentId,run:{AND:[sourceRunAccess,{sourceId:{in:sourceIds}}]}},select:{id:true}}))
   try{return sourceKeys.includes('resmi-gazete') && /(^|\.)resmigazete\.gov\.tr$/.test(new URL(row.sourceUrl).hostname)}catch{return false}
  }
  const knowledge:AssistantKnowledge={
   listOperationSources:async()=>sources.map(s=>({id:s.id,key:s.key,name:s.name,authorityType:s.authorityType})),
   searchArchiveDocuments:async input=>{
    const rows=await this.prisma.documentVersion.findMany({where:{document:{AND:[documentAccessWhere(),...(input.query?[{title:{contains:input.query,mode:'insensitive' as const}}]:[])]},OR:[{id:{in:[...explicit,...pinnedIds]}},{document:{sourceId:{in:sourceIds}}}]},orderBy:{createdAt:'desc'},take:Math.min(input.limit,50),select:{id:true}})
    return (await Promise.all(rows.map(v=>this.base.getArchiveDocumentVersion?.({versionId:v.id})))).filter((v):v is NonNullable<typeof v>=>Boolean(v))
   },
   getArchiveDocumentVersion:async input=>{if(!await canReadVersion(input.versionId))throw new ChatScopeError('Bu belge seçili kaynakların dışında. + menüsünden belgeyi ekleyin.');return await this.base.getArchiveDocumentVersion?.(input)??null},
   searchManagedSources:async()=>[],getManagedSource:async()=>denied(),
   // Legacy reports can include previous/Tariff evidence without immutable source
   // provenance. Fail closed instead of trusting a matching primary source URL.
   searchReports:async()=>denied(),getReport:async()=>denied(),getAnalysis:async()=>denied(),
   searchDocuments:async input=>{const docs=await this.base.searchDocuments(input);const allowed=await Promise.all(docs.map(d=>canReadCollected(d.documentId)));return docs.filter((_,i)=>allowed[i])},
   getDocumentText:async input=>await canReadCollected(input.documentId)?this.base.getDocumentText(input):denied(),
   listScanRuns:async()=>[],listPreviousSources:async()=>denied(),listDeliveries:async()=>[],listCustomerGroups:async()=>[],listAutomations:async()=>[],
  }
  return {hasFileSources:sources.some(s=>s.kind==='FILES'),evidenceVersionIds:[...new Set([...explicit,...pinnedIds])],context:{...context,sourceIds,documentVersionIds:explicit,sourceProfiles:sources.map(s=>({sourceId:s.id,version:s.profiles[0]?.version??null}))},knowledge,sourceKeys,
   assertOperation:async(input:Record<string,unknown>)=>{
    if(input.templateId&&input.templateId!==context.templateId)throw new ChatScopeError('Rapor şablonunu + menüsündeki kaynak seçimi alanından seçin.')
    const ids=Array.isArray(input.documentVersionIds)?input.documentVersionIds:[]
    if(ids.length>10)throw new ChatScopeError('Bir işlemde en fazla 10 belge incelenebilir. Daha küçük bir belge kaynağı veya tek tek belgeler seçin.')
    for(const id of ids)if(typeof id!=='string'||!await canReadVersion(id))throw new ChatScopeError('İşlem belgesi seçili kaynakların dışında.')
    if(input.sourceId && !sourceIds.includes(String(input.sourceId)))throw new ChatScopeError('İşlem kaynağı seçili kapsamın dışında.')
    if(input.operation==='TARIFF_LOOKUP'&&!sourceKeys.includes('tariff'))throw new ChatScopeError('Tariff kaynağını seçin.')
    if(input.operation==='PREVIOUS_SOURCES')throw new ChatScopeError('Önceki mevzuatı belge olarak ekleyin; seçili kapsam dışında araştırma yapılmaz.')
    if(['BUILD_REPORT','REVISE_ANALYSIS','REVISE_REPORT'].includes(String(input.operation))) {
     for(const id of [input.analysisTaskId,input.reportTaskId].filter(Boolean)) {
      const task=await this.prisma.operationTask.findFirst({where:{id:String(id),...privateResourceWhere()}})
      const parameters=task?.parameters as {documentVersionIds?:string[];sourceId?:string}|undefined
      if(!parameters?.documentVersionIds?.length)denied()
      for(const v of parameters!.documentVersionIds!)if(!await canReadVersion(v))denied()
      if(parameters?.sourceId&&!sourceIds.includes(parameters.sourceId))denied()
     }
    }
    if(input.url) {
     const source=sources.find(s=>s.id===input.sourceId)
     if(!source||new URL(String(input.url)).origin!==new URL(source.baseUrl).origin)throw new ChatScopeError('Bağlantı seçili kaynağın dışında.')
    }
   },
  }
 }
}
