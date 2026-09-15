import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { AppLayout } from './AppLayout'

describe('AppLayout assistant integration', () => {
  it('starts compact and adjusts page spacing as the assistant opens and closes', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<div>Sayfa içeriği</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    const layout = screen.getByText('Sayfa içeriği').closest('main')?.parentElement
    expect(layout).toHaveClass('pb-20')
    expect(layout).not.toHaveClass('pb-36')

    await user.click(screen.getByRole('button', { name: 'Yapay zekâ asistanını aç' }))

    expect(layout).toHaveClass('pb-36')
    expect(screen.getByPlaceholderText('Ne değiştirmek veya oluşturmak istiyorsunuz?')).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Yapay zekâ asistanını kapat' }))

    expect(layout).toHaveClass('pb-20')
    expect(screen.getByRole('button', { name: 'Yapay zekâ asistanını aç' })).toBeVisible()
  })
})

afterEach(cleanup)

describe('AppLayout chat isolation', () => {
  it('leaves the workspace to its own composer instead of docking a second one', () => {
    render(
      <MemoryRouter initialEntries={['/chat/session-1']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/chat/:sessionId" element={<div>Sohbet çalışma alanı</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Sohbet çalışma alanı')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Yapay zekâ asistanını aç' })).not.toBeInTheDocument()
  })
})
