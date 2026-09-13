import type { PrismaClient } from '@prisma/client'
import type { ScanRunStatus, ScanStage } from '../domain/scan-run'
import type { CompletedRunSnapshot, DiscoveredAsset, DiscoveredEdition, ScanRunDetailDto, ScanRunSummaryDto, StoredBlob } from '../application/ports'

export class PrismaScanRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createManualRun(input: { requestKey: string; targetDate: string }): Promise<{
    id: string
    status: ScanRunStatus
    targetDate: string
  }> {
    const run = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.scanRun.findUnique({ where: { requestKey: input.requestKey } })
      if (existing) return existing

      return tx.scanRun.create({
        data: {
          requestKey: input.requestKey,
          targetDate: new Date(`${input.targetDate}T00:00:00.000Z`),
          timezone: 'Europe/Istanbul',
          outbox: { create: {} },
        },
      })
    })

    return {
      id: run.id,
      status: run.status,
      targetDate: run.targetDate.toISOString().slice(0, 10),
    }
  }

  async claimPendingOutbox(limit: number): Promise<Array<{ id: string; scanRunId: string; attempts: number }>> {
    return this.prisma.scanOutbox.findMany({
      where: { dispatchedAt: null, availableAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, scanRunId: true, attempts: true },
    })
  }

  async markOutboxDispatched(outboxId: string, queueJobId: string): Promise<void> {
    const outbox = await this.prisma.scanOutbox.findUniqueOrThrow({ where: { id: outboxId } })
    await this.prisma.$transaction([
      this.prisma.scanOutbox.update({
        where: { id: outboxId },
        data: { dispatchedAt: new Date(), lastError: null },
      }),
      this.prisma.scanRun.update({
        where: { id: outbox.scanRunId },
        data: { queueJobId },
      }),
    ])
  }

  async deferOutbox(outboxId: string, error: string, availableAt: Date): Promise<void> {
    await this.prisma.scanOutbox.update({
      where: { id: outboxId },
      data: { attempts: { increment: 1 }, lastError: error, availableAt },
    })
  }

  async getExecutionRun(runId: string): Promise<{ id: string; targetDate: string; downloadedBytes: bigint } | null> {
    const run = await this.prisma.scanRun.findUnique({ where: { id: runId } })
    return run ? { id: run.id, targetDate: run.targetDate.toISOString().slice(0, 10), downloadedBytes: run.downloadedBytes } : null
  }

  async startRun(runId: string): Promise<void> {
    await this.prisma.scanRun.update({ where: { id: runId }, data: { status: 'RUNNING', startedAt: new Date(), errorSummary: null } })
  }

  async startStage(runId: string, stage: ScanStage, totalItems: number): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.scanRun.update({ where: { id: runId }, data: { currentStage: stage, totalItems, completedItems: 0, failedItems: 0 } }),
      this.prisma.stageExecution.upsert({
        where: { scanRunId_stage: { scanRunId: runId, stage } },
        create: { scanRunId: runId, stage, status: 'RUNNING', totalItems, startedAt: new Date() },
        update: { status: 'RUNNING', totalItems, completedItems: 0, failedItems: 0, startedAt: new Date(), completedAt: null, errorSummary: null },
      }),
    ])
  }

  async advanceStage(runId: string, stage: ScanStage, downloadedBytes: bigint): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.scanRun.update({ where: { id: runId }, data: { completedItems: { increment: 1 }, downloadedBytes: { increment: downloadedBytes } } }),
      this.prisma.stageExecution.update({ where: { scanRunId_stage: { scanRunId: runId, stage } }, data: { completedItems: { increment: 1 } } }),
    ])
  }

  async completeStage(runId: string, stage: ScanStage): Promise<void> {
    await this.prisma.stageExecution.update({ where: { scanRunId_stage: { scanRunId: runId, stage } }, data: { status: 'COMPLETED', completedAt: new Date() } })
  }

  async failStage(runId: string, stage: ScanStage, error: string): Promise<void> {
    await this.prisma.stageExecution.update({ where: { scanRunId_stage: { scanRunId: runId, stage } }, data: { status: 'FAILED', failedItems: { increment: 1 }, errorSummary: error, completedAt: new Date() } })
  }

  async saveIndex(runId: string, sourceUrl: string, object: StoredBlob): Promise<void> {
    await this.prisma.scanRun.update({ where: { id: runId }, data: { indexSourceUrl: sourceUrl, indexObjectKey: object.objectKey, indexSha256: object.sha256 } })
  }

  async saveEditions(runId: string, targetDate: string, editions: DiscoveredEdition[]): Promise<void> {
    await this.prisma.$transaction(editions.map((edition) => this.prisma.gazetteEdition.create({
      data: {
        scanRunId: runId,
        publicationDate: new Date(`${targetDate}T00:00:00.000Z`),
        type: edition.type,
        supplementNo: edition.supplementNo,
        indexUrl: edition.indexUrl,
        discoveryOrder: edition.discoveryOrder,
        documents: { create: edition.documents.map((document) => ({
          title: document.title,
          documentType: document.documentType ?? null,
          sourceUrl: document.sourceUrl,
          publicationOrder: document.publicationOrder,
        })) },
      },
    })))
  }

  async listDocuments(runId: string): Promise<Array<{ id: string; sourceUrl: string; title: string }>> {
    return this.prisma.collectedDocument.findMany({
      where: { edition: { scanRunId: runId } }, orderBy: [{ edition: { discoveryOrder: 'asc' } }, { publicationOrder: 'asc' }],
      select: { id: true, sourceUrl: true, title: true },
    })
  }

  async saveAssets(documentId: string, assets: DiscoveredAsset[]): Promise<void> {
    if (assets.length === 0) return
    await this.prisma.documentAsset.createMany({
      data: assets.map((asset) => ({ documentId, sourceUrl: asset.sourceUrl, role: asset.role, referenceText: asset.referenceText ?? null })),
      skipDuplicates: true,
    })
  }

  async listAssets(runId: string): Promise<Array<{ id: string; documentId: string; sourceUrl: string }>> {
    return this.prisma.documentAsset.findMany({
      where: { document: { edition: { scanRunId: runId } } }, orderBy: { sourceUrl: 'asc' },
      select: { id: true, documentId: true, sourceUrl: true },
    })
  }

  async attachDocumentObject(documentId: string, object: StoredBlob): Promise<void> {
    const storedObjectId = await this.upsertObject(object)
    await this.prisma.collectedDocument.update({ where: { id: documentId }, data: { storedObjectId, validationStatus: 'VALID' } })
  }

  async attachAssetObject(assetId: string, object: StoredBlob): Promise<void> {
    const storedObjectId = await this.upsertObject(object)
    await this.prisma.documentAsset.update({ where: { id: assetId }, data: { storedObjectId, validationStatus: 'VALID' } })
  }

  async verifyManifestCounts(runId: string): Promise<void> {
    const [documents, invalidDocuments, assets, invalidAssets] = await Promise.all([
      this.prisma.collectedDocument.count({ where: { edition: { scanRunId: runId } } }),
      this.prisma.collectedDocument.count({ where: { edition: { scanRunId: runId }, validationStatus: { not: 'VALID' } } }),
      this.prisma.documentAsset.count({ where: { document: { edition: { scanRunId: runId } } } }),
      this.prisma.documentAsset.count({ where: { document: { edition: { scanRunId: runId } }, validationStatus: { not: 'VALID' } } }),
    ])
    if (documents === 0 || invalidDocuments > 0 || invalidAssets > 0) {
      throw new Error(`Manifest verification failed: documents=${documents}, invalidDocuments=${invalidDocuments}, assets=${assets}, invalidAssets=${invalidAssets}`)
    }
  }

  async completeRun(runId: string, manifestObjectKey: string): Promise<void> {
    await this.prisma.scanRun.update({ where: { id: runId }, data: { status: 'COMPLETED', manifestObjectKey, completedAt: new Date() } })
  }

  async failRun(runId: string, status: 'PARTIAL' | 'FAILED', error: string): Promise<void> {
    await this.prisma.scanRun.update({ where: { id: runId }, data: { status, errorSummary: error, completedAt: new Date() } })
  }

  async getRun(runId: string): Promise<ScanRunDetailDto | null> {
    const run = await this.prisma.scanRun.findUnique({
      where: { id: runId },
      include: { stages: { orderBy: { createdAt: 'asc' } }, editions: { orderBy: { discoveryOrder: 'asc' }, include: { documents: { orderBy: { publicationOrder: 'asc' }, include: { _count: { select: { assets: true } } } } } } },
    })
    if (!run) return null
    const assets = await this.prisma.documentAsset.count({ where: { document: { edition: { scanRunId: runId } } } })
    return {
      id: run.id, status: run.status, currentStage: run.currentStage,
      targetDate: run.targetDate.toISOString().slice(0, 10), startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null, errorSummary: run.errorSummary,
      counts: { editions: run.editions.length, documents: run.editions.reduce((n, e) => n + e.documents.length, 0), assets, completedItems: run.completedItems, totalItems: run.totalItems, failedItems: run.failedItems },
      stages: run.stages.map((stage) => ({ stage: stage.stage, status: stage.status, completedItems: stage.completedItems, totalItems: stage.totalItems, failedItems: stage.failedItems })),
      editions: run.editions.map((edition) => ({ id: edition.id, type: edition.type, supplementNo: edition.supplementNo, documents: edition.documents.map((document) => ({ id: document.id, title: document.title, sourceUrl: document.sourceUrl, validationStatus: document.validationStatus, assetCount: document._count.assets })) })),
    }
  }

  async listRuns(limit: number): Promise<ScanRunSummaryDto[]> {
    const runs = await this.prisma.scanRun.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: { editions: { include: { documents: { include: { _count: { select: { assets: true } } } } } } },
    })
    return runs.map((run) => ({
      id: run.id,
      trigger: run.trigger,
      status: run.status,
      currentStage: run.currentStage,
      targetDate: run.targetDate.toISOString().slice(0, 10),
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      counts: {
        editions: run.editions.length,
        documents: run.editions.reduce((total, edition) => total + edition.documents.length, 0),
        assets: run.editions.reduce((total, edition) => total + edition.documents.reduce((documentTotal, document) => documentTotal + document._count.assets, 0), 0),
      },
    }))
  }

  async completedSnapshot(runId: string): Promise<CompletedRunSnapshot> {
    const run = await this.getRun(runId)
    if (!run) throw new Error(`Scan run not found: ${runId}`)
    const raw = await this.prisma.scanRun.findUniqueOrThrow({ where: { id: runId } })
    if (!raw.indexSourceUrl || !raw.indexObjectKey || !raw.indexSha256) throw new Error('Run index metadata is incomplete')
    const documents = await this.prisma.collectedDocument.findMany({ where: { edition: { scanRunId: runId } }, include: { storedObject: true, assets: { include: { storedObject: true } } } })
    const objects: CompletedRunSnapshot['objects'] = []
    for (const document of documents) {
      if (!document.storedObject) throw new Error(`Document object missing: ${document.id}`)
      objects.push({ documentId: document.id, sourceUrl: document.sourceUrl, objectKey: document.storedObject.objectKey, sha256: document.storedObject.sha256, mediaType: document.storedObject.mediaType, byteSize: document.storedObject.byteSize })
      for (const asset of document.assets) {
        if (!asset.storedObject) throw new Error(`Asset object missing: ${asset.id}`)
        objects.push({ assetId: asset.id, parentDocumentId: document.id, sourceUrl: asset.sourceUrl, role: asset.role, objectKey: asset.storedObject.objectKey, sha256: asset.storedObject.sha256, mediaType: asset.storedObject.mediaType, byteSize: asset.storedObject.byteSize })
      }
    }
    return { run, index: { sourceUrl: raw.indexSourceUrl, objectKey: raw.indexObjectKey, sha256: raw.indexSha256 }, objects }
  }

  private async upsertObject(object: StoredBlob): Promise<string> {
    const saved = await this.prisma.storedObject.upsert({
      where: { sha256: object.sha256 },
      create: { sha256: object.sha256, bucket: object.bucket, objectKey: object.objectKey, mediaType: object.mediaType, byteSize: object.byteSize, versionId: object.versionId ?? null },
      update: {}, select: { id: true },
    })
    return saved.id
  }
}
