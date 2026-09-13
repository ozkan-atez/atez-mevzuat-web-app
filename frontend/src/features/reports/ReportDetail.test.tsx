import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReportDetail } from './ReportDetail'

describe('ReportDetail', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('test fallback')))
  })

  it('uses the full width for the bulletin without a separate revision chat panel', async () => {
    render(
      <MemoryRouter initialEntries={['/reports/1']}>
        <Routes>
          <Route path="/reports/:id" element={<ReportDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTitle('Bülten Önizleme')).toBeInTheDocument())

    expect(screen.queryByText('Revizyon & Sohbet')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Revizyon talimatınızı yazın... (Enter gönderir)')).not.toBeInTheDocument()
    expect(screen.getByTestId('report-preview')).toHaveClass('lg:col-span-10')
  })
})
