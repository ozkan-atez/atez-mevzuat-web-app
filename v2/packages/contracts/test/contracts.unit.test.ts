import { describe, expect, it } from 'vitest'
import { Envelope, ProfileModelOutput, RecipeDefinition, STEP_CATALOG } from '../src/index'

describe('RecipeDefinition', () => {
  const base = { key: 'x', version: 1, title: 't' }
  it('geçerli tarifi kabul eder', () => {
    expect(() => RecipeDefinition.parse({ ...base, nodes: [{ id: 'a', step: 'demo.split' }, { id: 'b', step: 'demo.upper', after: ['a'], fanOut: 'words' }] })).not.toThrow()
  })
  it('katalogda olmayan adımı, bilinmeyen önceki düğümü ve döngüyü reddeder', () => {
    expect(() => RecipeDefinition.parse({ ...base, nodes: [{ id: 'a', step: 'nope' }] })).toThrow(/Katalogda olmayan/)
    expect(() => RecipeDefinition.parse({ ...base, nodes: [{ id: 'a', step: 'demo.split', after: ['z'] }] })).toThrow(/bilinmeyen/)
    expect(() =>
      RecipeDefinition.parse({ ...base, nodes: [{ id: 'a', step: 'demo.split', after: ['b'] }, { id: 'b', step: 'demo.split', after: ['a'] }] }),
    ).toThrow(/döngü/)
  })
  it('fanOut yalnızca tek önceki ve bariyersiz düğümde', () => {
    expect(() =>
      RecipeDefinition.parse({ ...base, nodes: [{ id: 'a', step: 'demo.split' }, { id: 'b', step: 'demo.join', after: ['a'], fanOut: 'x', barrier: true }] }),
    ).toThrow(/fanOut/)
  })
})

describe('Envelope', () => {
  it('zorunlu alanları doğrular', () => {
    const ok = {
      messageId: crypto.randomUUID(),
      type: 'step.execute',
      correlationId: 'r',
      idempotencyKey: 'k',
      attempt: 1,
      actor: { kind: 'system', workspaceId: 'default', userId: null },
      occurredAt: new Date().toISOString(),
      payload: {},
    }
    expect(Envelope.parse(ok)).toEqual(ok)
    expect(() => Envelope.parse({ ...ok, attempt: 0 })).toThrow()
  })
})

describe('STEP_CATALOG', () => {
  it('her adım bir havuza ait', () => {
    for (const [k, c] of Object.entries(STEP_CATALOG)) expect(c.pool, k).toBeTruthy()
  })
})

describe('ProfileModelOutput', () => {
  it('örnek profili kabul eder', () => {
    const p = {
      decision: 'IN',
      coverage: { expected: { files: 1, pages: 3, tables: 0 }, read: { files: 1, pages: 3, tables: 0 }, complete: true },
      basisQuotes: [{ quote: 'İthalat', file: 'f1', page: 1 }],
      relevance: { score: 0.9, categories: ['ithalat'] },
      rationale: 'Madde 1 ithalat rejimini değiştiriyor.',
      identity: { docType: 'KARAR', title: 'X', institution: null, officialNumber: '10790' },
      summary: 'Özet.',
      change: { kind: 'AMENDMENT', effectiveRules: [{ rule: 'ON_PUBLICATION', explicitDate: null, days: null, scope: null, evidencePage: 2 }] },
      gtip: { present: true, codes: [{ code: '8703.23', level: '6', context: 'x', page: 2 }], tables: [] },
      references: [],
      lineage: { needsPrior: true, strategyHint: 'TARIFF', rgQueries: [], tariffQueries: [{ code: '8703.23', field: 'GUMRUK_VERGISI' }] },
      affected: { parties: [], sectors: [] },
      keyPages: [1],
      keywords: ['ithalat'],
      confidence: 0.8,
    }
    expect(ProfileModelOutput.parse(p).decision).toBe('IN')
  })
})
