import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, LoaderCircle, X } from 'lucide-react'
import { useActiveReport } from '../revision/ActiveReportContext'
import { useActiveTemplate } from '../templates/ActiveTemplateContext'
import { AssistantIcon } from './AssistantIcon'
import { MAX_MESSAGE_LENGTH } from './types'
import { validateChatFile } from './chatFile'

type Props =
  | { mode?: 'dock'; isOpen: boolean; onOpenChange: (isOpen: boolean) => void; onSend?: (message: string, file?: File) => void; isSending?: boolean; placement?: 'conversation' }
  | { mode: 'workspace'; isSending: boolean; onSend: (message: string, file?: File) => void }

export function DockedAiAssistant(props: Props) {
  const [input, setInput] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [activityVersion, setActivityVersion] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const activeReport = useActiveReport()
  const activeTemplate = useActiveTemplate()
  const navigate = useNavigate()
  const isWorkspace = props.mode === 'workspace'
  const isContained = !isWorkspace && props.placement === 'conversation'
  const isOpen = isWorkspace || props.isOpen
  const isDisabled = isWorkspace ? props.isSending : (props.isSending ?? activeTemplate?.isPrompting ?? activeReport?.isPrompting ?? false)

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (isWorkspace || !props.isOpen || isDisabled || input.trim() || file || fileError) return
    const timer = window.setTimeout(() => props.onOpenChange(false), 5_000)
    return () => window.clearTimeout(timer)
  }, [activityVersion, file, fileError, input, isDisabled, isWorkspace, props])

  useEffect(() => {
    const field = inputRef.current
    if (!field || !isOpen) return
    field.style.height = '0px'
    field.style.height = `${Math.min(field.scrollHeight, isWorkspace ? 144 : 160)}px`
  }, [input, isOpen, isWorkspace])

  const submit = () => {
    const message = input.trim() || (file ? `Bu dosyayı incele: ${file.name}` : '')
    if (!message || message.length > MAX_MESSAGE_LENGTH || isDisabled) return
    if (activeTemplate && file && !props.onSend) { setFileError('Şablon düzenleme isteğine dosya eklenemiyor.'); return }
    setInput('')
    setFile(null)
    if (props.mode === 'workspace') {
      props.onSend(message, file ?? undefined)
    } else if (props.onSend) {
      props.onSend(message, file ?? undefined)
    } else if (activeTemplate) {
      void activeTemplate.submitPrompt(message)
    } else if (file) {
      navigate('/chat', { state: { initialMessage: message, initialFile: file }, viewTransition: true })
    } else if (activeReport) {
      void activeReport.submitPrompt(message)
    } else {
      // Keep the open panel in the outgoing view-transition snapshot.
      navigate('/chat', { state: { initialMessage: message }, viewTransition: true })
    }
  }

  if (!isWorkspace && !props.isOpen) {
    return (
      <aside className={`${isContained ? 'absolute' : 'fixed'} bottom-5 left-1/2 z-40 -translate-x-1/2`} data-purpose="docked-copilot-launcher">
        <button
          type="button"
          aria-label="Yapay zekâ asistanını aç"
          onClick={() => props.onOpenChange(true)}
          className="group flex h-12 w-12 items-center justify-center rounded-full border border-slate-300/80 bg-white/95 text-slate-900 shadow-lg shadow-slate-900/15 backdrop-blur-xl transition-all duration-300 ease-out hover:scale-125 hover:border-indigo-300 hover:text-indigo-700 hover:shadow-xl hover:shadow-indigo-500/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/25 active:scale-110 motion-reduce:transform-none"
        >
          <span className="transition-transform duration-300 ease-out group-hover:rotate-12"><AssistantIcon /></span>
        </button>
      </aside>
    )
  }

  return (
    <aside
      className={isWorkspace
        ? 'shrink-0 px-4 pb-5 pt-3 sm:px-6'
        : `${isContained ? 'absolute' : 'fixed'} bottom-0 inset-x-0 z-40 p-3 sm:p-4 pointer-events-none`}
      data-purpose={isWorkspace ? 'workspace-copilot-bar' : 'docked-copilot-bar'}
      onPointerDownCapture={() => { if (!isWorkspace) setActivityVersion((value) => value + 1) }}
      onKeyDownCapture={() => { if (!isWorkspace) setActivityVersion((value) => value + 1) }}
    >
      <div className={isWorkspace
        ? 'mx-auto w-full max-w-3xl'
        : 'assistant-panel-enter max-w-4xl mx-auto w-[92%] sm:w-full pointer-events-auto pb-2 sm:pb-3'}>
        {!isWorkspace && !props.onSend && (
          <div className="flex items-center gap-2.5 overflow-x-auto pb-2 pr-11 custom-scroll">
            {(activeTemplate
              ? ['Yönetici özeti ekle', 'Daha sade bir tasarım yap', 'Karşılaştırma tablosu ekle']
              : ['Cron job detay modalı veya log geçmişi', 'Yapay zeka asistanı açıkken chat geçmişini göster']
            ).map((suggestion) => (
              <button key={suggestion} onClick={() => { setInput(suggestion); inputRef.current?.focus() }} className="relative group inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-medium text-slate-200 bg-[#16171b]/95 border border-slate-700/60 hover:border-purple-500/50 transition-all shadow-md backdrop-blur-md" type="button">
                <span className="truncate max-w-[220px] sm:max-w-[280px]">{suggestion}</span>
              </button>
            ))}
          </div>
        )}

        <div className={isWorkspace
          ? 'assistant-composer relative rounded-2xl border border-slate-200 bg-white p-2 shadow-lg shadow-slate-900/5 focus-within:border-blue-400'
          : 'assistant-composer relative rounded-[26px] bg-gradient-to-r from-purple-500/30 via-indigo-500/20 to-teal-500/30 p-[1.5px] shadow-2xl backdrop-blur-xl'}>
          <div className={isWorkspace ? 'w-full' : 'rounded-[25px] border border-white/5 bg-[#14151a]/95 p-4 sm:p-5'}>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-label="Sohbete dosya seç"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,.json,.html,.htm"
              onChange={(event) => {
                const selected = event.target.files?.[0]
                event.target.value = ''
                if (!selected) return
                const error = validateChatFile(selected)
                setFileError(error)
                setFile(error ? null : selected)
              }}
            />
            {!isWorkspace && (
              <button
                type="button"
                aria-label="Yapay zekâ asistanını kapat"
                onClick={() => props.onOpenChange(false)}
                className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              ><X className="h-4 w-4" /></button>
            )}

            <div className={isWorkspace ? 'flex items-end gap-2' : 'flex flex-col gap-4 pr-9'}>
              <textarea
                ref={inputRef}
                aria-label="Mesaj"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    submit()
                  }
                }}
                rows={1}
                maxLength={MAX_MESSAGE_LENGTH}
                disabled={!isWorkspace && isDisabled}
                className={isWorkspace
                  ? 'custom-scroll max-h-36 min-h-9 w-full flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-400'
                  : 'custom-scroll min-h-6 w-full flex-1 resize-none bg-transparent p-0 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-400 disabled:opacity-60 sm:text-base'}
                placeholder={isWorkspace || (!isWorkspace && props.onSend) ? 'Mevzuatla ilgili bir soru sorun…' : activeTemplate ? 'Şablonda ne oluşturmak veya değiştirmek istiyorsunuz?' : activeReport ? `“${activeReport.title.slice(0, 48)}” için revizyon isteyin…` : 'Ne değiştirmek veya oluşturmak istiyorsunuz?'}
              />
              {isWorkspace && (
                <>
                  <button type="button" aria-label="Dosya ekle" onClick={() => fileRef.current?.click()} disabled={isDisabled} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-40">
                    <span className="text-xl leading-none">+</span>
                  </button>
                  <button onClick={submit} disabled={isDisabled || (!input.trim() && !file)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white transition hover:bg-slate-700 disabled:opacity-40" aria-label="Gönder" type="button">
                    {isDisabled ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendIcon />}
                  </button>
                </>
              )}
            </div>

            {file && (
              <div className={`mt-3 flex w-fit max-w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs ${isWorkspace ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-white/15 bg-white/10 text-slate-100'}`}>
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 opacity-60">{(file.size / 1024).toFixed(0)} KB</span>
                <button type="button" aria-label="Ekli dosyayı kaldır" onClick={() => setFile(null)} className="rounded p-0.5 hover:bg-slate-500/20"><X className="h-3.5 w-3.5" /></button>
              </div>
            )}
            {fileError && <p role="alert" className={`mt-2 text-xs ${isWorkspace ? 'text-rose-700' : 'text-rose-300'}`}>{fileError}</p>}

            {!isWorkspace && (
              <div className="mt-4 flex items-center justify-between gap-3 pt-1">
                <button className="p-1 text-slate-300 transition hover:text-white active:scale-95" title={activeTemplate ? 'Şablon isteğine dosya eklenemiyor' : 'Dosya ekle'} aria-label="Dosya ekle" onClick={() => fileRef.current?.click()} disabled={isDisabled || !!activeTemplate} type="button">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 4.5v15m7.5-7.5h-15" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <button onClick={submit} disabled={isDisabled || (!input.trim() && !file)} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-slate-300 transition hover:bg-slate-700 hover:text-white active:scale-95 disabled:opacity-40" aria-label="Gönder" type="button">
                  {isDisabled ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendIcon />}
                </button>
              </div>
            )}
            {activeReport?.isPrompting && !isWorkspace && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-300">
                <LoaderCircle className="h-3 w-3 animate-spin" />Talebiniz rapora uygulanıyor…
              </p>
            )}
            {activeTemplate?.isPrompting && !isWorkspace && <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-300"><LoaderCircle className="h-3 w-3 animate-spin" />Şablon taslağı güncelleniyor…</p>}
          </div>
        </div>
      </div>
    </aside>
  )
}

function SendIcon() {
  return <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 19.5V4.5m0 0l-6 6m6-6l6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
