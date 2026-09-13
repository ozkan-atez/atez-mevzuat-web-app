import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
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
