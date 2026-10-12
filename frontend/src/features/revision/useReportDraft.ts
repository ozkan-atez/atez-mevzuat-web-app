import { useCallback, useEffect, useRef, useState } from 'react'
import { getTopic, getTopicReportHtml, sendTopicMessage } from '../analysis/api'
import { DraftConflictError, applyReportEdits, discardReportDraft, getReportDraft, publishReportDraft, revertReportEdit, saveReportWorkspace, addReportSource, applyReportTemplate } from './api'
import type { ReportDraftView, ReportCustomization, ReportSourceInput } from './types'

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
  applyTemplate: (templateId: string) => Promise<void>
  saveCustomization: (customization: ReportCustomization) => Promise<void>
  addSource: (source: ReportSourceInput) => Promise<void>
  reload: () => Promise<void>
}

export function useReportDraft(topicId: string | undefined, editable = true, requestedVersion?: number): ReportDraftState {
  const [view, setView] = useState<ReportDraftView | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [isPrompting, setIsPrompting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictVersion, setConflictVersion] = useState<number | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const reload = useCallback(async () => {
    if (!topicId) return
    setIsLoading(true)
    try {
      const next: ReportDraftView = editable ? await getReportDraft(topicId) : await (async () => {
        const topic = await getTopic(topicId)
        const version = requestedVersion ?? topic.reportVersion
        if (!version) throw new Error('Bu belge için yayımlanmış bir bülten bulunmuyor.')
        const html = await getTopicReportHtml(topicId, version)
        return {draft:null,baseVersion:version,publishedVersion:topic.reportVersion ?? version,isStale:false,spec:{},html}
      })()
      if (mounted.current) { setView(next); setError(null); setConflictVersion(null) }
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : 'Taslak alınamadı')
    } finally {
      if (mounted.current) setIsLoading(false)
    }
  }, [topicId, editable, requestedVersion])

  useEffect(() => { void reload() }, [reload])

  // Restore the pending correction after reopening the panel or reloading the page.
  // The durable server status, rather than this tab's local state, controls Save.
  useEffect(() => {
    if (!editable || !topicId || !view?.isProcessing || isPrompting) return
    let stopped = false
    let polling = false
    const timer = setInterval(async () => {
      if (polling) return
      polling = true
      try {
        const next = await getReportDraft(topicId)
        if (!stopped && mounted.current) setView(next)
      } catch {
        // Keep the pending state until it can be verified; a transport error is not completion.
      } finally { polling = false }
    }, PROMPT_POLL_INTERVAL_MS)
    return () => { stopped = true; clearInterval(timer) }
  }, [editable, topicId, view?.isProcessing, isPrompting])

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | null> => {
    if (!topicId || !editable) return null
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
  }, [topicId, editable])

  const editField = useCallback(async (path: string, value: string) => {
    if (!topicId) return
    const next = await run(() => applyReportEdits(topicId, {
      edits: [{ path, value }],
      expectedDraftUpdatedAt: view?.draft?.updatedAt ?? null,
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
    const published = await run(() => publishReportDraft(topicId, view?.baseVersion, view?.draft?.updatedAt ?? null))
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
    if (!topicId || !editable) return
    const before = view?.draft?.edits.length ?? 0
    setIsPrompting(true)
    setError(null)
    try {
      const sent = await sendTopicMessage(topicId, message)
      if (sent.status === 'COMPLETED') { await reload(); return }
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
          // Refresh the draft after a worker reply; correction requests do not publish a revision.
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
  }, [reload, topicId, view, editable])

  const applyTemplate = useCallback(async (templateId: string) => {
    if (!topicId) return
    const next = await run(() => applyReportTemplate(topicId, templateId, view?.baseVersion,view?.draft?.updatedAt ?? null))
    if (next && mounted.current) setView(next)
  }, [run, topicId, view])
  const saveCustomization = useCallback(async (customization: ReportCustomization) => {
    if (!topicId) return
    const next = await run(() => saveReportWorkspace(topicId, customization, view?.baseVersion,view?.draft?.updatedAt ?? null))
    if (next && mounted.current) setView(next)
  }, [run, topicId, view])
  const addSource = useCallback(async (source: ReportSourceInput) => {
    if (!topicId) return
    const next = await run(() => addReportSource(topicId, source, view?.baseVersion,view?.draft?.updatedAt ?? null))
    if (!next) throw new Error('Kaynak eklenemedi')
    if (next && mounted.current) setView(next)
  }, [run, topicId, view])

  return { applyTemplate, saveCustomization, addSource, view, isLoading, isBusy, isPrompting: isPrompting || Boolean(view?.isProcessing), error, conflictVersion, editField, revert, publish, discard, submitPrompt, reload }
}

/** The assistant answer that came after the given request, if there is one yet. */
async function replyTo(topicId: string, requestMessageId: string): Promise<string | null> {
  const topic = await getTopic(topicId).catch(() => null)
  const messages = topic?.thread.messages ?? []
  const index = messages.findIndex((message) => message.id === requestMessageId)
  if (index === -1) return null
  return messages.slice(index + 1).find((message) => message.role === 'ASSISTANT')?.content ?? null
}
