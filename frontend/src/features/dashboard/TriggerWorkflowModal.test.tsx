import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TriggerWorkflowModal } from './TriggerWorkflowModal'

describe('TriggerWorkflowModal', () => {
  it('keeps the dialog open and shows the backend error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'Nesne deposuna ulaşılamadı' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )))
    const onTriggered = vi.fn()
    const onClose = vi.fn()
    render(<TriggerWorkflowModal onClose={onClose} onTriggered={onTriggered} />)

    await userEvent.click(screen.getByRole('button', { name: 'Taramayı Başlat' }))

    expect(onTriggered).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Nesne deposuna ulaşılamadı')).toBeVisible()
  })
})
