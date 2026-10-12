import { act, cleanup, renderHook, waitFor } from '../../test/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReportDraft } from './useReportDraft'
import type { ReportDraftView, ReportFieldEditRecord } from './types'

const api = vi.hoisted(() => ({ get: vi.fn(), edit: vi.fn(), publish: vi.fn(), discard: vi.fn() }))
vi.mock('./api', () => ({
  DraftConflictError: class extends Error {}, getReportDraft: api.get, applyReportEdits: api.edit,
  publishReportDraft: api.publish, discardReportDraft: api.discard,
  revertReportEdit: vi.fn(), saveReportWorkspace: vi.fn(), addReportSource: vi.fn(), applyReportTemplate: vi.fn(),
}))
vi.mock('../analysis/api', () => ({ getTopic: vi.fn(), sendTopicMessage: vi.fn() }))

let version: number
let edits: ReportFieldEditRecord[]
let spec: Record<string, string>
let processing: boolean
const view = (): ReportDraftView => ({
  baseVersion: version, publishedVersion: version, isStale: false, isProcessing: processing,
  draft: edits.length ? { id: 'same-draft', status: 'OPEN', updatedAt: '2026-10-12T00:00:00Z', edits: [...edits] } : null,
  spec: { ...spec }, html: `<p>${spec.title}</p><p>${spec.summary}</p>`,
})

beforeEach(() => {
  vi.clearAllMocks(); version = 2; edits = []; processing = false; spec = { title: 'Eski başlık', summary: 'Eski özet' }
  api.get.mockImplementation(async () => view())
  api.edit.mockImplementation(async (_topicId, input: { edits: Array<{path: string; value: string}> }) => {
    for (const change of input.edits) {
      edits.push({ id: `edit-${edits.length + 1}`, sequence: edits.length + 1, path: change.path, previousValue: spec[change.path], nextValue: change.value, source: 'USER', prompt: null, chatMessageId: null, revertible: true, revertsEditId: null, revertedByEditId: null, createdAt: '2026-10-12T00:00:00Z' })
      spec[change.path] = change.value
    }
    return view()
  })
  api.publish.mockImplementation(async () => { version += 1; edits = []; return { version } })
  api.discard.mockImplementation(async () => { edits = []; spec = { title: 'Eski başlık', summary: 'Eski özet' } })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('report changes accumulate until explicit save', () => {
  it('restores the same draft after reopening and saves all edits as one new revision', async () => {
    const first = renderHook(() => useReportDraft('topic-1'))
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))
    await act(() => first.result.current.editField('title', 'Yeni başlık'))
    await act(() => first.result.current.editField('summary', 'Yeni özet'))
    expect(first.result.current.view).toMatchObject({ baseVersion: 2, publishedVersion: 2, draft: { id: 'same-draft', edits: [{ path: 'title' }, { path: 'summary' }] } })
    expect(api.publish).not.toHaveBeenCalled()
    first.unmount()

    const reopened = renderHook(() => useReportDraft('topic-1'))
    await waitFor(() => expect(reopened.result.current.view?.draft?.edits).toHaveLength(2))
    expect(reopened.result.current.view?.draft?.id).toBe('same-draft')
    await act(() => reopened.result.current.publish())
    expect(api.publish).toHaveBeenCalledExactlyOnceWith('topic-1', 2)
    expect(reopened.result.current.view).toMatchObject({ baseVersion: 3, publishedVersion: 3, draft: null, spec: { title: 'Yeni başlık', summary: 'Yeni özet' } })
  })

  it('discarding pending edits preserves the published revision', async () => {
    const { result } = renderHook(() => useReportDraft('topic-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(() => result.current.editField('title', 'Taslak başlık'))
    await act(() => result.current.discard())
    expect(api.publish).not.toHaveBeenCalled()
    expect(result.current.view).toMatchObject({ baseVersion: 2, publishedVersion: 2, draft: null, spec: { title: 'Eski başlık' } })
  })

  it('restores an unfinished correction from the server and polls until it completes', async () => {
    vi.useFakeTimers(); processing = true
    const { result } = renderHook(() => useReportDraft('topic-1'))
    await act(async () => { await Promise.resolve() })
    expect(result.current.isPrompting).toBe(true)
    processing = false
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(result.current.isPrompting).toBe(false)
    expect(result.current.view?.baseVersion).toBe(2)
    expect(api.publish).not.toHaveBeenCalled()
  })
})
