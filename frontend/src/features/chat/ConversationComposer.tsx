import { SourcePicker } from './SourcePicker'
import { listSources } from '../workspace/api'
import type { ChatContext } from './types'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Tag, Typography } from 'antd'
import { ArrowUpOutlined, GlobalOutlined, DesktopOutlined, StopOutlined } from '@ant-design/icons'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import { ComposerAttachments } from './ComposerAttachments'
import { AttachmentList, type DocumentAttachment } from '../documents/AttachmentList'
import { MAX_MESSAGE_LENGTH, type ChatSendOptions } from './types'

interface Props {
  initialContext?:ChatContext
  scanIntent?:boolean
  onStop?:()=>void
  isSending: boolean
  onSend: (content: string, documentVersionIds?: string[], options?:ChatSendOptions) => void | Promise<boolean | void>
  autoFocus?: boolean
  attachmentsEnabled?: boolean
  placeholder?: string
}

export function ConversationComposer({ initialContext, scanIntent=false, isSending, onSend, autoFocus = true, attachmentsEnabled = true, placeholder = "Mevzuatla ilgili bir soru sorun…", onStop }: Props) {
  const [template,setTemplate]=useState<{id:string;revision?:number}|undefined>(initialContext?.templateId?{id:initialContext.templateId,revision:initialContext.templateRevision}:undefined)
  const [sourceIds,setSourceIds]=useState<string[]>(initialContext?.sourceIds??[])
  const [sourceNames,setSourceNames]=useState<Record<string,string>>({})
  const [sourcePicker,setSourcePicker]=useState(scanIntent)
  const [browserAgent,setBrowserAgent] = useState(false)
  const [webSearch,setWebSearch] = useState(false)
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string|null>(null)
  const field = useRef<TextAreaRef>(null)

  useEffect(()=>{if(initialContext){setTemplate(initialContext.templateId?{id:initialContext.templateId,revision:initialContext.templateRevision}:undefined);setSourceIds(initialContext.sourceIds);setAttachments(current=>initialContext.documentVersionIds.map(id=>current.find(item=>item.id===id)??{id,title:'Seçili belge'}));setWebSearch(initialContext.mode==='WEB');setBrowserAgent(initialContext.mode==='BROWSER')}},[initialContext])
  useEffect(()=>{if(sourceIds.length)void listSources().then(r=>setSourceNames(Object.fromEntries(r.sources.map(s=>[s.id,s.name||s.key])))).catch(()=>{})},[sourceIds])

  useEffect(() => { if (autoFocus) field.current?.focus() }, [autoFocus])

  const submit = async () => {
    const content = value.trim()
    if (!content || isSending || uploading || content.length > MAX_MESSAGE_LENGTH) return
    setAttachmentError(null)
    if(!sourceIds.length && /tarama.*başlat|tarama.*baslat|tarama.*yap/i.test(content)){setSourcePicker(true);setAttachmentError('Önce taranacak kaynakları seçin.');return}
    const documentVersionIds=attachments.map(item=>item.id)
    try {
      const result=await onSend(content,documentVersionIds,{...(browserAgent?{browserAgent:true}:webSearch?{webSearch:true}:{}),context:{mode:browserAgent?'BROWSER':webSearch?'WEB':'SELECTED',sourceIds,documentVersionIds,...(template?{templateId:template.id,templateRevision:template.revision}:{})}})
      if(result!==false)setValue('')
    } catch(error){setAttachmentError(error instanceof Error?error.message:'Mesaj gönderilemedi. Seçimleriniz korundu.')}

  }

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); submit() }}
      className="atez-chat-composer"
    >
      <SourcePicker templateId={template?.id} onTemplateChange={value=>setTemplate(value?{id:value.id,revision:value.revision}:undefined)} open={sourcePicker} selected={sourceIds} onChange={ids=>{setSourceIds(ids);if(ids.length){setWebSearch(false);setBrowserAgent(false)}}} onClose={()=>setSourcePicker(false)}/>
      <div className="atez-chat-composer-box">
        {sourceIds.length>0&&<div className="atez-source-chips">{sourceIds.map(id=><Tag key={id} closable={!isSending} onClose={()=>setSourceIds(ids=>ids.filter(value=>value!==id))}>{sourceNames[id]??'Seçili kaynak'}</Tag>)}<Typography.Text type="secondary">Yanıtlar yalnızca seçtiğiniz kaynaklara dayanır.</Typography.Text></div>}
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
          {attachmentsEnabled && <ComposerAttachments onSelectSources={()=>setSourcePicker(true)} hasSources={sourceIds.length>0} items={attachments} disabled={isSending || uploading} webSearch={webSearch} browserAgent={browserAgent} onBrowserAgentChange={enabled=>{if(enabled&&(attachments.length||sourceIds.length)){setAttachmentError('Önce kaynakları ve belgeleri kaldırın.');return}setBrowserAgent(enabled);if(enabled)setWebSearch(false)}} onWebSearchChange={enabled=>{if(enabled && (attachments.length||sourceIds.length)){setAttachmentError('Web araması için ekli belgeleri kaldırın.');return}setWebSearch(enabled);if(enabled)setBrowserAgent(false)}}
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
