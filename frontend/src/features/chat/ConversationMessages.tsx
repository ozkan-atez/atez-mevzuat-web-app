import { useEffect, useRef } from 'react'
import { AlertTriangle, Sparkles } from 'lucide-react'
import { renderMarkdown } from './renderMarkdown'
import { STREAMING_MESSAGE_ID } from './useConversation'
import type { ChatMessage } from './types'

interface Props {
  messages: ChatMessage[]
  isSending: boolean
}

export function ConversationMessages({ messages, isSending }: Props) {
  const anchor = useRef<HTMLDivElement>(null)

  useEffect(() => {
    anchor.current?.scrollIntoView?.({ block: 'end' })
  }, [messages])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
      {messages.map((message) => {
        const isUser = message.role === 'USER'
        const isStreaming = message.id === STREAMING_MESSAGE_ID
        if (message.status === 'FAILED') {
          return (
            <div key={message.id} className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{message.errorDetail ?? 'Yanıt tamamlanamadı.'}</p>
            </div>
          )
        }
        return (
          <div key={message.id} className={isUser ? 'flex justify-end' : 'flex justify-start gap-3'}>
            {!isUser && (
              <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
            )}
            <div className={`break-words text-sm leading-relaxed ${
              isUser
                ? 'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-slate-900 px-4 py-2.5 text-white'
                : 'max-w-[85%] pt-1 text-slate-800'
            }`}>
              {/* The user's own words verbatim; the model's Markdown as React
                  elements, so untrusted output is never injected as HTML. */}
              {isUser ? message.content : renderMarkdown(message.content)}
              {isStreaming && isSending && (
                <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-slate-400 align-middle" aria-label="Yanıt yazılıyor" />
              )}
            </div>
          </div>
        )
      })}
      <div ref={anchor} />
    </div>
  )
}
