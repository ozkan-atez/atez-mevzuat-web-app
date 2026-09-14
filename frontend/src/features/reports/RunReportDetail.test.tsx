import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RunReportDetail } from './RunReportDetail'

describe('RunReportDetail', () => {
  it('opens the generated no-change HTML from the run report endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html><p>Değişiklik yok</p>', { status: 200 })))
    render(<MemoryRouter initialEntries={['/runs/run-1/reports/report-1']}><Routes><Route path="/runs/:runId/reports/:reportId" element={<RunReportDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByTitle('Değişiklik yok bülteni')).toHaveAttribute('srcdoc', expect.stringContaining('Değişiklik yok'))
  })
})
