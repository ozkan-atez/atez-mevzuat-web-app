import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { candidateIndexUrls, parseAssets, parseEditions, parseIssueNumber } from '../../src/modules/scan-runs/infrastructure/resmi-gazete-parser'

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

  it('extracts same-date announcement pages from the official legacy wrapper', () => {
    const html = `<!doctype html><html><body>
      <a href="20260914-1.htm">Yönetmelik</a>
      <a href="http://www.resmigazete.gov.tr/main.aspx?home=x&amp;main=http://www.resmigazete.gov.tr/ilanlar/eskiilanlar/2026/09/20260914-2.htm">a - Yargı İlânı</a>
      <a href="http://www.resmigazete.gov.tr/main.aspx?main=http://www.resmigazete.gov.tr/ilanlar/eskiilanlar/2026/09/20260914-3.htm">b - İhale İlânları</a>
      <a href="http://www.resmigazete.gov.tr/main.aspx?main=https://example.com/20260914-4.htm">Haricî</a>
    </body></html>`

    const documents = parseEditions(
      html,
      'https://www.resmigazete.gov.tr/eskiler/2026/09/20260914.htm',
      '2026-09-14',
    ).flatMap((edition) => edition.documents)

    expect(documents.map((document) => document.title)).toEqual(['Yönetmelik', 'a - Yargı İlânı', 'b - İhale İlânları'])
    expect(documents.slice(1).map((document) => document.sourceUrl)).toEqual([
      'https://www.resmigazete.gov.tr/ilanlar/eskiilanlar/2026/09/20260914-2.htm',
      'https://www.resmigazete.gov.tr/ilanlar/eskiilanlar/2026/09/20260914-3.htm',
    ])
  })

  it('discovers five supported official assets and rejects unsafe ones', () => {
    const assets = parseAssets(documentFixture, documentUrl)
    expect(assets).toHaveLength(5)
    expect(assets.map((asset) => asset.role)).toContain('ATTACHMENT')
    expect(assets.map((asset) => asset.role)).toContain('IMAGE')
    expect(assets.every((asset) => new URL(asset.sourceUrl).hostname === 'www.resmigazete.gov.tr')).toBe(true)
  })

  it('archives supported image files that are exposed only as links', () => {
    const assets = parseAssets('<a href="./20260711-31_dosyalar/image002.jpg">Değişiklik tablosu</a><a href="./diagram.gif">Şema</a>', documentUrl)
    expect(assets).toEqual([
      { sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/07/20260711-31_dosyalar/image002.jpg', role: 'IMAGE', referenceText: 'Değişiklik tablosu' },
      { sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/07/diagram.gif', role: 'IMAGE', referenceText: 'Şema' },
    ])
  })
})

describe('parseIssueNumber', () => {
  it('reads the issue number from the entity-encoded header the site actually serves', () => {
    const html = '<h6><u><span id="spanGazeteTarih">14 Eyl&#xFC;l 2026 Tarihli ve 33370 Say&#x131;l&#x131; Resm&#xEE; Gazete</span></u></h6>'

    expect(parseIssueNumber(html)).toBe('33370')
  })

  it('falls back to the page text when the header element is missing', () => {
    const html = '<body><p>13 Eyl&#xFC;l 2026 Tarihli ve 33369 Say&#x131;l&#x131; Resm&#xEE; Gazete</p></body>'

    expect(parseIssueNumber(html)).toBe('33369')
  })

  it('returns null when the page carries no issue number', () => {
    expect(parseIssueNumber('<body><p>Resm\u00ee Gazete arşivi</p></body>')).toBeNull()
  })
})
