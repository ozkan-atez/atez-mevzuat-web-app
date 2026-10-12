import { cleanup, render, screen } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from './ThemeProvider'
import { Navbar } from './Navbar'

afterEach(() => { cleanup(); localStorage.clear(); delete document.documentElement.dataset.theme; delete document.documentElement.dataset.palette })

describe('shared theme controls', () => {
  it('starts in dark violet and persists appearance and palette choices', async () => {
    const user = userEvent.setup()
    render(<ThemeProvider><MemoryRouter><Navbar /></MemoryRouter></ThemeProvider>)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.palette).toBe('violet')
    await user.click(screen.getByRole('button', { name: 'Açık temaya geç' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    await user.click(screen.getByRole('button', { name: 'Renk paleti seç' }))
    await user.click(screen.getByText('Okyanus Mavi'))
    expect(document.documentElement.dataset.palette).toBe('ocean')
    expect(localStorage.getItem('atez-theme')).toBe('light')
    expect(localStorage.getItem('atez-palette')).toBe('ocean')
  })
})
