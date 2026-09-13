import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { candidateIndexUrls, parseAssets, parseEditions } from '../../src/modules/scan-runs/infrastructure/resmi-gazete-parser'

let indexFixture = ''
let documentFixture = ''
const archiveUrl = 'https://www.resmigazete.gov.tr/eskiler/2026/07/20260711.htm'
const documentUrl = 'https://www.resmigazete.gov.tr/eskiler/2026/07/20260711-1.htm'

beforeAll(async () => {
  const root = resolve('test/fixtures/resmi-gazete/2026-07-11')
  indexFixture = await readFile(resolve(root, 'index.html'), 'utf8')
  documentFixture = await readFile(resolve(root, 'document.html'), 'utf8')
})

describe('Resmî Gazete parser', () => {
  it('builds daily and archive candidates', () => {
    expect(candidateIndexUrls('2026-07-11')).toEqual([
      'https://www.resmigazete.gov.tr/11.07.2026',
      archiveUrl,
    ])
  })

  it('keeps ordered same-date main and supplement documents only', () => {
    const editions = parseEditions(indexFixture, archiveUrl, '2026-07-11')
    expect(editions.map((item) => [item.type, item.supplementNo])).toEqual([
      ['MAIN', null], ['SUPPLEMENT', 1], ['SUPPLEMENT', 2],
    ])
    expect(editions.flatMap((item) => item.documents)).toHaveLength(4)
  })

  it('discovers five supported official assets and rejects unsafe ones', () => {
    const assets = parseAssets(documentFixture, documentUrl)
    expect(assets).toHaveLength(5)
    expect(assets.map((asset) => asset.role)).toContain('ATTACHMENT')
    expect(assets.map((asset) => asset.role)).toContain('IMAGE')
    expect(assets.every((asset) => new URL(asset.sourceUrl).hostname === 'www.resmigazete.gov.tr')).toBe(true)
  })
})
