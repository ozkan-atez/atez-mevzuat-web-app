import { ConfigProvider } from 'antd'
import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ReportChatPreview } from './ReportChatPreview'
import { getStandaloneRevision } from '../reports/standalone-api'
import type { ReportThread } from './api'
import type { ReportDraftView } from '../revision/types'

vi.mock('../reports/standalone-api', () => ({ getStandaloneRevision: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const withoutMotion = ({ children }: { children: ReactNode }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>
const thread: ReportThread = { reportId: 'r1', topicId: 't1', title: 'Rapor', latestVersion: 2, messages: [], revisions: [] }
const view: ReportDraftView = { html: '<h1>Güncel rapor</h1>', spec: {}, draft: null, baseVersion: 2, publishedVersion: 2, isStale: false }

it('opens the full HTML in a dialog, updates it, and closes back to chat', async () => {
  const { rerender } = render(<ReportChatPreview thread={thread} view={view} loading={false} />, { wrapper: withoutMotion })
  expect(screen.queryByTitle('Sohbette rapor önizlemesi')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Rapor önizlemesi/ }))
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible())
  expect(screen.getByTitle('Sohbette rapor önizlemesi')).toHaveAttribute('srcdoc', view.html)
  expect(screen.getByTitle('Sohbette rapor önizlemesi')).toHaveAttribute('sandbox', 'allow-same-origin')
  rerender(<ReportChatPreview thread={thread} view={{ ...view, html: '<h1>Düzeltilmiş rapor</h1>', draft: { id: 'd1', status: 'OPEN', updatedAt: '', edits: [] } }} loading={false} />)
  expect(screen.getByTitle('Sohbette rapor önizlemesi')).toHaveAttribute('srcdoc', '<h1>Düzeltilmiş rapor</h1>')
  expect(screen.getByText(/Taslak · r2 üzerinden/)).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Önizlemeyi kapat' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: /Rapor önizlemesi/ })).toBeVisible()
})

it('loads the current standalone revision and refreshes when a new version arrives', async () => {
  vi.mocked(getStandaloneRevision).mockResolvedValueOnce({ reportId: 'r1', version: 2, html: '<p>İkinci sürüm</p>' })
  const { rerender } = render(<ReportChatPreview thread={{ ...thread, topicId: null }} view={null} loading={false} />, { wrapper: withoutMotion })
  expect(getStandaloneRevision).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: /Rapor önizlemesi/ }))
  await waitFor(() => expect(screen.getByTitle('Sohbette rapor önizlemesi')).toHaveAttribute('srcdoc', '<p>İkinci sürüm</p>'))
  vi.mocked(getStandaloneRevision).mockResolvedValueOnce({ reportId: 'r1', version: 3, html: '<p>Üçüncü sürüm</p>' })
  rerender(<ReportChatPreview thread={{ ...thread, topicId: null, latestVersion: 3 }} view={null} loading={false} />)
  await waitFor(() => expect(screen.getByTitle('Sohbette rapor önizlemesi')).toHaveAttribute('srcdoc', '<p>Üçüncü sürüm</p>'))
  expect(getStandaloneRevision).toHaveBeenLastCalledWith('r1', 3)
})
