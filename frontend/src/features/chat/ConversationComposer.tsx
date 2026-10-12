import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Tag, Typography } from 'antd'
import { ArrowUpOutlined, GlobalOutlined, DesktopOutlined, StopOutlined } from '@ant-design/icons'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import { ComposerAttachments } from './ComposerAttachments'
import { AttachmentList, type DocumentAttachment } from '../documents/AttachmentList'
import { MAX_MESSAGE_LENGTH, type ChatSendOptions } from './types'

interface Props {
  onStop?:()=>void
  isSending: boolean
  onSend: (content: string, documentVersionIds?: string[], options?:ChatSendOptions) => void
  autoFocus?: boolean
  attachmentsEnabled?: boolean
  placeholder?: string
}

export function ConversationComposer({ isSending, onSend, autoFocus = true, attachmentsEnabled = true, placeholder = "Mevzuatla ilgili bir soru sorun…", onStop }: Props) {
  const [browserAgent,setBrowserAgent] = useState(false)
  const [webSearch,setWebSearch] = useState(false)
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string|null>(null)
  const field = useRef<TextAreaRef>(null)

  useEffect(() => { if (autoFocus) field.current?.focus() }, [autoFocus])

  const submit = () => {
    const content = value.trim()
    if (!content || isSending || uploading || content.length > MAX_MESSAGE_LENGTH) return
    setAttachmentError(null)
    setValue('')
    if(browserAgent)onSend(content,[],{browserAgent:true})
    else if(webSearch)onSend(content,[],{webSearch:true})
    else onSend(content, attachments.map(item => item.id))
    setAttachments([])
  }

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); submit() }}
      className="atez-chat-composer"
    >
      <div className="atez-chat-composer-box">
        {attachments.length>0 && <AttachmentList items={attachments} onRemove={id => setAttachments(current => current.filter(item => item.id !== id))} />}
        {attachmentError && <Alert type="error" title={attachmentError} closable onClose={()=>setAttachmentError(null)} />}
        {uploading && <Typography.Text type="secondary" role="status">Belgeler yükleniyor…</Typography.Text>}
        <Input.TextArea
          ref={field}
          aria-label="Mesaj"
          value={value}
          autoSize={{ minRows: 1, maxRows: 7 }}
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is how you write a second line.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={placeholder}
          variant="borderless"
        />
        <div className="atez-chat-composer-toolbar">
          <div className="atez-chat-composer-tools">
          {attachmentsEnabled && <ComposerAttachments items={attachments} disabled={isSending || uploading} webSearch={webSearch} browserAgent={browserAgent} onBrowserAgentChange={enabled=>{setBrowserAgent(enabled);if(enabled)setWebSearch(false)}} onWebSearchChange={enabled=>{if(enabled && attachments.length){setAttachmentError('Web araması için ekli belgeleri kaldırın.');return}setWebSearch(enabled);if(enabled)setBrowserAgent(false)}}
            onAdd={item=>setAttachments(current=>current.some(value=>value.id===item.id) ? current : [...current,item])}
            onRemove={id=>setAttachments(current=>current.filter(item=>item.id!==id))}
            onBusyChange={setUploading} onError={setAttachmentError} />}
          {(webSearch||browserAgent) && <Tag className="atez-chat-tool-chip" icon={browserAgent?<DesktopOutlined />:<GlobalOutlined />} closable onClose={()=>{setWebSearch(false);setBrowserAgent(false)}}>{browserAgent?'Tarayıcı ajanı':'Web’de ara'}</Tag>}
          </div>
        {isSending && onStop ? <Button type="primary" shape="circle" aria-label="Yanıtı durdur" icon={<StopOutlined />} className="atez-chat-send" onClick={onStop}/> : <Button
          htmlType="submit"
          type="primary"
          aria-label="Gönder"
          disabled={isSending || uploading || value.trim().length === 0}
          loading={isSending}
          icon={<ArrowUpOutlined />}
          shape="circle"
          className="atez-chat-send"
        />}
        </div>
      </div>
      <Typography.Text type="secondary" className="atez-chat-composer-note">
        Enter ile gönderin, Shift+Enter ile satır ekleyin. Yanıtlar yapay zekâ tarafından üretilir; kritik kararlar için kaynağı doğrulayın.
      </Typography.Text>
    </form>
  )
}
