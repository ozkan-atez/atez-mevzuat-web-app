import { useEffect, useRef } from 'react'
import { AlertTriangle, FileText, Search } from 'lucide-react'
import { AssistantIcon } from './AssistantIcon'
import { renderMarkdown } from './renderMarkdown'
import { STREAMING_MESSAGE_ID } from './useConversation'
import type { ChatMessage } from './types'

interface Props {
  sessionId?: string
  messages: ChatMessage[]
  isSending: boolean
  activity: string | null
  onRetry?: (content: string) => void
}

export function ConversationMessages({ sessionId, messages, isSending, activity, onRetry }: Props) {
  const anchor = useRef<HTMLDivElement>(null)

  useEffect(() => {
    anchor.current?.scrollIntoView?.({ block: 'end' })
  }, [messages, activity])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
      {messages.map((message, index) => {
        const isUser = message.role === 'USER'
        const isStreaming = message.id === STREAMING_MESSAGE_ID
        if (message.status === 'FAILED' || (message.role === 'ASSISTANT' && !isStreaming && !message.content.trim())) {
          const previousQuestion = messages.slice(0, index).reverse().find((item) => item.role === 'USER')?.content
          return (
            <div key={message.id} className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p>Bu soruya yanıt oluşturulamadı.</p>
                {previousQuestion && onRetry && <button type="button" onClick={() => onRetry(previousQuestion)} disabled={isSending} className="mt-2 font-semibold underline underline-offset-2 disabled:opacity-50">Yeniden dene</button>}
              </div>
            </div>
          )
        }
        return (
          <div key={message.id} className={isUser ? 'flex justify-end' : 'flex justify-start gap-3'}>
            {!isUser && (
              <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
                <AssistantIcon className="h-3.5 w-3.5" />
              </span>
            )}
            <div className={`break-words text-sm leading-6 sm:text-base sm:leading-7 ${
              isUser
                ? 'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-slate-900 px-4 py-2.5 text-white'
                : 'max-w-[85%] pt-1 text-slate-800'
            }`}>
              {/* The user's own words verbatim; the model's Markdown as React
                  elements, so untrusted output is never injected as HTML. */}
              {isUser ? message.content : renderMarkdown(message.content)}
              {isUser && message.attachment && (
                sessionId && !message.attachment.id.startsWith('pending-')
                  ? <a href={`/api/v1/chat/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(message.attachment.id)}`}
                      className="mt-2 flex w-fit max-w-full items-center gap-2 rounded-lg border border-white/25 bg-white/10 px-2.5 py-1.5 text-xs text-white hover:bg-white/20"
                      download={message.attachment.name}>
                      <FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{message.attachment.name}</span>
                    </a>
                  : <span className="mt-2 flex w-fit max-w-full items-center gap-2 rounded-lg border border-white/25 bg-white/10 px-2.5 py-1.5 text-xs text-white">
                      <FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{message.attachment.name}</span>
                    </span>
              )}
              {isStreaming && isSending && (
                activity
                  ? <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                      <Search className="h-3 w-3 animate-pulse" />{activity}…
                    </span>
                  : <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-slate-400 align-middle" aria-label="Yanıt yazılıyor" />
              )}
            </div>
          </div>
        )
      })}
      <div ref={anchor} />
    </div>
  )
}
