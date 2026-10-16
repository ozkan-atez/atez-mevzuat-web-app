import Fastify from 'fastify'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { documentsRoutes } from '../../src/modules/documents/documents.routes'

const apps:ReturnType<typeof Fastify>[]=[]
afterEach(async()=>{await Promise.all(apps.map(app=>app.close()));apps.length=0})
function createApp(prisma:any, options:Record<string,unknown>={}){
  const app=Fastify();apps.push(app)
  app.register(documentsRoutes,{prefix:'/api/v1',prisma:prisma as PrismaClient,objectStore:{getContent:vi.fn()},...options})
  return app
}
describe('document HTTP boundary',()=>{
  it('downloads original bytes only within the actor scope as an attachment',async()=>{
    const bytes=Buffer.from('original content')
    const findFirst=vi.fn(async()=>({storedObject:{objectKey:'private/key'},contentHash:createHash('sha256').update(bytes).digest('hex'),originalFilename:'örnek.txt',mimeType:'text/plain'}))
    const getContent=vi.fn(async()=>bytes)
    const response=await createApp({documentVersion:{findFirst}},{actorScope:'trusted',objectStore:{getContent}}).inject({method:'GET',url:'/api/v1/document-versions/v/original'})
    expect(response.statusCode).toBe(200);expect(response.body).toBe('original content')
    expect(response.headers['content-disposition']).toContain('attachment;')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(findFirst).toHaveBeenCalledWith({where:{id:'v',document:{actorScope:'trusted'}},include:{storedObject:true,document:{select:{canonicalUrl:true}}}})
  })
  it('does not read storage for an inaccessible original',async()=>{
    const getContent=vi.fn()
    const response=await createApp({documentVersion:{findFirst:vi.fn(async()=>null)}},{actorScope:'trusted',objectStore:{getContent}}).inject({method:'GET',url:'/api/v1/document-versions/v/original'})
    expect(response.statusCode).toBe(404);expect(getContent).not.toHaveBeenCalled()
  })
  it('filters before pagination and returns real source metadata',async()=>{
    const rows=Array.from({length:4},(_,i)=>({id:`d${i}`,title:`Document ${i}`,canonicalUrl:null,source:{id:'s',name:'Resmî Gazete',key:'resmi-gazete',baseUrl:'https://www.resmigazete.gov.tr'},versions:[{id:`v${i}`,storedObjectId:null,contentHash:`h${i}`,createdAt:new Date(),mimeType:'text/html',extractionStatus:'READY',originalFilename:null}]}))
    const prisma={document:{findMany:vi.fn(async()=>rows)},documentLink:{findMany:vi.fn(async()=>[])},operationArtifact:{findMany:vi.fn(async()=>[{createdAt:new Date(),data:{decisions:rows.map((_,i)=>({documentVersionId:`v${i}`,decision:i===0?'OUT':'IN'}))}}])}}
    const response=await createApp(prisma,{actorScope:'trusted'}).inject({method:'GET',url:'/api/v1/documents?classification=IN&page=2&limit=2'})
    expect(response.statusCode).toBe(200);expect(response.json().total).toBe(3)
    expect(response.json().documents).toHaveLength(1);expect(response.json().documents[0]).toMatchObject({id:'d3',classification:'IN',source:{name:'Resmî Gazete'}})
  })
  it('filters named sources and orders publication dates with undated records last',async()=>{
    const findMany=vi.fn(async()=>[{id:'d',sourceId:'s',source:{id:'s',name:'Resmî Gazete',key:'rg',baseUrl:'https://www.resmigazete.gov.tr'},versions:[]}])
    const app=createApp({document:{findMany},documentLink:{findMany:vi.fn(async()=>[])},operationArtifact:{findMany:vi.fn(async()=>[])}})
    const response=await app.inject({method:'GET',url:'/api/v1/documents?classification=ALL&sourceId=other&sort=NEWEST'})
    expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({total:0,documents:[],sources:[{id:'s',name:'Resmî Gazete'}]})
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({orderBy:[{publishedOn:{sort:'desc',nulls:'last'}},{sourceId:'asc'},{createdAt:'desc'},{id:'asc'}]}))
    await app.inject({method:'GET',url:'/api/v1/documents?classification=ALL&sourceId=s&sort=OLDEST'})
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({orderBy:[{publishedOn:{sort:'asc',nulls:'last'}},{sourceId:'asc'},{createdAt:'asc'},{id:'asc'}]}))
  })
  it('fails closed for remote clients without a trusted scope resolver',async()=>{
    const prisma={document:{findMany:vi.fn(),count:vi.fn()}}
    const response=await createApp(prisma).inject({method:'GET',url:'/api/v1/documents',remoteAddress:'192.168.10.10'})
    expect(response.statusCode).toBe(401);expect(prisma.document.findMany).not.toHaveBeenCalled()
  })
  it('scopes archive queries on the server and strips stored blob references',async()=>{
    const findMany=vi.fn(async()=>[{id:'doc',title:'Example',origin:'UPLOAD',versions:[{id:'version',mimeType:'text/plain',extractionStatus:'READY',originalFilename:'x.txt',createdAt:new Date(),storedObjectId:'secret'}]}])
    const prisma={document:{findMany,count:vi.fn(async()=>1)}}
    const response=await createApp(prisma,{actorScope:'trusted-workspace'}).inject({method:'GET',url:'/api/v1/documents?query=Example'})
    expect(response.statusCode).toBe(200);expect(findMany.mock.calls[0]).toEqual([{where:{actorScope:'trusted-workspace',title:{contains:'Example',mode:'insensitive'}},orderBy:{createdAt:'desc'},skip:0,take:30,include:{versions:{orderBy:{createdAt:'desc'}}}}])
    expect(response.body).not.toContain('secret');expect(response.json().documents[0].latestVersion.id).toBe('version')
  })
  it('returns paginated text without leaking unpaged metadata contents',async()=>{
    const findFirst=vi.fn(async()=>({id:'v',extractedText:'abcdef',extractionStatus:'READY',extractionMetadata:{sections:[{reference:'page:1',text:'abcdef'}]}}))
    const response=await createApp({documentVersion:{findFirst}},{actorScope:'trusted'}).inject({method:'GET',url:'/api/v1/document-versions/v/content?offset=2&limit=2'})
    expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({text:'cd',hasMore:true,totalCharacters:6,metadata:{sections:[{reference:'page:1',characters:6}]}})
    expect(findFirst.mock.calls[0]).toEqual([{where:{id:'v',document:{actorScope:'trusted'}}}])
  })
  it('filters known publication dates and rejects reversed date ranges before querying',async()=>{
    const findMany=vi.fn(async()=>[])
    const app=createApp({document:{findMany,count:vi.fn(async()=>0)}})
    const response=await app.inject({method:'GET',url:'/api/v1/documents?from=2026-10-01&to=2026-10-11&page=2&limit=10'})
    expect(response.statusCode).toBe(200)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({skip:10,take:10,where:expect.objectContaining({publishedOn:{gte:new Date('2026-10-01T00:00:00Z'),lte:new Date('2026-10-11T00:00:00Z')}})}))
    findMany.mockClear()
    expect((await app.inject({method:'GET',url:'/api/v1/documents?from=2026-10-11&to=2026-10-01'})).statusCode).toBe(400)
    expect(findMany).not.toHaveBeenCalled()
  })
  it('validates upload bytes before saving and always handles multipart field order',async()=>{
    const create=vi.fn();const prisma={documentImport:{create}}
    const boundary='atez-test-boundary'
    const payload=`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fake.pdf"\r\nContent-Type: application/pdf\r\n\r\nplain text\r\n--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nCustom title\r\n--${boundary}--\r\n`
    const response=await createApp(prisma,{actorScope:'trusted'}).inject({method:'POST',url:'/api/v1/documents/uploads',headers:{'content-type':`multipart/form-data; boundary=${boundary}`},payload})
    expect(response.statusCode).toBe(422);expect(response.json().message).toContain('uyuşmuyor');expect(create).not.toHaveBeenCalled()
  })
  it('rejects private URL imports before network or persistence',async()=>{
    const fetchBinary=vi.fn()
    const response=await createApp({}, {actorScope:'trusted',fetchBinary}).inject({method:'POST',url:'/api/v1/documents/imports',payload:{kind:'URL',url:'https://127.0.0.1/private'}})
    expect(response.statusCode).toBe(422);expect(fetchBinary).not.toHaveBeenCalled()
  })
})
