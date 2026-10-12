import { useEffect, useRef } from 'react'
import { Alert, Tag } from 'antd'
import { GlobalOutlined, SearchOutlined } from '@ant-design/icons'
import { OperationTaskCard } from '../operations/OperationTaskCard'
import { renderMarkdown } from './renderMarkdown'
import { STREAMING_MESSAGE_ID } from './useConversation'
import type { ChatMessage } from './types'

interface Props {
  messages: ChatMessage[]
  isSending: boolean
  activity: string | null
}

export function ConversationMessages({ messages, isSending, activity }: Props) {
  const anchor = useRef<HTMLDivElement>(null)

  useEffect(() => {
    anchor.current?.scrollIntoView?.({ block: 'end' })
  }, [messages, activity])

  return (
    <div className="atez-chat-messages">
      {messages.map((message) => {
        const isUser = message.role === 'USER'
        const isStreaming = message.id === STREAMING_MESSAGE_ID
        if (message.status === 'FAILED') {
          return (
            <Alert key={message.id} type="error" showIcon message={message.errorDetail === 'MODEL_GENERATION_FAILED' ? 'Yapay zekâ yanıtı tamamlanamadı. Rapor sorgunuzu yeniden gönderebilirsiniz.' : message.errorDetail ?? 'Yanıt tamamlanamadı.'} />
          )
        }
        return (
          <div key={message.id} className={`atez-chat-message ${isUser ? 'user' : 'assistant'}`}>
            {!isUser && (
              <span className="atez-chat-orb atez-chat-message-orb" aria-hidden="true" />
            )}
            <div className="atez-chat-message-body">
              {/* The user's own words verbatim; the model's Markdown as React
                  elements, so untrusted output is never injected as HTML. */}
              {isUser ? message.content : renderMarkdown(message.content)}
              {message.research && <div className="atez-chat-web-sources">
                {message.research.sources.length>0 && <span className="atez-chat-web-source-label"><GlobalOutlined /> {message.research.mode==='browser'?'Tarayıcıda açılan kaynaklar':'Web kaynakları'}</span>}
                {message.research.sources.map((source,index)=>/^https:\/\//.test(source.url) && <a key={`${source.url}:${index}`} href={source.url} target="_blank" rel="noopener noreferrer">{index+1}. {source.title}</a>)}
                {message.research.searchSuggestions && <iframe title="Google Search önerileri" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'">${message.research.searchSuggestions}`} />}
              </div>}
              {message.documentVersionIds?.length ? <Tag>{message.documentVersionIds.length} belge eklendi</Tag> : null}
              {message.operationRequestIds?.map(id => <OperationTaskCard key={id} requestId={id} />)}
              {isStreaming && isSending && (
                activity
                  ? <Tag icon={<SearchOutlined />}>{activity}…</Tag>
                  : <span className="atez-chat-cursor" aria-label="Yanıt yazılıyor" />
              )}
            </div>
          </div>
        )
      })}
      <div ref={anchor} />
    </div>
  )
}
