import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChangeList } from './ChangeList'
import type { ReportFieldEditRecord } from './types'

function edit(overrides: Partial<ReportFieldEditRecord> = {}): ReportFieldEditRecord {
  return {
    id: 'edit-1', sequence: 1, path: 'title', previousValue: 'Eski', nextValue: 'Yeni',
    source: 'USER', prompt: null, chatMessageId: null, revertible: true,
    revertsEditId: null, revertedByEditId: null, createdAt: '2026-09-11T06:00:00Z',
    ...overrides,
  }
}

describe('ChangeList', () => {
  afterEach(cleanup)

  it('offers undo for an editable field', async () => {
    render(<ChangeList edits={[edit()]} onRevert={vi.fn()} isBusy={false} />)

    await userEvent.click(screen.getByRole('button', { name: /Başlık/ }))

    expect(screen.getByRole('button', { name: /Geri al/ })).toBeVisible()
  })

  it('explains why a staged analysis change cannot be undone on its own', async () => {
    render(<ChangeList edits={[edit({ path: 'table.rows', revertible: false, source: 'AI' })]} onRevert={vi.fn()} isBusy={false} />)

    await userEvent.click(screen.getByRole('button', { name: /Tablo/ }))

    expect(screen.queryByRole('button', { name: /Geri al/ })).toBeNull()
    expect(screen.getByText(/tek tek geri alınamaz/)).toBeVisible()
  })
})
