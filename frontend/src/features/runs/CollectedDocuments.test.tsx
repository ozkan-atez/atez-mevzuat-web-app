import { cleanup, fireEvent, render, screen } from '../../test/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { CollectedDocuments } from './CollectedDocuments'
import type { ScanRunDetail } from '../scans/types'
const editions: ScanRunDetail['editions'] = [{ id: 'e1', type: 'MAIN', supplementNo: null, documents: Array.from({ length: 18 }, (_, index) => ({ id: `d${index}`, title: `–– Belge ${index + 1} — 2026/62`, sourceUrl: `https://www.resmigazete.gov.tr/${index}.htm`, assetCount: 1, validationStatus: 'VALID', filter: { titleDecision: 'IN', finalDecision: 'OUT', reason: `Gerekçe ${index + 1}` }, previousSource: null })) }]
afterEach(cleanup)
describe('compact collected documents', () => {
  it('cleans list markers, preserves legal punctuation and hides explanations until expanded', () => {
    render(<CollectedDocuments editions={editions} />)
    expect(screen.getByRole('link', { name: 'Belge 1 — 2026/62' })).toHaveAttribute('href', editions[0]!.documents[0]!.sourceUrl)
    expect(screen.queryByRole('link', { name: /^––/ })).not.toBeInTheDocument()
    const summary = screen.getByLabelText('Belge 1 — 2026/62 — Ayrıntılar')
    expect(summary.closest('details')).not.toHaveAttribute('open')
    fireEvent.click(summary)
    expect(summary.closest('details')).toHaveAttribute('open')
    expect(screen.getByText('Gerekçe 1')).toBeVisible()
  })
  it('limits the list to eight documents and makes the remaining documents accessible', () => {
    render(<CollectedDocuments editions={editions} />)
    expect(screen.getAllByRole('link', { name: /^Belge/ })).toHaveLength(8)
    expect(screen.queryByRole('link', { name: 'Belge 9 — 2026/62' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('2'))
    expect(screen.getByRole('link', { name: 'Belge 9 — 2026/62' })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Belge 1 — 2026/62' })).not.toBeInTheDocument()
  })
  it('labels each external group with its registered source name', () => {
    const sources = ['TARIFF', 'İGMD', 'Özel Kaynak']
    render(<CollectedDocuments
      editions={sources.map((_, index) => ({ ...editions[0]!, id: `e${index}`, type: 'EXTERNAL', documents: [{ ...editions[0]!.documents[0]!, id: `d${index}` }] }))}
      sourceRuns={sources.map((name, index) => ({ id: `e${index}`, status: 'COMPLETED', source: { name, key: `source-${index}` }, documentCount: 1, errorSummary: null }))}
    />)
    for (const name of sources) expect(screen.getByRole('heading', { name })).toBeVisible()
    expect(screen.queryByText('Dış kaynak belgeleri')).not.toBeInTheDocument()
    expect(screen.queryByText(/Mükerrer Sayı/)).not.toBeInTheDocument()
  })
  it('keeps Gazette edition information alongside its source name', () => {
    render(<CollectedDocuments editions={[
      { ...editions[0]!, documents: editions[0]!.documents.slice(0, 1) },
      { ...editions[0]!, id: 'supplement', type: 'SUPPLEMENT', supplementNo: 2, documents: editions[0]!.documents.slice(1, 2) },
    ]} />)
    expect(screen.getByRole('heading', { name: 'Resmî Gazete · Ana Sayı' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Resmî Gazete · 2. Mükerrer Sayı' })).toBeVisible()
  })
  it('uses the source hostname when source metadata is unavailable', () => {
    render(<CollectedDocuments editions={[{ ...editions[0]!, type: 'EXTERNAL' }]} />)
    expect(screen.getByRole('heading', { name: 'resmigazete.gov.tr' })).toBeVisible()
  })
})
