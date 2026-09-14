import { useEffect, useState } from 'react'
import { LoaderCircle, Send } from 'lucide-react'
import { getTopic, sendTopicMessage } from './api'
import type { TopicMessage } from './types'

export function TopicAnalysisChat({ topicId, onQueued }: { topicId: string; onQueued?: () => void }) {
  const [messages, setMessages] = useState<TopicMessage[]>([])
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getTopic(topicId).then((topic) => { if (active) setMessages(topic.thread.messages) }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Konuşma yüklenemedi') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [topicId])

  const submit = async () => {
    const message = value.trim()
    if (!message || sending) return
    setSending(true); setError(null)
    try {
      const result = await sendTopicMessage(topicId, message)
      setMessages((current) => [...current, { id: result.messageId, role: 'USER', kind: 'REVISION_REQUEST', revisionKind: result.revisionKind, content: message, createdAt: new Date().toISOString() }])
      setValue('')
      onQueued?.()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Mesaj gönderilemedi') }
    finally { setSending(false) }
  }

  return (
    <section className="flex min-h-[520px] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-bold text-slate-900">Revizyon &amp; Sohbet</h2><p className="mt-1 text-xs text-slate-500">Bu konuşma yalnızca seçili mevzuat değişikliğine aittir.</p></div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading && <p className="flex items-center gap-2 text-xs text-slate-500"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Konuşma yükleniyor…</p>}
        {!loading && messages.length === 0 && <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Raporla ilgili bir revizyon talebi yazabilirsiniz.</p>}
        {messages.map((message) => <div key={message.id} className={`max-w-[90%] rounded-xl px-3 py-2 text-xs leading-5 ${message.role === 'USER' ? 'ml-auto bg-blue-600 text-white' : message.kind === 'ERROR' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'}`}>{message.content}</div>)}
      </div>
      <div className="border-t border-slate-100 p-4">
        {error && <p className="mb-2 text-xs font-medium text-red-600">{error}</p>}
        <textarea value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} placeholder="Revizyon talebinizi yazın…" className="min-h-24 w-full resize-none rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-blue-500" />
        <button type="button" onClick={() => void submit()} disabled={sending || !value.trim()} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Gönder</button>
      </div>
    </section>
  )
}
