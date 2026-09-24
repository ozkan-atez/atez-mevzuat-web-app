import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TriggerWorkflowModal } from './TriggerWorkflowModal'

describe('TriggerWorkflowModal', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })
  it('keeps the dialog open and shows the backend error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ sources: [] }), { status: 200 })).mockResolvedValue(new Response(
      JSON.stringify({ message: 'Nesne deposuna ulaşılamadı' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )))
    const onTriggered = vi.fn()
    const onClose = vi.fn()
    render(<TriggerWorkflowModal onClose={onClose} onTriggered={onTriggered} />)

    await userEvent.click(screen.getByRole('button', { name: 'Taramayı Başlat' }))

    expect(onTriggered).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Nesne deposuna ulaşılamadı')).toBeVisible())
  })

  it('starts one normal run with every selected source', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ sources: [
      { id: 'ticaret-id', key: 'ticaret-bakanligi', name: 'Ticaret Bakanlığı', available: true, reason: null },
      { id: 'igmd-id', key: 'igmd', name: 'İGMD', available: true, reason: null },
    ] }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'one-run', status: 'QUEUED' }), { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const onTriggered = vi.fn()
    render(<TriggerWorkflowModal onClose={vi.fn()} onTriggered={onTriggered} />)
    await waitFor(() => expect(screen.getByLabelText('Ticaret Bakanlığı')).toBeEnabled())
    await userEvent.click(screen.getByLabelText('Ticaret Bakanlığı'))
    await userEvent.click(screen.getByLabelText('İGMD'))
    await userEvent.click(screen.getByRole('button', { name: 'Taramayı Başlat' }))
    await waitFor(() => expect(onTriggered).toHaveBeenCalledWith('one-run'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/scan-runs')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ sourceKeys: ['resmi-gazete', 'ticaret-bakanligi', 'igmd'] })
  })

  it('sizes source choices by their labels and uses the application theme', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ sources: [
      { id: 'ticaret-id', key: 'ticaret-bakanligi', name: 'Ticaret Bakanlığı', available: true, reason: null },
      { id: 'igmd-id', key: 'igmd', name: 'İGMD', available: true, reason: null },
    ] }), { status: 200 })))
    render(<TriggerWorkflowModal onClose={vi.fn()} />)
    const group = screen.getByRole('group', { name: 'Taranacak kaynaklar' })
    const gazette = screen.getByRole('checkbox', { name: 'Resmî Gazete' })

    expect(group).toHaveClass('flex', 'flex-wrap')
    expect(gazette).toHaveClass('w-auto', 'whitespace-nowrap', 'rounded-full', 'bg-indigo-50')
    expect(screen.getByRole('button', { name: 'Taramayı Başlat' })).toHaveClass('rounded-full', 'bg-[#17264a]')
  })
})
