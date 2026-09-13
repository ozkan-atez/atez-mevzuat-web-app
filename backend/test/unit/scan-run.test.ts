import { describe, expect, it } from 'vitest'
import { assertStageTransition } from '../../src/modules/scan-runs/domain/scan-run'

describe('scan state machine', () => {
  it('allows the next ordered stage', () => {
    expect(() => assertStageTransition('DISCOVERING', 'DOWNLOADING_DOCUMENTS')).not.toThrow()
  })

  it('rejects a skipped stage', () => {
    expect(() => assertStageTransition('DISCOVERING', 'VALIDATING')).toThrow('Invalid stage transition')
  })
})
