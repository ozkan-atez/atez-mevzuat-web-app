import { describe, expect, it } from 'vitest'
import { selectPreviousSource } from '../../src/modules/scan-runs/application/previous-source-matcher'

const intent = {
  needsPreviousSource: true as const,
  relationship: 'AMENDS' as const,
  targetRegulationTitle: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ',
  targetRegulationIdentifier: '2018/5',
  targetRegulationType: 'TEBLIG',
  targetInstitution: 'Ticaret Bakanlığı',
  targetArticleReferences: ['1 inci madde', 'tablo'],
  queryCandidates: ['2018/5'],
  reason: 'Tablo değiştiriliyor.',
}

describe('previous source matcher', () => {
  it('selects the nearest exact 2018/5 teblig and rejects 2018/5552', () => {
    const result = selectPreviousSource({ publicationDate: '2026-07-11' }, intent, [
      {
        query: '2018/5', title: 'Anayasa Mahkemesinin 2018/5552 Başvuru Numaralı Kararı',
        publicationDate: '2023-11-24', gazetteNo: '32379', mukerrer: null,
        url: 'https://www.resmigazete.gov.tr/fihrist?tarih=2023-11-24', regulationType: 'ANAYASA MAHKEMESİ KARARLARI',
      },
      {
        query: '2018/5', title: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (Tebliğ No: 2018/5)’de Değişiklik Yapılmasına Dair Tebliğ',
        publicationDate: '2023-06-23', gazetteNo: '32230', mukerrer: null,
        url: 'https://www.resmigazete.gov.tr/fihrist?tarih=2023-06-23', regulationType: 'TEBLİĞLER',
      },
      {
        query: '2018/5', title: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (Tebliğ No: 2018/5)’de Değişiklik Yapılmasına Dair Tebliğ',
        publicationDate: '2025-12-31', gazetteNo: '33124', mukerrer: 'EVET4',
        url: 'https://www.resmigazete.gov.tr/fihrist?tarih=2025-12-31&mukerrer=4', regulationType: 'TEBLİĞLER',
      },
    ])

    expect(result.outcome).toBe('VERIFIED')
    expect(result.selected?.publicationDate).toBe('2025-12-31')
    expect(result.candidates.find((candidate) => candidate.title.includes('2018/5552'))?.exactIdentifierMatch).toBe(false)
  })

  it('returns NOT_FOUND when only substring collisions exist', () => {
    const result = selectPreviousSource({ publicationDate: '2026-07-11' }, intent, [{
      query: '2018/5', title: 'Anayasa Mahkemesinin 2018/5552 Başvuru Numaralı Kararı',
      publicationDate: '2023-11-24', gazetteNo: '32379', mukerrer: null,
      url: 'https://www.resmigazete.gov.tr/fihrist?tarih=2023-11-24', regulationType: 'ANAYASA MAHKEMESİ KARARLARI',
    }])
    expect(result).toMatchObject({ outcome: 'NOT_FOUND', selected: null })
  })
})
