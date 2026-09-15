import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Mail, Paperclip, RefreshCw, Send, X } from 'lucide-react'
import { getDeliveryContext, parseEmailList, sendDispatch } from './api'
import type { DeliveryContext, DispatchResult } from './types'

interface Props {
  topicId: string
  reportVersion: number
  reportTitle: string
  onClose: () => void
  onDispatched?: () => void
}

export function EmailDispatchModal({ topicId, reportVersion, reportTitle, onClose, onDispatched }: Props) {
  const [context, setContext] = useState<DeliveryContext | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [result, setResult] = useState<(DispatchResult & { error?: string }) | null>(null)

  const [toInput, setToInput] = useState('')
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [attachPdf, setAttachPdf] = useState(true)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    getDeliveryContext(topicId, reportVersion)
      .then((loaded) => {
        if (!active) return
        setContext(loaded)
        setSubject(loaded.draft.subject)
        setBodyText(loaded.draft.bodyText)
      })
      .catch((caught) => { if (active) setLoadError(caught instanceof Error ? caught.message : 'Dağıtım bilgileri alınamadı') })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [topicId, reportVersion])

  const recipients = useMemo(() => parseEmailList(toInput), [toInput])

  const addGroup = (emails: string[]) => {
    setToInput((current) => [...new Set([...parseEmailList(current), ...emails.map((email) => email.toLowerCase())])].join(', '))
  }

  const handleSend = async () => {
    if (isSending) return
    setIsSending(true)
    try {
      // The recipient field is the single source of truth: group chips merge their
      // addresses into it, so a removed address stays removed.
      const dispatched = await sendDispatch(topicId, {
        reportVersion, groupIds: [], recipients, subject: subject.trim(), bodyText: bodyText.trim(), attachPdf,
      })
      setResult(dispatched)
      onDispatched?.()
    } catch (caught) {
      setResult({ dispatchId: '', status: 'FAILED', error: caught instanceof Error ? caught.message : 'E-posta gönderilirken bir hata oluştu.' })
    } finally {
      setIsSending(false)
    }
  }

  const canSend = recipients.length > 0 && subject.trim().length > 0 && bodyText.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-xs sm:p-4">
      <div role="dialog" aria-label="E-Posta ile Bülten Gönder" className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 px-5 py-3.5 text-white">
          <div className="flex min-w-0 items-center gap-2.5">
            <Mail className="h-4 w-4 shrink-0 text-blue-400" />
            <div className="min-w-0">
              <h3 className="text-sm font-bold">E-Posta ile Bülten Gönder</h3>
              <p className="max-w-xs truncate text-[11px] text-slate-300 sm:max-w-md">{reportTitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Kapat" className="cursor-pointer rounded-lg p-1 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </header>

        {result ? (
          <div className="space-y-4 p-6 text-center">
            {result.status === 'FAILED' ? (
              <>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600"><AlertCircle className="h-7 w-7 stroke-[2.5]" /></div>
                <h4 className="text-base font-bold text-slate-900">Gönderilemedi</h4>
                <p className="text-xs text-red-600">{result.error ?? result.message ?? 'Gönderim başarısız oldu.'}</p>
                <button type="button" onClick={() => setResult(null)} className="cursor-pointer rounded-xl bg-slate-100 px-4 py-1.5 text-xs font-semibold text-slate-700">Tekrar Dene</button>
              </>
            ) : (
              <>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 className="h-7 w-7 stroke-[2.5]" /></div>
                <h4 className="text-base font-bold text-slate-900">
                  {result.status === 'SIMULATED' ? 'E-Posta Simüle Edildi & Kaydedildi' : 'E-Posta Başarıyla Gönderildi!'}
                </h4>
                <p className="mx-auto max-w-md text-xs leading-relaxed text-slate-600">
                  {result.note ?? 'Bülten ve ekteki PDF dosyası başarıyla iletildi.'}
                </p>
                <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left font-mono text-xs text-slate-700">
                  <div className="break-words"><strong>Alıcılar:</strong> {(result.recipients ?? recipients).join(', ')}</div>
                  {attachPdf && context && <div className="break-words"><strong>PDF Eki:</strong> {context.draft.attachmentName}</div>}
                </div>
                <button type="button" onClick={onClose} className="cursor-pointer rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white transition-all hover:bg-slate-800">Tamamla</button>
              </>
            )}
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 p-12 text-center text-slate-400">
            <RefreshCw className="h-6 w-6 animate-spin text-blue-600" />
            <span className="text-xs font-medium">Bülten taslağı hazırlanıyor...</span>
          </div>
        ) : !context ? (
          <div className="space-y-4 p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600"><AlertCircle className="h-7 w-7 stroke-[2.5]" /></div>
            <p className="text-xs text-red-600">{loadError}</p>
            <button type="button" onClick={onClose} className="cursor-pointer rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white">Kapat</button>
          </div>
        ) : (
          <div className="space-y-3.5 p-5 text-xs">
            <div className="space-y-2">
              <label htmlFor="dispatch-to" className="font-bold text-slate-700">Alıcılar (Kime):</label>
              <input
                id="dispatch-to"
                type="text"
                value={toInput}
                onChange={(event) => setToInput(event.target.value)}
                placeholder="ornek@atez.com, diger@gmail.com"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-[11px] text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {context.groups.length === 0 && (
                  <span className="text-[10px] italic text-slate-400">Henüz grup eklenmemiş. &lsquo;Müşteri Grupları&rsquo;ndan ekleyebilirsiniz.</span>
                )}
                {context.groups.filter((group) => group.isActive).map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => addGroup(group.emails)}
                    title={group.description ?? group.name}
                    className="cursor-pointer rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-700"
                  >
                    + {group.name}
                  </button>
                ))}
                {toInput && (
                  <button type="button" onClick={() => setToInput('')} className="ml-auto cursor-pointer rounded-md bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-600 transition-colors hover:bg-red-100">Temizle</button>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="dispatch-subject" className="font-bold text-slate-700">Konu:</label>
              <input
                id="dispatch-subject"
                type="text"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-medium text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-blue-200/80 bg-blue-50/60 p-2.5">
              <div className="flex min-w-0 items-center gap-2 font-medium text-blue-950">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                <span className="truncate">{context.draft.attachmentName}</span>
              </div>
              <label className="ml-2 flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-blue-700">
                <input type="checkbox" checked={attachPdf} onChange={(event) => setAttachPdf(event.target.checked)} className="rounded text-blue-600" />
                <span>PDF Ekle</span>
              </label>
            </div>

            <div className="space-y-1">
              <label htmlFor="dispatch-body" className="font-bold text-slate-700">Bülten Mesajı (Düzenlenebilir):</label>
              <textarea
                id="dispatch-body"
                rows={6}
                value={bodyText}
                onChange={(event) => setBodyText(event.target.value)}
                className="w-full resize-none rounded-xl border border-slate-200 bg-white p-2.5 font-sans text-xs leading-relaxed text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <p className="text-[10px] text-slate-400">Kullanılan kaynaklar listesi e-postanın sonuna otomatik eklenir.</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-500">
              {context.sender.configured
                ? (
                  <>
                    <span>Gönderen: <strong className="text-slate-700">{context.sender.address}</strong></span>
                    <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Kalıcı E-Posta Bağlantısı Aktif
                    </span>
                  </>
                )
                : (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{context.sender.note}
                  </span>
                )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-2">
              <button type="button" onClick={onClose} className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800">Vazgeç</button>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={isSending || !canSend}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 px-4 py-2 text-xs font-bold text-white shadow-sm transition-all hover:from-slate-900 hover:to-blue-900 active:scale-95 disabled:opacity-50"
              >
                {isSending
                  ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /><span>Gönderiliyor...</span></>
                  : <><Send className="h-3.5 w-3.5" /><span>E-Postayı Gönder</span></>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
