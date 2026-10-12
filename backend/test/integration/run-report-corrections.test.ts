import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildApp } from '../../src/app'

const enabled = Boolean(process.env.TEST_DATABASE_URL)
describe.skipIf(!enabled)('empty-day report corrections', () => {
  const prisma = new PrismaClient()
  const runs:string[] = []
  afterAll(async()=>{await prisma.scanRun.deleteMany({where:{id:{in:runs}}});await prisma.$disconnect()})
  it('lists, edits and publishes K6 using its original report identity and immutable revisions', async()=>{
    const dbUrl=new URL(process.env.TEST_DATABASE_URL!)
    if(dbUrl.port!=='45432' || !dbUrl.pathname.endsWith('_test')) throw new Error('Isolated test database required')
    const run=await prisma.scanRun.create({data:{requestKey:randomUUID(),targetDate:new Date('2026-10-12')}})
    runs.push(run.id)
    const id=randomUUID(), basename='00-degisiklik-yok.html', specKey=`${id}/spec.json`, htmlKey=`${id}/original.html`
    const spec={schemaVersion:1,templateFamily:'bulten-v2',reportId:'121026-00',topicId:null,card:'K6',documentTitle:'ATEZ Mevzuat Radarı Günlük Raporu — Değişiklik Yok',issueNumber:'33390',displayDate:'12 Ekim 2026 Pazartesi',emptyDayText:'Bugün kapsam içi değişiklik yok.',source:{label:'Resmî Gazete',url:'https://www.resmigazete.gov.tr'},blocks:['B1','B10']}
    await prisma.topicReport.create({data:{id,scanRunId:run.id,title:spec.documentTitle,basename,card:'K6',latestVersion:1,revisions:{create:{version:1,status:'VALIDATED',card:'K6',specObjectKey:specKey,htmlObjectKey:htmlKey}}}})
    const files=new Map<string,Buffer>([[specKey,Buffer.from(JSON.stringify(spec))],[htmlKey,Buffer.from('Original report')]])
    const objectStore={getContent:async(key:string)=>{const value=files.get(key);if(!value)throw new Error('Missing object');return value},putRunFile:async(key:string,body:Buffer,mediaType:string)=>{files.set(key,body);return {objectKey:key,sha256:'a'.repeat(64),byteSize:BigInt(body.length),mediaType}}}
    const app=await buildApp({authRuntime:false,objectStore,revisionModel:{generateStructured:async()=>({json:{outcome:'EDITS',edits:[{path:'emptyDayText',value:'İncelenen kaynaklarda kapsam içi değişiklik bulunmadı.'}]},providerRequestId:null,usage:{inputTokens:null,outputTokens:null}})}})
    try {
      const picker=await app.inject({method:'GET',url:'/api/v1/chat/reports'})
      expect(picker.json().reports.some((r:{topicId:string})=>r.topicId===id)).toBe(true)
      const detail=await app.inject({method:'GET',url:`/api/v1/topics/${id}`})
      expect(detail.json()).toMatchObject({id,runId:run.id,reportVersion:1,reportCard:'K6'})
      const edit=await app.inject({method:'POST',url:`/api/v1/topics/${id}/draft/edits`,headers:{'idempotency-key':randomUUID()},payload:{expectedVersion:1,edits:[{path:'emptyDayText',value:'Kapsam içi değişiklik bulunmuyor.'}]}})
      expect(edit.statusCode).toBe(200)
      const key=randomUUID(),prompt={method:'POST' as const,url:`/api/v1/topics/${id}/messages`,headers:{'idempotency-key':key},payload:{message:'Metni daha açık yaz.'}}
      expect((await app.inject(prompt)).statusCode).toBe(200)
      expect((await app.inject(prompt)).statusCode).toBe(200)
      expect(await prisma.reportRevision.count({where:{reportId:id}})).toBe(1)
      const publish=await app.inject({method:'POST',url:`/api/v1/topics/${id}/draft/publish`,payload:{expectedVersion:1}})
      expect(publish.statusCode,publish.body).toBe(201)
      expect(publish.json()).toMatchObject({reportId:id,version:2,card:'K6'})
      const report=await prisma.topicReport.findUniqueOrThrow({where:{id},include:{revisions:{orderBy:{version:'asc'}}}})
      expect(report.topicId).toBeNull()
      expect(report.latestVersion).toBe(2)
      expect(report.revisions).toHaveLength(2)
      expect(files.get(htmlKey)?.toString()).toBe('Original report')
      const saved=JSON.parse(files.get(report.revisions[1]!.specObjectKey)!.toString())
      expect(saved).toMatchObject({topicId:null,card:'K6',reportId:'121026-00',emptyDayText:'İncelenen kaynaklarda kapsam içi değişiklik bulunmadı.'})
      const history=await app.inject({method:'GET',url:`/api/v1/topics/${id}/draft/history`})
      expect(history.json().revisions[0].edits).toHaveLength(2)
      expect(history.json().revisions[0].edits.every((e:{revertible:boolean})=>!e.revertible)).toBe(true)
      const html=await app.inject({method:'GET',url:`/api/v1/topics/${id}/reports/2/html`})
      expect(html.statusCode).toBe(200)
      expect(html.body).toContain('İncelenen kaynaklarda kapsam içi değişiklik bulunmadı.')
    } finally {await app.close()}
  })
})
