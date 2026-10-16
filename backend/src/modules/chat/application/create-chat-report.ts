import { z } from 'zod'
import { normalizeTurkish } from './resolve-date'
import type { AssistantKnowledge } from './assistant-knowledge'
import type { ChatMessageView } from './ports'

export class ChatReportError extends Error {}
export const ChatEvidenceSchema=z.object({id:z.string(),title:z.string(),url:z.string().nullable(),text:z.string().min(1),publishedOn:z.string().nullable()})
export type ChatEvidence=z.infer<typeof ChatEvidenceSchema>
export interface ChatContext {sourceIds?:string[];templateId?:string;evidence?:ChatEvidence[];warnings?:string[]}
export interface SavedChatReport {reportId:string;title:string;url:string;operationRequestId:string}
export interface QueuedChatReports {expectedCount:number;operationRequestIds:string[];reports:SavedChatReport[];pending:boolean}
export interface ChatReportCreator {
  create(input:{sessionId:string;messageId:string;instruction:string;templateId?:string;evidence:ChatEvidence[];warnings:string[];signal?:AbortSignal}):Promise<SavedChatReport | QueuedChatReports>
}
export function wantsChatReport(content:string):boolean {
  const t=normalizeTurkish(content).replace(/\brapro\w*/g, 'rapor').replace(/\bolust[su]?[au]m\w*/g, 'olustur')
  if(/\b(?:istemiyorum|istemem|olusturmay\w*|hazirlamay\w*|kaydetmey\w*|olusturma|hazirlama|kaydetme|ekleme|yapma|nasil|ne gerekli|sadece sohbet|yalnizca sohbet)\b/.test(t))return false
  return /\b(?:rapor\w*|bulten\w*|html)\b/.test(t)&&/\b(?:olustur\w*|hazirla\w*|uret\w*|kaydet\w*|ekle\w*|donustur\w*|raporlastir\w*|haline getir\w*)\b/.test(t)
}
export function scrapedEvidence(value:unknown):{evidence:ChatEvidence[];warnings:string[]} {
  const parsed=z.object({documents:z.array(z.object({title:z.string(),url:z.string(),text:z.string(),publishedOn:z.string().nullable()})),warnings:z.array(z.string()).default([])}).safeParse(value)
  return parsed.success?{evidence:parsed.data.documents.filter(d=>d.text.trim()).map(d=>({...d,id:d.url})),warnings:parsed.data.warnings}:{evidence:[],warnings:['Kaynak içeriği doğrulanamadı.']}
}
const urls=(text:string)=>[...new Set(text.match(/https:\/\/[^\s<>"\])]+/g)??[])].map(u=>u.replace(/[.,;]+$/,''))
export async function gatherReportEvidence(input:{content:string;sourceIds?:string[];documentVersionIds?:string[];signal?:AbortSignal; prepareDocument?:(versionId:string)=>Promise<void>},history:ChatMessageView[],knowledge:AssistantKnowledge) {
  const evidence:ChatEvidence[]=[];const warnings:string[]=[]
  const explicit=Boolean(input.sourceIds?.length||input.documentVersionIds?.length||urls(input.content).length)
  const last=history.filter(m=>m.role==='ASSISTANT'&&m.status==='COMPLETED').at(-1)
  if(!explicit&&last?.context?.evidence?.length){evidence.push(...last.context.evidence);warnings.push(...last.context.warnings??[])}
  for(const id of input.sourceIds??[]){
    input.signal?.throwIfAborted()
    const result=scrapedEvidence(await knowledge.scrapeChatSource?.({id,query:input.content,...(input.signal?{signal:input.signal}:{})}))
    if(!result.evidence.length)throw new ChatReportError('Seçili kaynakta rapora temel olacak okunabilir belge bulunamadı. Tarih ve kaynak kapsamını kontrol edin.')
    evidence.push(...result.evidence);warnings.push(...result.warnings)
  }
  const versions=input.documentVersionIds?.length?input.documentVersionIds:!explicit&&!evidence.length?history.filter(m=>m.role==='USER'&&m.documentVersionIds?.length).at(-1)?.documentVersionIds:[]
  for(const versionId of versions??[]){
    input.signal?.throwIfAborted()
    let d=await knowledge.getArchiveDocumentVersion?.({versionId})
    if(d && !d.text?.trim() && input.prepareDocument){
      await input.prepareDocument(versionId)
      input.signal?.throwIfAborted()
      d=await knowledge.getArchiveDocumentVersion?.({versionId})
    }
    if(!d?.text?.trim())throw new ChatReportError('Belgeden eksiksiz okunabilir metin elde edilemedi. Daha net veya tam belge gerekli; rapor oluşturulmadı.')
    evidence.push({id:versionId,title:d.title,url:d.sourceUrl,text:d.text,publishedOn:d.publishedOn})
  }
  // Legacy chats did not store evidence. Their URLs are discovery hints only:
  // read the real page again; never treat an old model answer as source evidence.
  const links=urls(input.content).length?urls(input.content):!explicit&&!evidence.length?urls(last?.content??''):[]
  if(links.length>10)throw new ChatReportError('Tek raporda en fazla 10 doğrudan kaynak bağlantısı kullanın.')
  for(const url of links){
    input.signal?.throwIfAborted()
    const d=await knowledge.readChatUrl?.(url)
    if(!d?.text?.trim())throw new ChatReportError('Kaynak bağlantısının içeriği okunamadı; rapor kaydedilmedi.')
    evidence.push(d)
    warnings.push('Doğrudan bağlantının sayfa metni okundu; bağlantılı ek belgeler ayrıca taranmadı.')
  }
  if(!evidence.length)throw new ChatReportError('Rapor oluşturmak için bir kaynak veya belge seçin ya da kaynak bağlantısını paylaşın.')
  const unique=[...new Map(evidence.map(d=>[d.id,{...d,text:d.text.replace(/\s+/g,' ').trim()}])).values()]
  if(unique.reduce((n,d)=>n+d.text.length,0)>250000)throw new ChatReportError('Kaynaklar tek raporun içerik sınırını aşıyor; daha az belge seçin.')
  return {evidence:unique,warnings:[...new Set(warnings)]}
}
