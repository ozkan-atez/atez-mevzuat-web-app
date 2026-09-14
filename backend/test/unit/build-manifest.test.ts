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
        previousSources: null,
        editions: [{ id: 'edition-1', type: 'MAIN', supplementNo: null, documents: [{
          id: 'document-1', title: 'Karar', sourceUrl: 'https://www.resmigazete.gov.tr/b.htm', validationStatus: 'VALID', assetCount: 1,
          filter: { titleDecision: 'MAYBE', finalDecision: 'IN', reason: 'İçerikte ithalat düzenlemesi var.' },
          previousSource: null,
        }] }],
        filter: { status: 'COMPLETED', counts: { in: 1, out: 0, pending: 0 }, retryAvailable: false, errorCategory: null, errorMessage: null },
      },
      index: { sourceUrl: 'https://www.resmigazete.gov.tr/11.07.2026', objectKey: 'runs/index.html', sha256: 'a'.repeat(64) },
      objects: [
        { assetId: 'asset-1', parentDocumentId: 'document-1', sourceUrl: 'https://www.resmigazete.gov.tr/z.png', role: 'IMAGE', objectKey: 'objects/z.png', sha256: 'c'.repeat(64), mediaType: 'image/png', byteSize: 7n },
        { documentId: 'document-1', sourceUrl: 'https://www.resmigazete.gov.tr/b.htm', objectKey: 'objects/b.html', sha256: 'b'.repeat(64), mediaType: 'text/html', byteSize: 12n },
      ],
      filterAudit: {
        model: 'gemini-3.8-flash',
        titlePromptVersion: 'title-v1',
        contentPromptVersion: 'content-v1',
        configurationHash: 'd'.repeat(64),
        decisions: [{
          documentId: 'document-1', titleDecision: 'MAYBE', titleReason: 'Başlık belirsiz.', titleConfidence: 0.51,
          contentDecision: 'IN', contentReason: 'İçerikte ithalat düzenlemesi var.', contentConfidence: 0.94, finalDecision: 'IN',
        }],
      },
      previousSourceAudit: [{
        documentId: 'document-1', status: 'COMPLETED', outcome: 'VERIFIED', model: 'gemini-3.7-flash',
        promptVersion: 'previous-source-preflight-v1', configurationHash: 'e'.repeat(64),
        intent: { needsPreviousSource: true, relationship: 'AMENDS', targetRegulationTitle: 'İthalat Rejimi Kararına Ek Karar', targetRegulationIdentifier: '2018/5', targetRegulationType: 'TEBLİĞ', targetInstitution: null, targetArticleReferences: ['1'], queryCandidates: ['2018/5'], reason: 'Önceki tebliği değiştiriyor.' },
        calls: [{ attemptNo: 1, status: 'COMPLETED', inputHash: 'f'.repeat(64), providerRequestId: 'provider-1', inputTokens: 50, outputTokens: 20, latencyMs: 400, errorCategory: null, providerStatus: null, errorMessage: null }],
        candidates: [{ query: '2018/5', title: 'İthalat Rejimi Kararına Ek Karar', publicationDate: '2025-12-31', gazetteNo: '33124', mukerrer: '4', url: '/fihrist?tarih=2025-12-31&mukerrer=4', documentUrl: 'https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M4-39.pdf', regulationType: 'TEBLİĞ', exactIdentifierMatch: true, titleScore: 1, score: 1, reasons: ['exact_identifier'], selected: true }],
        source: { title: 'İthalat Rejimi Kararına Ek Karar', publicationDate: '2025-12-31', gazetteNo: '33124', mukerrer: '4', sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M4-39.pdf', objectKey: 'objects/previous.pdf', sha256: '9'.repeat(64), mediaType: 'application/pdf', byteSize: 25n, assets: [] },
      }],
    }

    const manifest = JSON.parse(buildManifest(snapshot).toString('utf8'))
    expect(manifest.schemaVersion).toBe(3)
    expect(manifest.totals.bytes).toBe('44')
    expect(manifest.totals.previousSources).toBe(1)
    expect(manifest.editions[0].documents[0].assets[0].byteSize).toBe('7')
    expect(manifest.filterAudit.model).toBe('gemini-3.8-flash')
    expect(manifest.filterAudit.decisions[0]).toMatchObject({ titleConfidence: 0.51, contentConfidence: 0.94, finalDecision: 'IN' })
    expect(manifest.editions[0].documents[0].filter).toEqual({
      titleDecision: 'MAYBE', titleReason: 'Başlık belirsiz.', titleConfidence: 0.51,
      contentDecision: 'IN', contentReason: 'İçerikte ithalat düzenlemesi var.', contentConfidence: 0.94,
      finalDecision: 'IN', model: 'gemini-3.8-flash', titlePromptVersion: 'title-v1', contentPromptVersion: 'content-v1', configurationHash: 'd'.repeat(64),
    })
    expect(manifest.previousSourceAudit[0].source.byteSize).toBe('25')
    expect(manifest.previousSourceAudit[0].candidates[0]).toMatchObject({ selected: true, exactIdentifierMatch: true })
  })
})
