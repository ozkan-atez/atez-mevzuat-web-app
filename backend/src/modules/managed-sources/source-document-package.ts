import type { CapturedSourceFile } from './source-attachments'
/** Metadata describes capture; content describes interpretation. Stored bytes do not imply readable content. */
export function sourceDocumentPackage(document:{id:string;title:string;url:string;publishedOn:Date|null;feedUrl:string;captureStatus:string;captureError:string|null;capturedFiles:unknown;contentText:string|null;filterDecision?:string|null;filterReason?:string|null;processingStatus?:string;topicId?:string|null;reportVersion?:number|null}) {
 const files=(Array.isArray(document.capturedFiles)?document.capturedFiles:[]) as CapturedSourceFile[]
 return {schemaVersion:1,metadata:{id:document.id,title:document.title,sourceUrl:document.url,feedUrl:document.feedUrl,publishedOn:document.publishedOn?.toISOString().slice(0,10)??null,
   captureStatus:document.captureStatus,captureError:document.captureError,files,manualActionRequired:files.some(f=>f.failure?.manualActionRequired)},
   content:{status:document.processingStatus??'PENDING',classification:document.filterDecision??null,classificationReason:document.filterReason??null,
     textPreview:document.contentText,materialDelivery:'ORIGINAL_FILES',analysisReference:document.topicId??null,reportVersion:document.reportVersion??null,
     complete:document.captureStatus==='COMPLETED'&&['COMPLETED','EXCLUDED'].includes(document.processingStatus??'')}}
}
