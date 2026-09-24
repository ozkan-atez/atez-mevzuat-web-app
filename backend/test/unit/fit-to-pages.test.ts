import { describe, expect, it } from 'vitest'
import { MIN_PRINT_SCALE, USABLE_HEIGHT_PT, resolvePrintScale } from '../../src/modules/delivery/application/fit-to-pages'

describe('resolvePrintScale', () => {
  it('leaves a report that already fits at its natural size', () => {
    expect(resolvePrintScale({ contentHeightPt: USABLE_HEIGHT_PT - 100 })).toBe(1)
    expect(resolvePrintScale({ contentHeightPt: USABLE_HEIGHT_PT })).toBe(1)
  })

  it('never enlarges a short report onto a second page', () => {
    // A single short bulletin must not be scaled up to fill the sheet.
    expect(resolvePrintScale({ contentHeightPt: 511 })).toBe(1)
  })

  it('shrinks a report that only just overflows so it stays on one page', () => {
    const scale = resolvePrintScale({ contentHeightPt: 806 })

    expect(scale).toBeGreaterThanOrEqual(MIN_PRINT_SCALE)
    expect(scale).toBeLessThan(1)
    expect(806 * scale).toBeLessThanOrEqual(USABLE_HEIGHT_PT)
  })

  it('keeps the natural size when saving a page would need unreadable type', () => {
    // 1064pt is genuinely two pages; squeezing it to one would need ~0.71.
    expect(resolvePrintScale({ contentHeightPt: 1064 })).toBe(1)
  })

  it('drops the third page of a report that barely spills past two', () => {
    const contentHeightPt = USABLE_HEIGHT_PT * 2 + 30
    const scale = resolvePrintScale({ contentHeightPt })

    expect(scale).toBeLessThan(1)
    expect(contentHeightPt * scale).toBeLessThanOrEqual(USABLE_HEIGHT_PT * 2)
  })

  it('falls back to the natural size when the measurement is unusable', () => {
    expect(resolvePrintScale({ contentHeightPt: 0 })).toBe(1)
    expect(resolvePrintScale({ contentHeightPt: Number.NaN })).toBe(1)
    expect(resolvePrintScale({ contentHeightPt: -5 })).toBe(1)
  })
})
