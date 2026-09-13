import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Dashboard } from './Dashboard'

describe('Dashboard recent scans', () => {
  it('shows persisted scan runs instead of bulletin mock rows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ runs: [{
      id: 'a07a03dc-2712-4bee-b852-bfa00f06a27a',
      trigger: 'MANUAL', status: 'COMPLETED', currentStage: 'WRITING_MANIFEST', targetDate: '2026-09-14',
      createdAt: '2026-09-13T21:41:30.000Z', startedAt: '2026-09-13T21:41:30.969Z', completedAt: '2026-09-13T21:41:36.265Z',
      counts: { editions: 1, documents: 7, assets: 1 },
    }] }), { status: 200 })))

    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByText('7 belge · 1 bağlı dosya · 1 sayı')).toBeVisible()
    expect(screen.getByText('a07a03dc')).toBeVisible()
    expect(screen.queryByText('İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ (No: 2026/4)')).not.toBeInTheDocument()
  })
})
