import { describe, expect, it } from 'vitest'
import {
  buildTitleFilterRequest,
  CONTENT_FILTER_PROMPT_VERSION,
  TITLE_FILTER_PROMPT_VERSION,
} from '../../src/modules/scan-runs/application/document-filter-prompts'
import {
  parseContentFilterResponse,
  parseTitleFilterResponse,
} from '../../src/modules/scan-runs/application/document-filter-schemas'

describe('document filter prompts and schemas', () => {
  it('puts every stable document ID and title in one semantic title request', () => {
    const built = buildTitleFilterRequest([
      { id: 'doc-1', title: 'İthalat Rejimi Kararında Değişiklik', publicationOrder: 1, editionLabel: 'Ana Sayı' },
      { id: 'doc-2', title: 'Üniversite Yönetmeliği', publicationOrder: 2, editionLabel: 'Ana Sayı' },
    ], 'gemini-3.8-flash')

    expect(built.request.model).toBe('gemini-3.8-flash')
    expect(built.request.parts).toHaveLength(1)
    expect(built.request.parts[0]).toMatchObject({ text: expect.stringContaining('doc-1') })
    expect(built.request.parts[0]).toMatchObject({ text: expect.stringContaining('doc-2') })
    expect(built.request.systemInstruction).toContain('kesin eşleştirme kuralları değildir')
    expect(built.configurationHash).toMatch(/^[a-f0-9]{64}$/)
    expect(TITLE_FILTER_PROMPT_VERSION).toBe('document-filter-title-v1')
    expect(CONTENT_FILTER_PROMPT_VERSION).toBe('document-filter-content-v1')
  })

  it('rejects a title response missing an expected document', () => {
    expect(() => parseTitleFilterResponse({ decisions: [
      { documentId: 'doc-1', decision: 'IN', reason: 'İthalatı düzenliyor.', confidence: 0.9 },
    ] }, ['doc-1', 'doc-2'])).toThrow('missing document IDs')
  })

  it('rejects duplicate and unknown document IDs', () => {
    expect(() => parseTitleFilterResponse({ decisions: [
      { documentId: 'doc-1', decision: 'OUT', reason: 'İlgisiz.', confidence: 0.8 },
      { documentId: 'doc-1', decision: 'IN', reason: 'Tekrar.', confidence: 0.7 },
    ] }, ['doc-1'])).toThrow('duplicate document IDs')
    expect(() => parseTitleFilterResponse({ decisions: [
      { documentId: 'doc-2', decision: 'OUT', reason: 'İlgisiz.', confidence: 0.8 },
    ] }, ['doc-1'])).toThrow('unknown document IDs')
  })

  it('requires the content pass to return final IN or OUT', () => {
    expect(() => parseContentFilterResponse({ decisions: [
      { documentId: 'doc-1', decision: 'MAYBE', reason: 'Kararsız.', confidence: 0.5 },
    ] }, ['doc-1'])).toThrow('final IN or OUT')
  })
})
