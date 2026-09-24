import { describe, expect, it } from 'vitest'
import { detectAndValidate } from '../../src/modules/scan-runs/infrastructure/file-validator'
import { fixtureFile } from '../helpers/files'

describe('detectAndValidate', () => {
  it('rejects HTML returned for a PDF URL', async () => {
    const file = await fixtureFile('<html>blocked</html>', 'application/pdf')
    await expect(detectAndValidate(file.tempPath, 'application/pdf', 'https://www.resmigazete.gov.tr/a.pdf'))
      .rejects.toThrow('PDF signature is missing')
  })

  it('recognizes a PNG by bytes rather than extension', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64')
    const file = await fixtureFile(png, 'application/octet-stream')
    await expect(detectAndValidate(file.tempPath, 'application/octet-stream', 'https://www.resmigazete.gov.tr/a'))
      .resolves.toEqual({ mediaType: 'image/png' })
  })

  it('accepts HTML only when it contains HTML markup', async () => {
    const file = await fixtureFile('<!doctype html><html><body>ok</body></html>', 'text/html')
    await expect(detectAndValidate(file.tempPath, 'text/html', 'https://www.resmigazete.gov.tr/a.htm'))
      .resolves.toEqual({ mediaType: 'text/html' })
  })
})
