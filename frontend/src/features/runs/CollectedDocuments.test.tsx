import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { CollectedDocuments } from './CollectedDocuments'
import type { ScanRunDetail } from '../scans/types'

const editions: ScanRunDetail['editions'] = [{
  id: 'main', type: 'MAIN', supplementNo: null,
  documents: Array.from({ length: 9 }, (_, index) => ({
    id: `doc-${index + 1}`, title: `Belge ${index + 1}`, sourceUrl: `https://www.resmigazete.gov.tr/doc-${index + 1}`,
    validationStatus: 'VALID' as const, assetCount: 0,
    filter: { titleDecision: 'MAYBE' as const, finalDecision: index === 0 ? 'IN' as const : 'OUT' as const, reason: `Gerekçe ${index + 1}` },
    previousSource: null,
  })),
}]

describe('CollectedDocuments', () => {
  it('keeps many documents compact and reveals one detail on demand', async () => {
    const user = userEvent.setup()
    render(<CollectedDocuments editions={editions} />)
    expect(screen.getByTestId('collected-document-list')).toHaveClass('max-h-[420px]')
    expect(screen.getByText('Belge 9')).toBeVisible()
    expect(screen.queryByText('Gerekçe 1')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Belge 1 ayrıntılarını aç' }))
    expect(screen.getByText('Gerekçe 1')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'İlgili 1' }))
    expect(screen.getByText('Belge 1')).toBeVisible()
    expect(screen.queryByText('Belge 9')).not.toBeInTheDocument()
    expect(screen.queryByText('Gerekçe 1')).not.toBeInTheDocument()
  })
})
