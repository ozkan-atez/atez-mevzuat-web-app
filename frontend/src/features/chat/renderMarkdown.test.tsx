import { render, screen, cleanup } from '@testing-library/react'
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
})
