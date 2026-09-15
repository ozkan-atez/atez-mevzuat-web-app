import { useEffect, useRef, useState } from 'react'
import { ArrowUp, LoaderCircle } from 'lucide-react'
import { MAX_MESSAGE_LENGTH } from './types'

interface Props {
  isSending: boolean
  onSend: (content: string) => void
  autoFocus?: boolean
}

export function ConversationComposer({ isSending, onSend, autoFocus = true }: Props) {
  const [value, setValue] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (autoFocus) field.current?.focus() }, [autoFocus])

  // Grows with the text instead of scrolling inside a two-line box. Measured from
  // zero height, and again after the first paint: on mount the stylesheet may not
  // have applied yet and the box would freeze at its unstyled size.
  useEffect(() => {
    const resize = () => {
      const element = field.current
      if (!element) return
      element.style.height = '0px'
      element.style.height = `${Math.min(element.scrollHeight, 200)}px`
    }
    resize()
    const frame = requestAnimationFrame(resize)
    return () => cancelAnimationFrame(frame)
  }, [value])

  const submit = () => {
    const content = value.trim()
    if (!content || isSending || content.length > MAX_MESSAGE_LENGTH) return
    setValue('')
    onSend(content)
  }

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); submit() }}
      className="mx-auto w-full max-w-3xl px-4 pb-5 sm:px-6"
    >
      <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg shadow-slate-900/5 focus-within:border-blue-400">
        <textarea
          ref={field}
          aria-label="Mesaj"
          value={value}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is how you write a second line.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder="Mevzuatla ilgili bir soru sorun…"
          className="max-h-52 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-400"
        />
        <button
          type="submit"
          aria-label="Gönder"
          disabled={isSending || value.trim().length === 0}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white transition hover:bg-slate-700 disabled:opacity-40"
        >
          {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-400">
        Enter ile gönderin, Shift+Enter ile satır ekleyin. Yanıtlar yapay zekâ tarafından üretilir; kritik kararlar için kaynağı doğrulayın.
      </p>
    </form>
  )
}
