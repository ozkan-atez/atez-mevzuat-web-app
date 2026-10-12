import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { cleanup, render, screen } from '../../test/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { AppLayout } from './AppLayout'
import { ThemeProvider } from './ThemeProvider'

describe('AppLayout sidebar workspace', () => {
  it('renders page content without a docked assistant', () => {
    render(<ThemeProvider><MemoryRouter><Routes><Route element={<AppLayout />}><Route index element={<div>Sayfa içeriği</div>} /></Route></Routes></MemoryRouter></ThemeProvider>)
    expect(screen.getByText('Sayfa içeriği')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Yapay zekâ asistanını aç' })).not.toBeInTheDocument()
  })
})

afterEach(cleanup)

describe('AppLayout chat isolation', () => {
  it('leaves the workspace to its own composer instead of docking a second one', () => {
    render(
      <ThemeProvider><MemoryRouter initialEntries={['/chat/session-1']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/chat/:sessionId" element={<div>Sohbet çalışma alanı</div>} />
          </Route>
        </Routes>
      </MemoryRouter></ThemeProvider>,
    )

    expect(screen.getByText('Sohbet çalışma alanı')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Yapay zekâ asistanını aç' })).not.toBeInTheDocument()
  })
})
