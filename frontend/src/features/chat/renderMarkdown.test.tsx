import { render, screen, cleanup } from '../../test/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { renderMarkdown } from './renderMarkdown'

afterEach(cleanup)

describe('renderMarkdown', () => {
  it('renders the emphasis the model writes instead of its asterisks', () => {
    render(<>{renderMarkdown('Serbest bölgeler **vergi muafiyeti** sağlar.')}</>)

    expect(screen.getByText('vergi muafiyeti').tagName).toBe('STRONG')
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument()
  })

  it('renders bullet and numbered lists', () => {
    render(<>{renderMarkdown('Adımlar:\n\n- Beyanname\n- Tarife\n\n1. Başvuru\n2. Onay')}</>)

    expect(screen.getAllByRole('list')).toHaveLength(2)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Beyanname', 'Tarife', 'Başvuru', 'Onay'])
  })

  it('never turns model output into markup', () => {
    const { container } = render(<>{renderMarkdown('<img src=x onerror="alert(1)"> ve <b>kalın</b>')}</>)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
  })

  it('links only internal run paths from a scan response', () => {
    render(<>{renderMarkdown('Taramayı izle: /runs/scan-28')}</>)
    expect(screen.getByRole('link', { name: '/runs/scan-28' })).toHaveAttribute('href', '/runs/scan-28')
  })
  it('links published report paths without enabling external or script links', () => {
    render(<>{renderMarkdown('[Bülteni aç](/reports/topic-1?revision=2) [Kötü](javascript:alert(1))')}</>)
    expect(screen.getByRole('link', { name: 'Bülteni aç' })).toHaveAttribute('href', '/reports/topic-1?revision=2')
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

})

it('links saved HTML reports and operation requests with their complete paths', () => {
  render(<>{renderMarkdown('[Raporu aç](/reports/documents/report-1) [İşlemi izle](/operations/op-1)')}</>)
  expect(screen.getByRole('link', {name:'Raporu aç'})).toHaveAttribute('href','/reports/documents/report-1')
  expect(screen.getByRole('link', {name:'İşlemi izle'})).toHaveAttribute('href','/operations/op-1')
})

it('renders a source link once and rejects active URL schemes', () => {
  render(<>{renderMarkdown('[Ticaret duyurusu](https://ticaret.gov.tr/duyurular/ornek) [Kötü](javascript:alert(1)) [Veri](data:text/html,test)')}</>)
  expect(screen.getAllByRole('link')).toHaveLength(1)
  expect(screen.getByRole('link',{name:'Ticaret duyurusu'})).toHaveAttribute('href','https://ticaret.gov.tr/duyurular/ornek')
  expect(screen.getByRole('link')).toHaveAttribute('rel','noopener noreferrer')
})


it('renders legacy authenticated Tariff citations without unusable links', () => {
  render(<>{renderMarkdown('[**Tariff Sorgusu**](https://tariff.singlewindow.io/api/v2-0/tariff-query/tariff-measures-by-commodity?commodityCode=691090000000&queryDate=2026-07-12) [Mevzuat referansı](https://www.resmigazete.gov.tr/eskiler/2026/07/20260711-31.htm)')}</>)
  expect(screen.getByText('Tariff (yetkilendirilmiş sorgu)')).toBeInTheDocument()
  expect(screen.getAllByRole('link')).toHaveLength(1)
  expect(screen.getByRole('link', { name: 'Mevzuat referansı' })).toHaveAttribute('href', 'https://www.resmigazete.gov.tr/eskiler/2026/07/20260711-31.htm')
})
