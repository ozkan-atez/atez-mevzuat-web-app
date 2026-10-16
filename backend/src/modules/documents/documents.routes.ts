import { downloadFilename } from './application/download-filename'
import { archiveClassifications } from './application/archive-classification'
import { createHash } from 'node:crypto'
import { getActorContext, privateActorScope, documentAccessWhere } from '../../platform/actor-context'
import { isLocalWorkspaceRequest } from '../../platform/local-workspace-access'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { z } from 'zod'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fetchSourceBinary, normalizeManagedSourceUrl } from '../managed-sources/fetch-managed-source'
import { DOCUMENT_MAX_BYTES, DocumentError } from './domain/document-content'
import { importDocument, publicVersion, type DocumentDependencies } from './application/import-document'

const metadata = z.object({title:z.string().trim().min(1).max(300).optional(),documentId:z.string().uuid().optional(),publishedOn:z.iso.date().optional(),originalOnly:z.enum(['true','false']).optional()})
export interface DocumentRouteOptions extends DocumentDependencies { resolveActorScope?: (request:FastifyRequest)=>Promise<string>; fetchBinary?: typeof fetchSourceBinary }
export async function documentsRoutes(app: FastifyInstance, options: DocumentRouteOptions) {
  await app.register(multipart,{limits:{fileSize:DOCUMENT_MAX_BYTES,files:1,fields:4,parts:5},throwFileSizeLimit:true})
  const scope = async (request:FastifyRequest) => {
    if(getActorContext())return privateActorScope()
    if(options.resolveActorScope) return options.resolveActorScope(request)
    if(!isLocalWorkspaceRequest(request)) throw new DocumentError('Bu özellik yerel çalışma alanında kullanılabilir. Uzak erişim için kimlik doğrulama entegrasyonu gerekir.',401)
    return options.actorScope ?? 'local-workspace'
  }
  app.addHook('preValidation',async request => {
    const key=request.headers['idempotency-key']
    if(key && (typeof key!=='string'||key.length>200))throw new DocumentError('İstek anahtarı geçersiz.',400)
  })
  app.setErrorHandler((error, request, reply) => {
    if(error instanceof DocumentError) return reply.code(error.statusCode).send({message:error.message})
    if((error as {statusCode?:number}).statusCode === 413) return reply.code(413).send({message:'Dosya 20 MB sınırını aşıyor.'})
    request.log.error({err:error},'Belge işlemi tamamlanamadı')
    return reply.code(500).send({message:'Belge işlemi tamamlanamadı.'})
  })
  app.get('/documents',async (request,reply) => {
    const parsed=z.object({query:z.string().max(200).optional(),origin:z.enum(['SOURCE','UPLOAD','USER_TEXT']).optional(),sourceId:z.string().min(1).max(100).optional(),sort:z.enum(['OLDEST','NEWEST']).optional(),classification:z.enum(['ALL','IN','OUT','MAYBE','UNREVIEWED']).optional(),from:z.iso.date().optional(),to:z.iso.date().optional(),page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(30)}).refine(value=>!value.from || !value.to || value.from<=value.to).safeParse(request.query)
    if(!parsed.success)return reply.code(400).send({message:'Belge arama bilgileri geçersiz.'})
    const actorScope=await scope(request)
    const where={...documentAccessWhere(actorScope),...(parsed.data.origin ? {origin:parsed.data.origin}:{}),...(parsed.data.query ? {title:{contains:parsed.data.query,mode:'insensitive' as const}}:{}),...((parsed.data.from || parsed.data.to) ? {publishedOn:{...(parsed.data.from ? {gte:new Date(`${parsed.data.from}T00:00:00Z`)}:{}),...(parsed.data.to ? {lte:new Date(`${parsed.data.to}T00:00:00Z`)}:{})}}:{})}
    if(parsed.data.classification){
      // Filter before pagination so IN results and totals span the entire archive.
      const rows=await options.prisma.document.findMany({where,orderBy:[{publishedOn:{sort:parsed.data.sort==='NEWEST'?'desc':'asc',nulls:'last'}},{sourceId:'asc'},{createdAt:parsed.data.sort==='NEWEST'?'desc':'asc'},{id:'asc'}],include:{source:{select:{id:true,name:true,key:true,baseUrl:true}},versions:{orderBy:{createdAt:'desc'},select:{id:true,mimeType:true,extractionStatus:true,originalFilename:true,createdAt:true,storedObjectId:true,contentHash:true}}}})
      const classifications=await archiveClassifications(options.prisma,rows,actorScope)
      const sources=[...new Map(rows.flatMap(row=>row.source?[[row.source.id,row.source] as const]:[])).values()]
      const filtered=rows.filter(row=>(!parsed.data.sourceId || row.sourceId===parsed.data.sourceId) && (parsed.data.classification==='ALL'||(classifications.get(row.id)?.decision ?? 'UNREVIEWED')===parsed.data.classification))
      const start=(parsed.data.page-1)*parsed.data.limit
      return {documents:filtered.slice(start,start+parsed.data.limit).map(({versions,...document})=>({...document,classification:classifications.get(document.id)?.decision ?? 'UNREVIEWED',versions:versions.map(publicVersion),latestVersion:versions[0]?publicVersion(versions[0]):null})),total:filtered.length,sources}
    }
    const [rows,total]=await Promise.all([options.prisma.document.findMany({where,orderBy:{createdAt:'desc'},skip:(parsed.data.page-1)*parsed.data.limit,take:parsed.data.limit,include:{versions:{orderBy:{createdAt:'desc'}}}}),options.prisma.document.count({where})])
    return {documents:rows.map(({versions,...document})=>({...document,versions:versions.map(publicVersion),latestVersion:versions[0] ? publicVersion(versions[0]):null})),total}
  })
  app.get('/documents/:id',async request => {
    const {id}=request.params as {id:string}
    const document=await options.prisma.document.findFirst({where:{id,...documentAccessWhere(await scope(request))},include:{versions:{orderBy:{createdAt:'desc'}}}})
    if(!document)throw new DocumentError('Belge bulunamadı.',404)
    return {...document,versions:document.versions.map(publicVersion)}
  })
  app.get('/document-versions/:id/original',async (request,reply) => {
    const {id}=request.params as {id:string}
    const version=await options.prisma.documentVersion.findFirst({where:{id,document:documentAccessWhere(await scope(request))},include:{storedObject:true,document:{select:{canonicalUrl:true}}}})
    if(!version?.storedObject)throw new DocumentError('Özgün dosya bulunamadı.',404)
    const bytes=await options.objectStore.getContent(version.storedObject.objectKey)
    if(createHash('sha256').update(bytes).digest('hex')!==version.contentHash)throw new DocumentError('Dosya bütünlüğü doğrulanamadı.')
    const disposition=downloadFilename(version.originalFilename,version.document?.canonicalUrl,version.mimeType || version.storedObject.mediaType)
    return reply.header('Content-Type','application/octet-stream').header('X-Content-Type-Options','nosniff').header('Cache-Control','private, no-store').header('Content-Disposition',disposition).send(bytes)
  })
  app.get('/document-versions/:id/content',async request => {
    const {id}=request.params as {id:string}
    const parsed=z.object({offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100000).default(20000)}).safeParse(request.query)
    if(!parsed.success)throw new DocumentError('Metin aralığı geçersiz.',400)
    const version=await options.prisma.documentVersion.findFirst({where:{id,document:documentAccessWhere(await scope(request))}})
    if(!version)throw new DocumentError('Belge sürümü bulunamadı.',404)
    const text=version.extractedText ?? ''
    return {id:version.id,text:text.slice(parsed.data.offset,parsed.data.offset+parsed.data.limit),status:version.extractionStatus,totalCharacters:text.length,offset:parsed.data.offset,hasMore:text.length>parsed.data.offset+parsed.data.limit,metadata: version.extractionMetadata && typeof version.extractionMetadata === 'object' && !Array.isArray(version.extractionMetadata) ? {...version.extractionMetadata, sections: Array.isArray(version.extractionMetadata.sections) ? version.extractionMetadata.sections.map(section => section && typeof section === 'object' && !Array.isArray(section) ? {reference:section.reference,characters:typeof section.text === 'string' ? section.text.length:0}:section):[]} : null}
  })
  app.get('/document-imports/:id',async request=>{
    const {id}=request.params as {id:string}
    const record=await options.prisma.documentImport.findFirst({where:{id,actorScope:await scope(request)}})
    if(!record)throw new DocumentError('Belge ekleme işlemi bulunamadı.',404)
    return {id:record.id,status:record.status,error:record.error,documentVersionId:record.documentVersionId}
  })
  app.post('/documents/:id/test',async request=>{
    const {id}=request.params as {id:string}
    const version=await options.prisma.documentVersion.findFirst({where:{documentId:id,document:documentAccessWhere(await scope(request))},orderBy:{createdAt:'desc'},include:{storedObject:true}})
    if(!version?.storedObject)throw new DocumentError('Özgün dosya bulunamadı.',404)
    const bytes=await options.objectStore.getContent(version.storedObject.objectKey)
    if(createHash('sha256').update(bytes).digest('hex')!==version.contentHash)throw new DocumentError('Dosya bütünlüğü doğrulanamadı.')
    return {status:'VERIFIED',message:'Özgün dosya erişimi ve bütünlüğü doğrulandı. AI analizi ayrı bir adımdır.'}
  })
  app.post('/documents/uploads',async (request,reply)=>{
    const actorScope=await scope(request)
    const temporary=await mkdtemp(join(tmpdir(),'atez-upload-'))
    try {
      let file: {filename:string;mediaType:string;path:string}|undefined
      const fields:Record<string,string>={}
      for await(const part of request.parts()) {
        if(part.type==='file') {
          const path=join(temporary,'file')
          await pipeline(part.file,createWriteStream(path,{mode:0o600}))
          if(part.file.truncated)throw new DocumentError('Dosya 20 MB sınırını aşıyor.',413)
          file={filename:basename(part.filename).slice(0,255),mediaType:part.mimetype,path}
        } else { if(typeof part.value==='string') fields[part.fieldname]=part.value }
      }
      if(!file)throw new DocumentError('Bir dosya seçin.',400)
      const parsed=metadata.safeParse(fields)
      if(!parsed.success)throw new DocumentError('Belge bilgileri geçersiz.',400)
      const result=await importDocument(options,{...parsed.data,originalOnly:parsed.data.originalOnly==='true',bytes:await readFile(file.path),filename:file.filename,mediaType:file.mediaType,tempPath:file.path,actorScope,...(typeof request.headers['idempotency-key']==='string' ? {idempotencyKey:request.headers['idempotency-key']}: {})})
      return reply.code(201).send(result)
    } finally {await rm(temporary,{recursive:true,force:true})}
  })
  app.post('/documents/imports',async (request,reply)=>{
    const parsed=z.discriminatedUnion('kind',[metadata.extend({kind:z.literal('TEXT'),text:z.string().min(1).max(1_000_000)}),metadata.extend({kind:z.literal('URL'),url:z.url().max(2000)})]).safeParse(request.body)
    if(!parsed.success)throw new DocumentError('Belge ekleme bilgileri geçersiz.',400)
    const actorScope=await scope(request)
    const data=parsed.data
    let bytes:Buffer,filename:string,mediaType:string,canonicalUrl:string|undefined
    if(data.kind==='TEXT') {bytes=Buffer.from(data.text,'utf8');filename='kullanici-metni.txt';mediaType='text/plain'}
    else {
      try {canonicalUrl=normalizeManagedSourceUrl(data.url)} catch {throw new DocumentError('Geçerli, genel internete açık bir HTTPS bağlantısı girin.',422)}
      let fetched: Awaited<ReturnType<typeof fetchSourceBinary>>
      try {fetched=await (options.fetchBinary ?? fetchSourceBinary)(canonicalUrl,DOCUMENT_MAX_BYTES)} catch {throw new DocumentError('Bağlantı güvenli biçimde alınamadı; erişimi ve dosya boyutunu kontrol edin.',422)}
      bytes=fetched.body;mediaType=fetched.contentType;filename=decodeURIComponent(new URL(canonicalUrl).pathname.split('/').pop() || 'baglanti-belgesi')
    }
    const result=await importDocument(options,{bytes,filename,mediaType,actorScope,origin:data.kind==='TEXT'?'USER_TEXT':'UPLOAD',originalOnly:data.originalOnly==='true',allowHtml:data.kind==='URL',...(canonicalUrl ? {canonicalUrl}:{}),...(data.title ? {title:data.title}:{}),...(data.documentId ? {documentId:data.documentId}:{}),...(data.publishedOn ? {publishedOn:data.publishedOn}:{}),...(typeof request.headers['idempotency-key']==='string'?{idempotencyKey:request.headers['idempotency-key']}:{})})
    return reply.code(201).send(result)
  })
}
