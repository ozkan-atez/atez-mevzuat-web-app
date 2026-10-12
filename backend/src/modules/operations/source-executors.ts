import { getActorContext, sharedActorScope, resourceOwnership, canonicalDocumentKey, officialSourceScope } from '../../platform/actor-context'
import { Prisma, type PrismaClient } from '@prisma/client'
import type { ObjectStore } from '../scan-runs/application/ports'
import { sourceProfileSchema } from '../managed-sources/source-profile'
import { activeSourceProfile } from '../managed-sources/source-profile-store'
import { sourceLogin } from '../managed-sources/source-secrets'
import { openSourceSession } from '../managed-sources/source-session'
import { collectSource } from '../managed-sources/source-collector'
import { captureSourceDocument } from '../managed-sources/source-attachments'
import { OperationError, type OperationExecutors } from './operation-service'

/** These adapters never call processSourceDocuments or enqueue START_SCAN. */
export function createSourceOperationExecutors(dependencies: { prisma: PrismaClient; objectStore: Pick<ObjectStore, 'putRunFile'> }) : OperationExecutors {
  const { prisma, objectStore } = dependencies
  return {
    DISCOVER: async (input, context) => {
      if (!input.sourceId || !input.date) throw new OperationError('Keşif için kaynak ve hedef tarih seçin.')
      const liveSource = await prisma.source.findFirst({ where: { id: input.sourceId, isActive: true } })
      if (!liveSource) throw new OperationError('Etkin kaynak bulunamadı.', 404)
      const frozenSource=input.executionSnapshot?.source as {id:string;key:string;baseUrl:string;authorityType:string}|undefined
      if(frozenSource && frozenSource.id!==liveSource.id)throw new OperationError('Kaynak anlık kopyası geçersiz.',409,'SNAPSHOT_INVALID')
      const source=frozenSource?{...liveSource,...frozenSource}:liveSource
      const frozenProfile=input.executionSnapshot?.profile as {id:string|null;version:number;config:unknown}|undefined
      const profile=frozenProfile?{id:frozenProfile.id,version:frozenProfile.version,config:sourceProfileSchema.parse(frozenProfile.config)}:await activeSourceProfile(prisma, source)
      if (input.profileVersion !== undefined && input.profileVersion !== profile.version) throw new OperationError('Kaynak profili değişti; işlem planını yenileyin.',409,'PROFILE_CHANGED')
      const login = await sourceLogin(prisma, source.id, source.key)
      const session = await openSourceSession(profile.config, login)
      try {
        if (context.signal.aborted) throw new OperationError('İşlem iptal edildi.', 409)
        const collection = await collectSource(profile.config, input.date, session, login, input.datePolicy ?? 'PUBLISHED_DATE')
        if (!collection.pages.length) throw new OperationError('Kaynak sayfaları okunamadı; boş gün doğrulanmadı.', 422, 'COVERAGE_INCOMPLETE')
        for (const item of collection.items) await prisma.sourceObservation.upsert({
          where: { sourceId_scope_url: { sourceId: source.id, scope: 'inventory', url: item.url } },
          create: { sourceId: source.id, scope: 'inventory', url: item.url, title: item.title, publishedOn: item.publishedOn ? new Date(item.publishedOn) : null },
          update: { title: item.title, publishedOn: item.publishedOn ? new Date(item.publishedOn) : null, lastSeenAt: new Date() },
        })
        await prisma.sourceCoverage.create({data:{...resourceOwnership(),actorScope:context.actorScope,sourceId:source.id,targetDate:new Date(`${input.date}T00:00:00Z`),profileVersion:String(profile.version),datePolicy:input.datePolicy ?? 'PUBLISHED_DATE',status:collection.warnings.length ? 'PARTIAL':'COMPLETE',visitedPages:collection.pages,missingPages:[],taskId:context.taskId}})
        const items = collection.items.filter(item => input.datePolicy === 'NEW_OR_CHANGED' || item.publishedOn === input.date)
        return [{ kind: 'DISCOVERY', data: { sourceId: source.id, date: input.date, profileId: profile.id, profileVersion: profile.version, coverage: collection.warnings.length ? 'PARTIAL' : 'COMPLETE', pages: collection.pages, warnings: collection.warnings, notes: collection.notes ?? [], items } }]
      } finally { await session.close() }
    },
    CAPTURE: async (input, context) => {
      if (!input.sourceId || !input.url) throw new OperationError('Belge alma için kaynak ve belge bağlantısı seçin.')
      const liveSource = await prisma.source.findFirst({ where: { id: input.sourceId, isActive: true } })
      if (!liveSource) throw new OperationError('Etkin kaynak bulunamadı.', 404)
      const frozenSource=input.executionSnapshot?.source as {id:string;key:string;baseUrl:string;authorityType:string}|undefined
      if(frozenSource && frozenSource.id!==liveSource.id)throw new OperationError('Kaynak anlık kopyası geçersiz.',409,'SNAPSHOT_INVALID')
      const source=frozenSource?{...liveSource,...frozenSource}:liveSource
      const frozenProfile=input.executionSnapshot?.profile as {id:string|null;version:number;config:unknown}|undefined
      const profile=frozenProfile?{id:frozenProfile.id,version:frozenProfile.version,config:sourceProfileSchema.parse(frozenProfile.config)}:await activeSourceProfile(prisma, source)
      if (input.profileVersion !== undefined && input.profileVersion !== profile.version) throw new OperationError('Kaynak profili değişti; işlem planını yenileyin.',409,'PROFILE_CHANGED')
      const allowedHosts = new Set([new URL(source.baseUrl).hostname, ...profile.config.allowedHosts, ...profile.config.feeds.map(feed => new URL(feed.url).hostname)])
      const url = new URL(input.url)
      if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new OperationError('Belge bağlantısı seçili kaynak kapsamına ait olmalıdır.')
      const observation = await prisma.sourceObservation.findFirst({ where: { sourceId: source.id, url: input.url, scope: 'inventory' } })
      if (input.date && observation?.publishedOn?.toISOString().slice(0,10) !== input.date) throw new OperationError('Belgenin yayın tarihi hedef gün için doğrulanmadı.')
      // Only a complete CAPTURE receipt in OperationService proves annex coverage.
      // A stored main document alone must not short-circuit missing attachments.
      const login = await sourceLogin(prisma, source.id, source.key)
      const session = await openSourceSession(profile.config, login)
      try {
        if (context.signal.aborted) throw new OperationError('İşlem iptal edildi.', 409)
        const captured = await captureSourceDocument(input.url, source.baseUrl, objectStore, [], 100_000_000, session.binary)
        const original = captured.files.find(file => file.role === 'DOCUMENT' && file.status === 'STORED')
        if (!original) throw new OperationError('Özgün belge arşivlenemedi.', 422, 'CAPTURE_FAILED')
        const ids: string[] = []
        for (const file of captured.files.filter(file => file.status === 'STORED')) {
          if (!file.sha256 || !file.objectKey || !file.bucket || !file.mediaType || !file.byteSize) continue
          const stored = await prisma.storedObject.upsert({ where: { sha256: file.sha256 }, create: { sha256: file.sha256, objectKey: file.objectKey, bucket: file.bucket, byteSize: BigInt(file.byteSize), mediaType: file.mediaType }, update: {} })
          const documentScope=officialSourceScope(source.key,file.url,context.actorScope)
          const shared=getActorContext() && documentScope===sharedActorScope()
          const document = await prisma.document.upsert({ where: { canonicalKey:canonicalDocumentKey(file.url,documentScope) }, create: { ...resourceOwnership(Boolean(shared)),canonicalKey:canonicalDocumentKey(file.url,documentScope),sourceId: source.id, origin: 'SOURCE', actorScope: documentScope, canonicalUrl: file.url, title: observation?.title ?? file.title, publishedOn: file.role === 'DOCUMENT' ? observation?.publishedOn ?? null : null }, update: {} })
          if (document.actorScope !== documentScope) throw new OperationError('Belge erişim kapsamı farklı.', 404)
          const version = await prisma.documentVersion.upsert({ where: { documentId_contentHash: { documentId: document.id, contentHash: file.sha256 } }, create: { documentId: document.id, contentHash: file.sha256, storedObjectId: stored.id, mimeType: file.mediaType, extractionStatus: 'PENDING', originalFilename: new URL(file.url).pathname.split('/').pop() ?? null }, update: {} })
          ids.push(version.id)
        }
        return [{ kind: 'CAPTURE', data: { status: captured.status, errors: captured.errors, documentVersionIds: ids, files: captured.files.map(({ objectKey, bucket, ...file }) => file) } }, ...ids.map(id => ({ kind: 'DOCUMENT_VERSION', referenceId: id, data: { versionId: id } }))]
      } finally { await session.close() }
    },
  }
}

export { sourceArtifactIsComplete } from './source-artifacts'
