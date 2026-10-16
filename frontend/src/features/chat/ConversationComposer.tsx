import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Tag, Typography } from 'antd'
import { ArrowUpOutlined } from '@ant-design/icons'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import { ComposerContext, type SourceOption, type TemplateOption } from './ComposerContext'
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
  const [sources, setSources] = useState<SourceOption[]>([])
  const [template, setTemplate] = useState<TemplateOption | null>(null)
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
    if (sources.length || template) onSend(content, attachments.map(item => item.id), {...(sources.length ? {sourceIds: sources.map(item => item.id)} : {}), ...(template ? {templateId: template.id} : {})})
    else onSend(content, attachments.map(item => item.id))
    setAttachments([])
  }

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); submit() }}
      className="atez-chat-composer"
    >
      <div className="atez-chat-composer-box">
        {(sources.length > 0 || template) && <div className="atez-chat-context-chips">
          {sources.map(source => <Tag key={source.id} closable={!isSending} onClose={() => setSources(current => current.filter(item => item.id !== source.id))}>{source.title}</Tag>)}
          {template && <Tag closable={!isSending} onClose={() => setTemplate(null)}>Şablon: {template.name}</Tag>}
        </div>}
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
          {attachmentsEnabled && <ComposerAttachments sourcesSelected={sources.length > 0} hasContext={sources.length > 0 || !!template} contextPanel={<ComposerContext sources={sources} template={template} disabled={isSending} sourcesDisabled={attachments.length > 0} onSourcesChange={setSources} onTemplateChange={setTemplate} />} items={attachments} disabled={isSending || uploading}
            onAdd={item=>setAttachments(current=>current.some(value=>value.id===item.id) ? current : [...current,item])}
            onRemove={id=>setAttachments(current=>current.filter(item=>item.id!==id))}
            onBusyChange={setUploading} onError={setAttachmentError} />}
          </div>
        {isSending && onStop ? <Button type="primary" shape="circle" aria-label="Yanıtı durdur" title="Yanıtı durdur" icon={<span className="atez-chat-stop-icon" aria-hidden="true" style={{ display: 'block', width: 14, height: 14, backgroundColor: 'currentColor', borderRadius: 2 }} />} className="atez-chat-send" onClick={onStop}/> : <Button
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
