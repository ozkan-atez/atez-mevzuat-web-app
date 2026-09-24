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
    const main = screen.getByText('Sayfa içeriği').closest('main')
    expect(main).toHaveClass('max-w-7xl', 'mx-auto')
    expect(layout).toHaveClass('pb-20')
    expect(layout).not.toHaveClass('pb-36')

    await user.click(screen.getByRole('button', { name: 'Yapay zekâ asistanını aç' }))

    expect(layout).toHaveClass('pb-36')
    expect(screen.getByPlaceholderText('Ne değiştirmek veya oluşturmak istiyorsunuz?')).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Yapay zekâ asistanını kapat' }))

    expect(layout).toHaveClass('pb-20')
    expect(screen.getByRole('button', { name: 'Yapay zekâ asistanını aç' })).toBeVisible()
  })

  it('opens the scan dialog and navigates to chat history and distribution groups from the sidebar', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<div>Ana pano</div>} />
            <Route path="chat" element={<div>Sohbet sayfası</div>} />
            <Route path="groups" element={<div>Dağıtım sayfası</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Menüyü genişlet' }))
    expect(screen.getByRole('button', { name: 'Menüyü daralt' })).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'Yeni tarama başlat' }))
    expect(screen.getByText('Kaynak taraması başlat')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Kapat' }))

    await user.click(screen.getByRole('link', { name: 'Sohbet geçmişi' }))
    expect(screen.getByText('Sohbet sayfası')).toBeVisible()
    await user.click(screen.getByRole('link', { name: 'Dağıtım grupları' }))
    expect(screen.getByText('Dağıtım sayfası')).toBeVisible()
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
