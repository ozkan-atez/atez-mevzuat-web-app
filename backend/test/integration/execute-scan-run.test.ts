import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { executeScanRun } from '../../src/modules/scan-runs/application/execute-scan-run'
import type { DownloadedFile, ObjectStore, OfficialHttp, StoredBlob } from '../../src/modules/scan-runs/application/ports'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
import { fixtureFile } from '../helpers/files'

class FixtureHttp implements OfficialHttp {
  async download(url: string, _directory: string): Promise<DownloadedFile> {
    let file: DownloadedFile
    if (url.endsWith('.png')) {
      file = await fixtureFile(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64'), 'image/png')
    } else if (url.endsWith('.htm')) {
      file = await fixtureFile('<!doctype html><html><body><img src="./chart.png"></body></html>', 'text/html')
    } else {
      file = await fixtureFile('<!doctype html><html><body><a href="/eskiler/2026/07/20260711-1.htm">Karar</a></body></html>', 'text/html')
    }
    return { ...file, sourceUrl: url }
  }
}

class MemoryObjectStore implements ObjectStore {
  readonly runFiles: string[] = []
  async ensureBucket(): Promise<void> {}
  async exists(): Promise<boolean> { return false }
  async getContent(): Promise<Buffer> { throw new Error('Object is not available') }
  async putContent(file: DownloadedFile): Promise<StoredBlob> {
    return { ...file, bucket: 'test', objectKey: `objects/${file.sha256}` }
  }
  async putRunFile(key: string, body: Buffer, mediaType: string): Promise<StoredBlob> {
    this.runFiles.push(key)
    return { sha256: 'f'.repeat(64), bucket: 'test', objectKey: key, mediaType, byteSize: BigInt(body.length) }
  }
}

const prisma = new PrismaClient()
const repository = new PrismaScanRepository(prisma)

describe('executeScanRun', () => {
  beforeEach(async () => {
    await prisma.scanRun.deleteMany()
  })
  afterAll(() => prisma.$disconnect())

  it('writes the manifest before completing a fully collected run', async () => {
    const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-07-11' })
    const objectStore = new MemoryObjectStore()

    await executeScanRun(run.id, {
      repository,
      http: new FixtureHttp(),
      objectStore,
      maxRunBytes: 10_000n,
    })

    const saved = await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(saved.status).toBe('COMPLETED')
    expect(saved.manifestObjectKey).toBe(`runs/2026/07/11/${run.id}/manifest.json`)
    expect(objectStore.runFiles.at(-1)).toBe(saved.manifestObjectKey)
    expect(await prisma.collectedDocument.count()).toBe(1)
    expect(await prisma.documentAsset.count()).toBe(1)
  })
})
