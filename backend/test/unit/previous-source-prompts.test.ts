import { describe, expect, it } from 'vitest'
import {
  buildPreviousSourcePreflightRequest,
  PREVIOUS_SOURCE_PROMPT_VERSION,
} from '../../src/modules/scan-runs/application/previous-source-prompts'
import { parsePreviousSourcePreflightResponse } from '../../src/modules/scan-runs/application/previous-source-schemas'

describe('previous source preflight prompt and schema', () => {
  it('extracts a compact search intent from the 2018/5 amendment context', () => {
    const built = buildPreviousSourcePreflightRequest({
      documentId: 'doc-2018-5',
      title: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (Tebliğ No: 2018/5)’de Değişiklik Yapılmasına Dair Tebliğ',
      publicationDate: '2026-07-11',
      sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/07/20260711-31.htm',
      documentType: 'TEBLIG',
      visibleText: '16/4/2018 tarihli ve 30393 sayılı Resmî Gazete’de yayımlanan Tebliğ No: 2018/5’in 1 inci maddesindeki tablo değiştirilmiştir.',
    }, 'gemini-3.7-flash')

    expect(built.request.model).toBe('gemini-3.7-flash')
    expect(built.request.parts).toEqual([{ text: expect.stringContaining('2018/5') }])
    expect(built.request.systemInstruction).toContain('yalnızca önceki kaynak aramasını daralt')
    expect(built.configurationHash).toMatch(/^[a-f0-9]{64}$/)
    expect(PREVIOUS_SOURCE_PROMPT_VERSION).toBe('previous-source-preflight-v1')

    expect(parsePreviousSourcePreflightResponse({
      needsPreviousSource: true,
      relationship: 'AMENDS',
      targetRegulationTitle: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ',
      targetRegulationIdentifier: '2018/5',
      targetRegulationType: 'TEBLIG',
      targetInstitution: 'Ticaret Bakanlığı',
      targetArticleReferences: ['1 inci madde', 'tablo'],
      queryCandidates: ['2018/5', 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ'],
      reason: 'Mevcut tebliğin tablosunu değiştiriyor.',
    })).toMatchObject({ targetRegulationIdentifier: '2018/5', relationship: 'AMENDS' })
  })

  it('accepts a non-amendment without search fields', () => {
    expect(parsePreviousSourcePreflightResponse({
      needsPreviousSource: false,
      relationship: 'NONE',
      targetRegulationTitle: null,
      targetRegulationIdentifier: null,
      targetRegulationType: null,
      targetInstitution: null,
      targetArticleReferences: [],
      queryCandidates: [],
      reason: 'İlk kez yayımlanan bağımsız düzenleme.',
    }).needsPreviousSource).toBe(false)
  })

  it('rejects inconsistent or unbounded search intents', () => {
    const base = {
      needsPreviousSource: true,
      relationship: 'NONE',
      targetRegulationTitle: null,
      targetRegulationIdentifier: null,
      targetRegulationType: null,
      targetInstitution: null,
      targetArticleReferences: [],
      queryCandidates: [],
      reason: 'Tutarsız.',
    }
    expect(() => parsePreviousSourcePreflightResponse(base)).toThrow('search intent')
    expect(() => parsePreviousSourcePreflightResponse({
      ...base,
      relationship: 'AMENDS',
      targetRegulationIdentifier: '2018/5',
      queryCandidates: ['1', '2', '3', '4'],
    })).toThrow()
  })
})
