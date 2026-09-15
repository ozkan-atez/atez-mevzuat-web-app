import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LoaderCircle, X } from 'lucide-react'
import { useActiveReport } from '../revision/ActiveReportContext'

interface DockedAiAssistantProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

function AssistantLauncherIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" viewBox="0 0 32 32">
      <circle cx="16" cy="5" r="2.25" fill="currentColor" />
      <circle cx="23.8" cy="8.2" r="2.25" fill="currentColor" />
      <circle cx="27" cy="16" r="2.25" fill="currentColor" />
      <circle cx="23.8" cy="23.8" r="2.25" fill="currentColor" />
      <circle cx="16" cy="27" r="2.25" fill="currentColor" />
      <circle cx="8.2" cy="23.8" r="2.25" fill="currentColor" />
      <circle cx="5" cy="16" r="2.25" fill="currentColor" />
      <circle cx="8.2" cy="8.2" r="2.25" fill="currentColor" />
    </svg>
  )
}

export function DockedAiAssistant({ isOpen, onOpenChange }: DockedAiAssistantProps) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const activeReport = useActiveReport()
  const navigate = useNavigate()

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  // On a report page the request becomes a revision for that report. The result
  // lands in its change list, so no transcript is shown here. Anywhere else it is
  // a question, and questions belong in the workspace where the answer and the
  // rest of the conversation are visible — so the message travels there with the
  // user rather than being answered in a bar they cannot scroll.
  const submit = () => {
    const message = input.trim()
    if (!message || activeReport?.isPrompting) return
    setInput('')
    if (activeReport) {
      void activeReport.submitPrompt(message)
      return
    }
    onOpenChange(false)
    navigate('/chat', { state: { initialMessage: message }, viewTransition: true })
  }

  if (!isOpen) {
    return (
      <aside className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2" data-purpose="docked-copilot-launcher">
        <button
          type="button"
          aria-label="Yapay zekâ asistanını aç"
          onClick={() => onOpenChange(true)}
          className="group flex h-12 w-12 items-center justify-center rounded-full border border-slate-300/80 bg-white/95 text-slate-900 shadow-lg shadow-slate-900/15 backdrop-blur-xl transition-all duration-300 ease-out hover:scale-125 hover:border-indigo-300 hover:text-indigo-700 hover:shadow-xl hover:shadow-indigo-500/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/25 active:scale-110 motion-reduce:transform-none"
        >
          <span className="transition-transform duration-300 ease-out group-hover:rotate-12">
            <AssistantLauncherIcon />
          </span>
        </button>
      </aside>
    )
  }

  return (
    <aside className="fixed bottom-0 inset-x-0 z-40 p-3 sm:p-4 pointer-events-none" data-purpose="docked-copilot-bar">
      <div className="assistant-panel-enter max-w-4xl mx-auto w-[92%] sm:w-full pointer-events-auto pb-2 sm:pb-3">
        <div className="flex items-center gap-2.5 overflow-x-auto pb-2 pr-11 custom-scroll">
          <button onClick={() => setInput('Cron job detay modalı veya log geçmişi')} className="relative group inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-medium text-slate-200 bg-[#16171b]/95 border border-slate-700/60 hover:border-purple-500/50 transition-all shadow-md backdrop-blur-md" type="button">
            <span className="truncate max-w-[220px] sm:max-w-[280px]">Cron job detay modalı veya log geçmişi</span>
          </button>
          <button onClick={() => setInput('Yapay zeka asistanı açıkken chat geçmişini göster')} className="relative group inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-medium text-slate-200 bg-[#16171b]/95 border border-slate-700/60 hover:border-purple-500/50 transition-all shadow-md backdrop-blur-md" type="button">
            <span className="truncate max-w-[220px] sm:max-w-[280px]">Yapay zeka asistanı açıkken chat geçmişini göster</span>
          </button>
        </div>

        <div className="relative rounded-[26px] p-[1.5px] bg-gradient-to-r from-purple-500/30 via-indigo-500/20 to-teal-500/30 shadow-2xl backdrop-blur-xl">
          <div className="bg-[#14151a]/95 rounded-[25px] p-4 sm:p-5 flex flex-col gap-4 border border-white/5">
            <button
              type="button"
              aria-label="Yapay zekâ asistanını kapat"
              onClick={() => onOpenChange(false)}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="w-full pr-9">
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit() } }}
                disabled={activeReport?.isPrompting ?? false}
                className="w-full bg-transparent border-0 text-slate-100 text-sm sm:text-base placeholder-slate-400 font-normal p-0 focus:ring-0 outline-none leading-relaxed disabled:opacity-60"
                placeholder={activeReport ? `“${activeReport.title.slice(0, 48)}” için revizyon isteyin…` : 'Ne değiştirmek veya oluşturmak istiyorsunuz?'}
                type="text"
              />
              {activeReport?.isPrompting && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-300">
                  <LoaderCircle className="h-3 w-3 animate-spin" />Talebiniz rapora uygulanıyor…
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-3 text-slate-400">
                <button className="p-1 text-slate-300 hover:text-white transition active:scale-95" title="Ekle" type="button">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 4.5v15m7.5-7.5h-15" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                </button>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <button onClick={submit} disabled={!input.trim() || (activeReport?.isPrompting ?? false)} className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition active:scale-95 disabled:opacity-40" title="Gönder" type="button">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 19.5V4.5m0 0l-6 6m6-6l6 6" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
