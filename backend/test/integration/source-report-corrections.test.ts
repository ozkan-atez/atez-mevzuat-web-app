import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { operationReportSpec } from '../../src/modules/operations/report-spec'
import { buildApp } from '../../src/app'

const enabled = Boolean(process.env.TEST_DATABASE_URL)
describe.skipIf(!enabled)('source report corrections', () => {
  const prisma = new PrismaClient()
  const runs:string[] = []
  afterAll(async()=>{await prisma.scanRun.deleteMany({where:{id:{in:runs}}});await prisma.$disconnect()})
  it('lists, edits and publishes source reports using its original report identity and immutable revisions', async()=>{
    const dbUrl=new URL(process.env.TEST_DATABASE_URL!)
    if(dbUrl.port!=='45432' || !dbUrl.pathname.endsWith('_test')) throw new Error('Isolated test database required')
    const run=await prisma.scanRun.create({data:{requestKey:randomUUID(),targetDate:new Date('2026-10-12')}})
    runs.push(run.id)
    const id=randomUUID(), basename=`belge-raporu-${id}`, specKey=`${id}/spec.json`, htmlKey=`${id}/original.html`
    const spec=operationReportSpec({reportContent:{title:'Kaynak duyurusu',summary:'Önceki özet',detailedAnalysis:'Kayıtlı kaynak açıklaması'},sourceContext:[{title:'Dernek duyurusu',url:'https://example.com/duyuru'}]},id,new Date('2026-10-12T12:00:00Z'))
    await prisma.topicReport.create({data:{id,title:spec.documentTitle,basename,card:'K5',latestVersion:1,revisions:{create:{version:1,status:'VALIDATED',card:'K5',specObjectKey:specKey,htmlObjectKey:htmlKey}}}})
    const files=new Map<string,Buffer>([[specKey,Buffer.from(JSON.stringify(spec))],[htmlKey,Buffer.from('Original report')]])
    const objectStore={getContent:async(key:string)=>{const value=files.get(key);if(!value)throw new Error('Missing object');return value},putRunFile:async(key:string,body:Buffer,mediaType:string)=>{files.set(key,body);return {objectKey:key,sha256:'a'.repeat(64),byteSize:BigInt(body.length),mediaType}}}
    const app=await buildApp({authRuntime:false,objectStore,revisionModel:{generateStructured:async()=>({json:{outcome:'EDITS',edits:[{path:'summary',value:'İncelenen kaynaklarda kapsam içi değişiklik bulunmadı.'}]},providerRequestId:null,usage:{inputTokens:null,outputTokens:null}})}})
    try {
      const picker=await app.inject({method:'GET',url:'/api/v1/chat/reports'})
      expect(picker.statusCode).toBe(200)
      const detail=await app.inject({method:'GET',url:`/api/v1/topics/${id}`})
      expect(detail.json()).toMatchObject({id,runId:'',reportVersion:1,reportCard:'K5'})
      const edit=await app.inject({method:'POST',url:`/api/v1/topics/${id}/draft/edits`,headers:{'idempotency-key':randomUUID()},payload:{expectedVersion:1,edits:[{path:'summary',value:'Kapsam içi değişiklik bulunmuyor.'}]}})
      expect(edit.statusCode).toBe(200)
      const key=randomUUID(),prompt={method:'POST' as const,url:`/api/v1/topics/${id}/messages`,headers:{'idempotency-key':key},payload:{message:'Metni daha açık yaz.'}}
      expect((await app.inject(prompt)).statusCode).toBe(200)
      expect((await app.inject(prompt)).statusCode).toBe(200)
      expect(await prisma.reportRevision.count({where:{reportId:id}})).toBe(1)
      const publish=await app.inject({method:'POST',url:`/api/v1/topics/${id}/draft/publish`,payload:{expectedVersion:1}})
      expect(publish.statusCode,publish.body).toBe(201)
      expect(publish.json()).toMatchObject({reportId:id,version:2,card:'K5'})
      const report=await prisma.topicReport.findUniqueOrThrow({where:{id},include:{revisions:{orderBy:{version:'asc'}}}})
      expect(report.topicId).toBeNull()
      expect(report.latestVersion).toBe(2)
      expect(report.revisions).toHaveLength(2)
      expect(files.get(htmlKey)?.toString()).toBe('Original report')
      const saved=JSON.parse(files.get(report.revisions[1]!.specObjectKey)!.toString())
      expect(saved).toMatchObject({topicId:id,card:'K5',reportId:'121026-01',summary:'İncelenen kaynaklarda kapsam içi değişiklik bulunmadı.'})
      const history=await app.inject({method:'GET',url:`/api/v1/topics/${id}/draft/history`})
      expect(history.json().revisions[0].edits).toHaveLength(2)
      expect(history.json().revisions[0].edits.every((e:{revertible:boolean})=>!e.revertible)).toBe(true)
      const html=await app.inject({method:'GET',url:`/api/v1/topics/${id}/reports/2/html`})
      expect(html.statusCode).toBe(200)
      expect(html.body).toContain('İncelenen kaynaklarda kapsam içi değişiklik bulunmadı.')
    } finally {await app.close();await prisma.topicReport.delete({where:{id}})}
  })
})
