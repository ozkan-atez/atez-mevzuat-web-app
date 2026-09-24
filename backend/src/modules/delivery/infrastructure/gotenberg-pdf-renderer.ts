import { DeliveryError } from '../domain/delivery-errors'
import { PAGE_MARGIN_PT, resolvePrintScale } from '../application/fit-to-pages'
import type { PdfRenderer } from '../application/ports'

/** 15mm, matching `@page { margin:15mm }` in the bulten-v2 template. */
const MARGIN_INCHES = '0.59'
/** A4 in inches, used only for the measuring pass where `preferCssPageSize` cannot apply. */
const A4_WIDTH_INCHES = '8.27'
const A4_HEIGHT_INCHES = '11.7'

interface Options {
  url: string
  timeoutMs: number
}

/**
 * Gotenberg renders the already validated report HTML with Chromium, so the PDF
 * matches what the preview shows. The HTML is self-contained (inline CSS, logo as
 * a data URI), which is why no asset upload is needed alongside it.
 */
export class GotenbergPdfRenderer implements PdfRenderer {
  constructor(private readonly options: Options) {}

  async renderHtml(html: string): Promise<Buffer> {
    const scale = resolvePrintScale({ contentHeightPt: await this.measureContentHeight(html) })
    return this.convert(html, {
      // Without this Chromium falls back to US Letter and ignores the template's
      // `@page { size:A4 }`; margins mirror the template's declared 15mm, because
      // Chromium takes the page size from CSS but the margins only from here.
      preferCssPageSize: 'true',
      ...(scale === 1 ? {} : { scale: String(scale) }),
    })
  }

  /**
   * Renders the report onto a single tall page to learn how much content there is.
   * `singlePage` is incompatible with `preferCssPageSize`, so the A4 width and the
   * margins are passed explicitly — otherwise the measurement would reflow at a
   * different width than the real output and the page maths would not hold.
   */
  private async measureContentHeight(html: string): Promise<number> {
    try {
      const pdf = await this.convert(html, {
        singlePage: 'true',
        paperWidth: A4_WIDTH_INCHES,
        paperHeight: A4_HEIGHT_INCHES,
      })
      const heights = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[([^\]]*)\]/g)]
        .map((match) => Number(match[1]?.trim().split(/\s+/)[3]))
        .filter((value) => Number.isFinite(value))
      if (heights.length === 0) return 0
      return Math.max(...heights) - 2 * PAGE_MARGIN_PT
    } catch {
      // Measuring is an optimisation; a failure must not cost the user their PDF.
      return 0
    }
  }

  private async convert(html: string, extra: Record<string, string>): Promise<Buffer> {
    const form = new FormData()
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
    // The template's layout for paper lives in its `@media print` block, which only
    // applies when Chromium emulates print media.
    form.append('emulatedMediaType', 'print')
    form.append('printBackground', 'true')
    form.append('marginTop', MARGIN_INCHES)
    form.append('marginBottom', MARGIN_INCHES)
    form.append('marginLeft', MARGIN_INCHES)
    form.append('marginRight', MARGIN_INCHES)
    for (const [key, value] of Object.entries(extra)) form.append(key, value)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
    try {
      const response = await fetch(`${this.options.url}/forms/chromium/convert/html`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new DeliveryError('PDF_UNAVAILABLE', 'PDF servisi raporu dönüştüremedi.', response.status)
      }
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      if (error instanceof DeliveryError) throw error
      throw new DeliveryError('PDF_UNAVAILABLE', 'PDF servisine ulaşılamadı.')
    } finally {
      clearTimeout(timer)
    }
  }
}
