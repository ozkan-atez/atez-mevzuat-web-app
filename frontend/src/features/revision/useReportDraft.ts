import { useCallback, useEffect, useRef, useState } from 'react'
import { getTopic, sendTopicMessage } from '../analysis/api'
import { DraftConflictError, applyReportEdits, discardReportDraft, getReportDraft, publishReportDraft, revertReportEdit } from './api'
import type { ReportDraftView } from './types'

/**
 * The patch runs on the worker and a single model call has been observed to take
 * over two minutes, with bounded retries on top, so the window has to be minutes
 * rather than seconds or the UI abandons a request that is still working.
 */
const PROMPT_POLL_INTERVAL_MS = 3_000
const PROMPT_POLL_ATTEMPTS = 100

export interface ReportDraftState {
  view: ReportDraftView | null
  isLoading: boolean
  isBusy: boolean
  /** A prompt is being turned into a patch on the worker. */
  isPrompting: boolean
  error: string | null
  conflictVersion: number | null
  editField: (path: string, value: string) => Promise<void>
  revert: (editId: string) => Promise<void>
  publish: () => Promise<number | null>
  discard: () => Promise<void>
  submitPrompt: (message: string) => Promise<void>
  reload: () => Promise<void>
}

export function useReportDraft(topicId: string | undefined): ReportDraftState {
  const [view, setView] = useState<ReportDraftView | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [isPrompting, setIsPrompting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictVersion, setConflictVersion] = useState<number | null>(null)
  const mounted = useRef(true)

  useEffect(() => () => { mounted.current = false }, [])

  const reload = useCallback(async () => {
    if (!topicId) return
    setIsLoading(true)
    try {
      const next = await getReportDraft(topicId)
      if (mounted.current) { setView(next); setError(null); setConflictVersion(null) }
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : 'Taslak alınamadı')
    } finally {
      if (mounted.current) setIsLoading(false)
    }
  }, [topicId])

  useEffect(() => { void reload() }, [reload])

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | null> => {
    if (!topicId) return null
    setIsBusy(true)
    setError(null)
    try {
      return await action()
    } catch (caught) {
      if (!mounted.current) return null
      if (caught instanceof DraftConflictError) {
        setConflictVersion(caught.currentVersion)
        setError(caught.message)
      } else {
        setError(caught instanceof Error ? caught.message : 'İşlem tamamlanamadı')
      }
      return null
    } finally {
      if (mounted.current) setIsBusy(false)
    }
  }, [topicId])

  const editField = useCallback(async (path: string, value: string) => {
    if (!topicId) return
    const next = await run(() => applyReportEdits(topicId, {
      edits: [{ path, value }],
      ...(view ? { expectedVersion: view.baseVersion } : {}),
    }))
    if (next && mounted.current) setView(next)
  }, [run, topicId, view])

  const revert = useCallback(async (editId: string) => {
    if (!topicId) return
    const next = await run(() => revertReportEdit(topicId, editId))
    if (next && mounted.current) setView(next)
  }, [run, topicId])

  const publish = useCallback(async () => {
    if (!topicId) return null
    const published = await run(() => publishReportDraft(topicId, view?.baseVersion))
    if (!published) return null
    await reload()
    return published.version
  }, [reload, run, topicId, view])

  const discard = useCallback(async () => {
    if (!topicId) return
    await run(() => discardReportDraft(topicId))
    await reload()
  }, [reload, run, topicId])

  /**
   * The prompt is handled by the worker, so the result arrives asynchronously.
   * The draft is polled until its edit count grows rather than assuming success —
   * the model may also answer that the request needs an analysis revision.
   */
  const submitPrompt = useCallback(async (message: string) => {
    if (!topicId) return
    const before = view?.draft?.edits.length ?? 0
    setIsPrompting(true)
    setError(null)
    try {
      const sent = await sendTopicMessage(topicId, message)
      for (let attempt = 0; attempt < PROMPT_POLL_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, PROMPT_POLL_INTERVAL_MS))
        if (!mounted.current) return

        const next = await getReportDraft(topicId).catch(() => null)
        if (next && (next.draft?.edits.length ?? 0) > before) {
          setView(next)
          return
        }

        // Only a reply to *this* request counts. Matching on "the newest assistant
        // message" would surface an error left over from an earlier attempt.
        const reply = await replyTo(topicId, sent.messageId)
        if (reply) {
          setError(reply)
          // An escalated request publishes a new revision, so the page has to catch up.
          await reload()
          return
        }
      }
      if (mounted.current) setError('Talep hâlâ işleniyor. Sayfayı biraz sonra yenileyin.')
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : 'Talep gönderilemedi')
    } finally {
      if (mounted.current) setIsPrompting(false)
    }
  }, [reload, topicId, view])

  return { view, isLoading, isBusy, isPrompting, error, conflictVersion, editField, revert, publish, discard, submitPrompt, reload }
}

/** The assistant answer that came after the given request, if there is one yet. */
async function replyTo(topicId: string, requestMessageId: string): Promise<string | null> {
  const topic = await getTopic(topicId).catch(() => null)
  const messages = topic?.thread.messages ?? []
  const index = messages.findIndex((message) => message.id === requestMessageId)
  if (index === -1) return null
  return messages.slice(index + 1).find((message) => message.role === 'ASSISTANT')?.content ?? null
}
