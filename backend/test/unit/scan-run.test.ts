import { describe, expect, it } from 'vitest'
import { assertStageTransition, scanStages } from '../../src/modules/scan-runs/domain/scan-run'

describe('scan state machine', () => {
  it('allows the next ordered stage', () => {
    expect(() => assertStageTransition('DOWNLOADING_DOCUMENTS', 'DISCOVERING_ASSETS')).not.toThrow()
  })

  it('rejects a skipped stage', () => {
    expect(() => assertStageTransition('DISCOVERING', 'VALIDATING')).toThrow('Invalid stage transition')
  })

  it('places AI filtering immediately after discovery', () => {
    expect(scanStages).toEqual([
      'DISCOVERING',
      'AI_FILTERING',
      'DOWNLOADING_DOCUMENTS',
      'DISCOVERING_ASSETS',
      'DOWNLOADING_ASSETS',
      'VALIDATING',
      'WRITING_MANIFEST',
    ])
    expect(() => assertStageTransition('DISCOVERING', 'AI_FILTERING')).not.toThrow()
    expect(() => assertStageTransition('AI_FILTERING', 'DOWNLOADING_DOCUMENTS')).not.toThrow()
  })
})
