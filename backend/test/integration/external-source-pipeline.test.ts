import {samplePdf} from '../helpers/sample-pdf'
import {createHash,randomUUID} from 'node:crypto'
import {PrismaClient} from '@prisma/client'
import {afterEach,describe,expect,it} from 'vitest'
import type {AiModelClient,StructuredAiRequest} from '../../src/modules/ai/application/ai-model-client'
import {AiProviderError} from '../../src/modules/ai/domain/ai-errors'
import type {ObjectStore} from '../../src/modules/scan-runs/application/ports'
import {processSourceDocuments,type SourceProcessingDependencies} from '../../src/modules/managed-sources/process-source-documents'
import {PrismaTopicAnalysisRepository} from '../../src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'

if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.includes('test')) throw new Error('External source integration tests require an explicitly configured test database.')
const prisma=new PrismaClient()
const sourceIds:string[]=[]
const runIds:string[]=[]
const objects=new Map<string,Buffer>()
const store:ObjectStore={ensureBucket:async()=>{},exists:async key=>objects.has(key),getContent:async key=>{const body=objects.get(key);if(!body)throw new Error(key);return body},putContent:async()=>{throw new Error('Snapshots must use stored source text')},putRunFile:async(key,body,mediaType)=>{objects.set(key,body);return {bucket:'test',objectKey:key,sha256:createHash('sha256').update(body).digest('hex'),mediaType,byteSize:BigInt(body.length)}}}
class Model implements AiModelClient {
  filterCalls=0;contentCalls=0;analysisCalls=0; unavailable=false
  async generateStructured(request:StructuredAiRequest) {
    if(this.unavailable)throw new AiProviderError('PROVIDER_UNAVAILABLE',true,'AI kullanılamıyor')
    const serialized=request.parts.map(part=>'text' in part?part.text:'').join('\n')
    let json:unknown
    const decide=(doc:{id:string;title:string})=>({documentId:doc.id,decision:doc.title.startsWith('Kapsam dışı')?'OUT':'IN',reason:'AI kapsam değerlendirmesi',confidence:0.95})
    if(request.responseJsonSchema.properties && 'decisions' in (request.responseJsonSchema.properties as object)) {
      const first=request.parts[0] && 'text' in request.parts[0]?request.parts[0].text:''
      if(first.trimStart().startsWith('{')) {
        // Title pass: one JSON list of every captured document.
        this.filterCalls++
        const input=JSON.parse(first) as {documents:Array<{id:string;title:string}>}
        json={decisions:input.documents.map(decide)}
      } else {
        // Content pass: external documents are always read in full (title verdicts become MAYBE).
        this.contentCalls++
        const documents=new Map<string,string>()
        for(const match of serialized.matchAll(/Belge kimliği: (\S+)\nBaşlık: ([^\n]*)/g))if(!documents.has(match[1]!))documents.set(match[1]!,match[2]!)
        json={decisions:[...documents].map(([id,title])=>decide({id,title}))}
      }
    } else {
      this.analysisCalls++
      const topicId=serialized.match(/Topic kimliği: ([a-f0-9-]+)/)?.[1]
      const url=serialized.match(/Kaynak URL: (https?:[^\s]+)/)?.[1]??'https://example.test/doc'
      json={schemaVersion:1,topicId,status:'PASS',document:{title:'İthalat duyurusu',gazetteDate:'2026-10-08',gazetteNumber:'Kaynak',sourceUrl:url},change:{type:'ANNOUNCEMENT',detailedAnalysis:'İthalat başvuru usulü açıklandı.',summary:'Başvuru usulü açıklandı.',operationalImpact:'Başvuru belgeleri hazırlanır.'},affectedParties:[],effectiveDates:[],comparisons:[],tables:[],officialSources:[{id:'source',label:'Kaynak',url,evidenceIds:['evidence']}],supportingSources:[],evidence:[{id:'evidence',objectKey:'source.txt',locator:'paragraph:1'}],unresolvedReferences:[],emailTitle:'Başvuru usulü',emailSummary:'Belgeler hazırlanır.'}
    }
    return {json,providerRequestId:'test',usage:{inputTokens:10,outputTokens:10}}
  }
}
function dependencies(model:Model):SourceProcessingDependencies{return {aiModel:model,http:{download:async()=>{throw new Error('External documents must use captured content')}},objectStore:store,model:'test',maxAttempts:1,maxContentBytes:1000000,maxRunBytes:10000000n}}
async function seed(authority='PROFESSIONAL',parent=false) {
  const source=await prisma.source.create({data:{key:`test-${randomUUID()}`,name:'Dış Kaynak',baseUrl:'https://example.test/',authorityType:authority}})
  sourceIds.push(source.id)
  const parentRun=parent?await prisma.scanRun.create({data:{requestKey:`external-test-parent:${randomUUID()}`,targetDate:new Date('2026-10-08'),status:'COMPLETED'}}):null
  if(parentRun)runIds.push(parentRun.id)
  const run=await prisma.sourceScanRun.create({data:{sourceId:source.id,scanRunId:parentRun?.id??null,requestKey:randomUUID(),targetDate:new Date('2026-10-08'),status:'RUNNING'}})
  return {source,run,parentRun}
}
async function document(runId:string,title='İthalat duyurusu',contentText:string|null='Başvuru usulü açıklandı.') {return prisma.sourceScanDocument.create({data:{runId,title,url:`https://example.test/${randomUUID()}`,publishedOn:new Date('2026-10-08'),feedUrl:'https://example.test/',contentText}})}
afterEach(async()=>{
  const runs=await prisma.sourceScanRun.findMany({where:{sourceId:{in:sourceIds}},select:{processingScanRunId:true}})
  await prisma.sourceScanRun.deleteMany({where:{sourceId:{in:sourceIds}}})
  await prisma.scanRun.deleteMany({where:{id:{in:[...runIds,...runs.flatMap(run=>run.processingScanRunId?[run.processingScanRunId]:[])]}}})
  await prisma.source.deleteMany({where:{id:{in:sourceIds}}})
  sourceIds.length=0;runIds.length=0;objects.clear()
})

describe('external source AI pipeline',()=>{
  it('filters IN/OUT then persists an analyzed K5 report and actual parent topic, without touching Gazette AI jobs',async()=>{
    const {run,parentRun}=await seed('PROFESSIONAL',true)
    const sentinel=await prisma.aiJob.create({data:{scanRunId:parentRun!.id,kind:'DOCUMENT_FILTER',status:'COMPLETED',model:'gazette',titlePromptVersion:'v',contentPromptVersion:'v',configurationHash:'a'.repeat(64)}})
    const included=await document(run.id)
    const excluded=await document(run.id,'Kapsam dışı spor haberi')
    const model=new Model()
    const result=await processSourceDocuments(prisma,run.id,dependencies(model))
    expect(result).toEqual({readyReports:1,failures:[]})
    const inDoc=await prisma.sourceScanDocument.findUniqueOrThrow({where:{id:included.id}})
    const outDoc=await prisma.sourceScanDocument.findUniqueOrThrow({where:{id:excluded.id}})
    expect(inDoc).toMatchObject({filterDecision:'IN',processingStatus:'COMPLETED',reportVersion:1})
    expect(outDoc).toMatchObject({filterDecision:'OUT',processingStatus:'EXCLUDED',topicId:null,reportVersion:null})
    expect(await prisma.topicProcess.findUnique({where:{id:inDoc.topicId!}})).toMatchObject({scanRunId:parentRun!.id,status:'COMPLETED'})
    const report=await prisma.topicReport.findUniqueOrThrow({where:{topicId:inDoc.topicId!},include:{revisions:true}})
    expect(report.card).toBe('K5')
    const html=objects.get(report.revisions[0]!.htmlObjectKey)!.toString()
    expect(html).toContain('Dış Kaynak · Destekleyici kaynak')
    expect(html).not.toContain('Sayılı Resmî Gazete')
    expect(await prisma.aiJob.findUnique({where:{id:sentinel.id}})).toMatchObject({model:'gazette',status:'COMPLETED'})
    expect(await new PrismaTopicAnalysisRepository(prisma).ensureTopics(parentRun!.id)).toEqual([])
    await processSourceDocuments(prisma,run.id,dependencies(model))
    expect(await prisma.topicReport.count({where:{topicId:inDoc.topicId!}})).toBe(1)
    expect(await prisma.analysisRevision.count({where:{topicId:inDoc.topicId!}})).toBe(1)
    expect(model.filterCalls).toBe(1);expect(model.contentCalls).toBe(1);expect(model.analysisCalls).toBe(1)
  })
  it('creates an actual standalone scan and truthful official source report',async()=>{
    const {run}=await seed('OFFICIAL')
    const doc=await document(run.id)
    expect((await processSourceDocuments(prisma,run.id,dependencies(new Model()))).failures).toEqual([])
    const updated=await prisma.sourceScanRun.findUniqueOrThrow({where:{id:run.id}})
    const linked=await prisma.sourceScanDocument.findUniqueOrThrow({where:{id:doc.id}})
    expect(updated.scanRunId).toBeNull()
    expect(await prisma.topicProcess.findUnique({where:{id:linked.topicId!}})).toMatchObject({scanRunId:updated.processingScanRunId})
    const report=await prisma.topicReport.findUniqueOrThrow({where:{topicId:linked.topicId!},include:{revisions:true}})
    expect(report.card).toBe('K1')
    expect(objects.get(report.revisions[0]!.htmlObjectKey)!.toString()).toContain('Dış Kaynak · Resmî kaynak')
  })
  it('fails clearly when AI is unavailable, then retry succeeds without unfiltered reports',async()=>{
    const {run}=await seed()
    const doc=await document(run.id)
    const model=new Model();model.unavailable=true
    await expect(processSourceDocuments(prisma,run.id,dependencies(model))).rejects.toThrow()
    expect(await prisma.sourceScanDocument.findUnique({where:{id:doc.id}})).toMatchObject({processingStatus:'FAILED',topicId:null,filterDecision:null})
    model.unavailable=false
    expect((await processSourceDocuments(prisma,run.id,dependencies(model))).failures).toEqual([])
    expect(await prisma.sourceScanDocument.findUnique({where:{id:doc.id}})).toMatchObject({processingStatus:'COMPLETED',reportVersion:1})
  })
  it('terminates the processing scan when every captured document has no content',async()=>{
    const {run}=await seed()
    await document(run.id,'Okunamayan belge',null)
    const result=await processSourceDocuments(prisma,run.id,dependencies(new Model()))
    expect(result.failures).toHaveLength(1)
    const updated=await prisma.sourceScanRun.findUniqueOrThrow({where:{id:run.id}})
    expect(await prisma.scanRun.findUnique({where:{id:updated.processingScanRunId!}})).toMatchObject({status:'FAILED'})
  })
  it('reopens a completed filter job if new snapshot documents are explicitly appended',async()=>{
    const {run}=await seed()
    const model=new Model()
    const first=await document(run.id)
    await processSourceDocuments(prisma,run.id,dependencies(model))
    const next=await document(run.id)
    expect((await processSourceDocuments(prisma,run.id,dependencies(model))).failures).toEqual([])
    expect(model.filterCalls).toBe(2)
    expect(await prisma.sourceScanDocument.findUnique({where:{id:next.id}})).toMatchObject({filterDecision:'IN',processingStatus:'COMPLETED',reportVersion:1})
    const original=await prisma.sourceScanDocument.findUniqueOrThrow({where:{id:first.id}})
    expect(await prisma.reportRevision.count({where:{report:{topicId:original.topicId!}}})).toBe(1)
  })
  it('links captured PDF/image originals into the actual analysis evidence instead of only storing page text',async()=>{
    const {run}=await seed('OFFICIAL');const doc=await document(run.id)
    const entries=[]
    for(const [name,bytes,mime] of [['annex.pdf',samplePdf(),'application/pdf'],['diagram.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2QAAAAASUVORK5CYII=','base64'),'image/png']] as const){
      const blob=await store.putRunFile(name,bytes,mime);entries.push({url:`https://example.test/${name}`,title:name,role:mime.startsWith('image/')?'IMAGE':'ATTACHMENT',status:'STORED',bucket:blob.bucket,objectKey:blob.objectKey,sha256:blob.sha256,mediaType:mime,byteSize:bytes.length})
    }
    await prisma.sourceScanDocument.update({where:{id:doc.id},data:{captureStatus:'COMPLETED',capturedFiles:entries}})
    const result=await processSourceDocuments(prisma,run.id,dependencies(new Model()))
    expect(result.readyReports).toBe(1)
    const collected=await prisma.collectedDocument.findUniqueOrThrow({where:{externalSourceDocumentId:doc.id},include:{assets:{include:{storedObject:true}}}})
    expect(collected.assets.map(asset=>asset.storedObject?.mediaType).sort()).toEqual(['application/pdf','image/png'])
    const topic=await prisma.topicProcess.findUniqueOrThrow({where:{documentId:collected.id},include:{evidenceBundle:true}})
    const manifest=JSON.parse(objects.get(topic.evidenceBundle!.manifestObjectKey!)!.toString())
    expect(manifest.parts.map((part:any)=>part.mediaType)).toContain('application/pdf')
    expect(manifest.parts.map((part:any)=>part.mediaType)).toContain('image/png')
  })
  it('does not publish a report when document annex capture is incomplete',async()=>{
    const {run}=await seed();const doc=await document(run.id)
    await prisma.sourceScanDocument.update({where:{id:doc.id},data:{captureStatus:'PARTIAL',captureError:'PDF eki HTTP 404'}})
    const model=new Model();const result=await processSourceDocuments(prisma,run.id,dependencies(model))
    expect(result.readyReports).toBe(0);expect(model.analysisCalls).toBe(0)
    expect((await prisma.sourceScanDocument.findUniqueOrThrow({where:{id:doc.id}})).processingStatus).toBe('FAILED')
  })

})
