import { describe, expect, it } from 'vitest'
import { buildManifest } from '../../src/modules/scan-runs/application/build-manifest'
import type { CompletedRunSnapshot } from '../../src/modules/scan-runs/application/ports'

describe('buildManifest', () => {
  it('writes bigint byte counts as strings in stable source order', () => {
    const snapshot: CompletedRunSnapshot = {
      run: {
        id: 'run-1', status: 'RUNNING', currentStage: 'WRITING_MANIFEST', targetDate: '2026-07-11',
        startedAt: '2026-07-11T04:00:00.000Z', completedAt: null, errorSummary: null,
        counts: { editions: 1, documents: 1, assets: 1, completedItems: 1, totalItems: 1, failedItems: 0 },
        stages: [],
        editions: [{ id: 'edition-1', type: 'MAIN', supplementNo: null, documents: [{
          id: 'document-1', title: 'Karar', sourceUrl: 'https://www.resmigazete.gov.tr/b.htm', validationStatus: 'VALID', assetCount: 1,
        }] }],
      },
      index: { sourceUrl: 'https://www.resmigazete.gov.tr/11.07.2026', objectKey: 'runs/index.html', sha256: 'a'.repeat(64) },
      objects: [
        { assetId: 'asset-1', parentDocumentId: 'document-1', sourceUrl: 'https://www.resmigazete.gov.tr/z.png', role: 'IMAGE', objectKey: 'objects/z.png', sha256: 'c'.repeat(64), mediaType: 'image/png', byteSize: 7n },
        { documentId: 'document-1', sourceUrl: 'https://www.resmigazete.gov.tr/b.htm', objectKey: 'objects/b.html', sha256: 'b'.repeat(64), mediaType: 'text/html', byteSize: 12n },
      ],
    }

    const manifest = JSON.parse(buildManifest(snapshot).toString('utf8'))
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.totals.bytes).toBe('19')
    expect(manifest.editions[0].documents[0].assets[0].byteSize).toBe('7')
  })
})
