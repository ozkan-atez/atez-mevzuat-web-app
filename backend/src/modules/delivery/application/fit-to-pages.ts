/** A4 height in PostScript points, matching `@page { size:A4 }` in the bulten-v2 template. */
export const A4_HEIGHT_PT = 841.92
/** 15mm, matching `@page { margin:15mm }` in the same template. */
export const PAGE_MARGIN_PT = (15 / 25.4) * 72
export const USABLE_HEIGHT_PT = A4_HEIGHT_PT - 2 * PAGE_MARGIN_PT

/**
 * Below this the type gets too small to read comfortably in print, so a report that
 * would need more shrinking keeps its natural size and simply runs longer.
 */
export const MIN_PRINT_SCALE = 0.9

/**
 * Decides how much to shrink a bulletin so it does not spill a few points onto an
 * almost empty extra page.
 *
 * Only ever shrinks, and only by enough to drop exactly one page: scaling up would
 * push a report that already fits onto a second page, and shrinking further than
 * MIN_PRINT_SCALE would trade a page for unreadable type.
 */
export function resolvePrintScale(input: { contentHeightPt: number; usableHeightPt?: number; minScale?: number }): number {
  const usable = input.usableHeightPt ?? USABLE_HEIGHT_PT
  const minScale = input.minScale ?? MIN_PRINT_SCALE
  if (!Number.isFinite(input.contentHeightPt) || input.contentHeightPt <= 0 || usable <= 0) return 1

  const pages = Math.max(1, Math.ceil(input.contentHeightPt / usable))
  if (pages === 1) return 1

  const wanted = ((pages - 1) * usable) / input.contentHeightPt
  if (wanted >= 1 || wanted < minScale) return 1
  // Rounded down so the scaled content stays strictly inside the target pages.
  return Math.floor(wanted * 100) / 100
}
