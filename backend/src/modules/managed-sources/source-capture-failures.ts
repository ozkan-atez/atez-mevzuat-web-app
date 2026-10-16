import type { PrismaClient } from '@prisma/client'
import { BackgroundTaskError } from '../../platform/background-error'
import type { CapturedSourceFile } from './source-attachments'
export async function sourceCaptureFailure(prisma:PrismaClient,runIds:string[]):Promise<BackgroundTaskError|null> {
 if(!runIds.length)return null
 const documents=await prisma.sourceScanDocument.findMany({where:{runId:{in:runIds},OR:[{captureStatus:{in:['FAILED','PARTIAL']}},{processingStatus:'FAILED'}]},select:{id:true,runId:true,url:true,capturedFiles:true,processingError:true}})
 const failures=documents.flatMap(d=>(Array.isArray(d.capturedFiles)?d.capturedFiles as unknown as CapturedSourceFile[]:[]).filter(f=>f.status==='FAILED').map(f=>({runId:d.runId,documentId:d.id,documentUrl:d.url,...f.failure,url:f.url,message:f.error})))
 for(const d of documents)if(d.processingError&&/içerik sınırı|bağlam sınırı/.test(d.processingError))failures.push({runId:d.runId,documentId:d.id,documentUrl:d.url,url:d.url,code:'MODEL_INPUT_TOO_LARGE',retryable:false,manualActionRequired:true,limitBytes:null,observedBytes:null,message:d.processingError})
 if(!failures.length)return null
 const manual=failures.some(f=>f.manualActionRequired)
 return new BackgroundTaskError(`${manual?'Elle müdahale gerekli':'Belge indirilemedi'}: ${failures.map(f=>`${f.url}: ${f.message}`).join('; ')}`,
  manual?'SOURCE_MANUAL_ACTION_REQUIRED':'SOURCE_CAPTURE_FAILED',!manual,{runIds,failures})
}
