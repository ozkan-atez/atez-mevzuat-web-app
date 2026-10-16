import {it,expect,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {captureSourceDocument} from '../../src/modules/managed-sources/source-attachments'
import {SourceSizeLimitError} from '../../src/modules/managed-sources/capture-error'
import {sourceCaptureFailure} from '../../src/modules/managed-sources/source-capture-failures'
import {sourceDocumentPackage} from '../../src/modules/managed-sources/source-document-package'
import {executeDocumentFilter} from '../../src/modules/scan-runs/application/execute-document-filter'
import {samplePdf} from '../helpers/sample-pdf'
const store={putRunFile:vi.fn(async(key:string,body:Buffer,mediaType:string)=>({objectKey:key,bucket:'test',sha256:createHash('sha256').update(body).digest('hex'),byteSize:BigInt(body.length),mediaType}))}
it('özgün PDFyi metin katmanı okumadan saklar',async()=>{
 const capture=await captureSourceDocument('https://ticaret.gov.tr/doc.pdf','https://ticaret.gov.tr',store,[],100000,async()=>({body:samplePdf(),contentType:'application/pdf'}),{extractPdfText:false})
 expect(capture.status).toBe('COMPLETED');expect(capture.contentText).toBeNull();expect(capture.files[0]?.mediaType).toBe('application/pdf')
})
it('boyut hatasını dosya ve sınır bilgisiyle elle müdahaleye ayırır',async()=>{
 const url='https://ticaret.gov.tr/large.pdf'
 const capture=await captureSourceDocument(url,'https://ticaret.gov.tr',store,[],100_000_000,async()=>{throw new SourceSizeLimitError(url,25_000_000,30_319_015)})
 expect(capture.files[0]?.failure).toMatchObject({code:'DOCUMENT_TOO_LARGE',retryable:false,manualActionRequired:true,limitBytes:25_000_000,observedBytes:30_319_015})
 const prisma={sourceScanDocument:{findMany:vi.fn().mockResolvedValue([{id:'d',runId:'r',url,capturedFiles:capture.files}])}}
 const failure=await sourceCaptureFailure(prisma as any,['r']);expect(failure?.retryable).toBe(false);expect(failure?.details.failures).toHaveLength(1)
})
it('pakette indirme başarısını analiz başarısı sanmaz',()=>{
 const pack=sourceDocumentPackage({id:'d',title:'PDF',url:'https://ticaret.gov.tr/doc.pdf',feedUrl:'https://ticaret.gov.tr',publishedOn:null,captureStatus:'COMPLETED',captureError:null,capturedFiles:[],contentText:null})
 expect(pack.metadata.publishedOn).toBeNull();expect(pack.content.complete).toBe(false);expect(pack.content.materialDelivery).toBe('ORIGINAL_FILES')
})
it('başlık OUT olsa bile harici belgenin PDF ekini içerik filtresine verir',async()=>{
 let titleSaved=false,contentSaved=false
 const repo:any={listFilterDocuments:vi.fn().mockResolvedValue([{id:'d',title:'Duyuru',sourceUrl:'https://ticaret.gov.tr/a',publicationOrder:1,editionLabel:'Ticaret',requireContentReview:true,storedObject:{objectKey:'html',mediaType:'text/plain',sha256:'a'},assets:[{sourceUrl:'https://ticaret.gov.tr/ek.pdf',objectKey:'pdf',mediaType:'application/pdf',sha256:'b'}]}]),getOrCreateDocumentFilterJob:vi.fn().mockResolvedValue({id:'j',status:'QUEUED'}),markFilterRunning:vi.fn(),getFilterProgress:vi.fn(async()=>({titleDecidedCount:titleSaved?1:0,unresolvedDocumentIds:titleSaved&&!contentSaved?['d']:[],finalCounts:{pending:contentSaved?0:1}})),saveTitleDecisions:vi.fn(async()=>{titleSaved=true}),saveContentDecisions:vi.fn(async()=>{contentSaved=true}),completeFilter:vi.fn(),nextAiCallAttempt:vi.fn().mockResolvedValue(1),startAiCall:vi.fn().mockResolvedValue({id:'c'}),completeAiCall:vi.fn(),failAiCall:vi.fn(),markFilterAwaitingRetry:vi.fn()}
 const ai:any={generateStructured:vi.fn().mockResolvedValue({json:{decisions:[{documentId:'d',decision:'OUT',reason:'Kapsam dışı',confidence:0.9}]},providerRequestId:null,usage:{inputTokens:1,outputTokens:1}})}
 await executeDocumentFilter('r',{repository:repo,aiModel:ai,http:{} as any,objectStore:{getContent:async(k:string)=>k==='pdf'?samplePdf():Buffer.from('Haber metni')} as any,model:'test',maxAttempts:1,maxContentBytes:100_000,maxRunBytes:100_000n})
 expect(repo.saveTitleDecisions.mock.calls[0][1][0].decision).toBe('MAYBE')
 expect(ai.generateStructured).toHaveBeenCalledTimes(2)
 expect(ai.generateStructured.mock.calls[1][0].parts.some((p:any)=>p.inlineData?.mimeType==='application/pdf')).toBe(true)
})
