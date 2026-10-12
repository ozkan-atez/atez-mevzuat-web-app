import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Empty, Input, Pagination, Spin } from 'antd'
import { DesktopOutlined, GlobalOutlined, PaperClipOutlined, PlusOutlined } from '@ant-design/icons'
import { useCan } from '../auth/AuthProvider'
import { listDocuments, uploadDocument, importDocument, type ArchiveDocument } from '../documents/api'
import type { DocumentAttachment } from '../documents/AttachmentList'

const MAX_ATTACHMENTS = 10

export function ComposerAttachments({onSelectSources,hasSources,items,disabled,onAdd,onRemove,onBusyChange,onError,webSearch,onWebSearchChange,browserAgent,onBrowserAgentChange}: {
  onSelectSources?:()=>void;hasSources?:boolean;
  browserAgent?:boolean;onBrowserAgentChange?:(enabled:boolean)=>void;
  webSearch?:boolean;onWebSearchChange?:(enabled:boolean)=>void;
  items:DocumentAttachment[];disabled:boolean;onAdd:(item:DocumentAttachment)=>void;onRemove:(id:string)=>void;
  onBusyChange:(busy:boolean)=>void;onError:(message:string|null)=>void;
}) {
  const canUpload = useCan('document.upload')
  const [link,setLink]=useState('')
  const [showLink,setShowLink]=useState(false)
  const [open,setOpen] = useState(false)
  const [query,setQuery] = useState('')
  const [page,setPage] = useState(1)
  const [documents,setDocuments] = useState<ArchiveDocument[]>([])
  const [reload,setReload] = useState(0)
  const [total,setTotal] = useState(0)
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState<string|null>(null)
  const host = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const uploading = useRef(false)

  useEffect(()=>{
    if(!open || !query.trim())return
    let disposed=false
    setLoading(true);setError(null)
    const timer=setTimeout(()=>{
      void listDocuments(query,{page,limit:10}).then(result=>{
        if(!disposed){setDocuments(result.documents);setTotal(result.total)}
      }).catch(error=>{if(!disposed)setError(error instanceof Error ? error.message : 'Belgeler alınamadı.')})
        .finally(()=>{if(!disposed)setLoading(false)})
    },200)
    return()=>{disposed=true;clearTimeout(timer)}
  },[open,query,page,reload])

  useEffect(()=>{
    if(!open)return
    const dismiss=(event:MouseEvent)=>{if(event.target instanceof Node && !host.current?.contains(event.target))setOpen(false)}
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);host.current?.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus()}}
    document.addEventListener('mousedown',dismiss)
    document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('mousedown',dismiss);document.removeEventListener('keydown',escape)}
  },[open])

  const upload = async (files:File[])=>{
    if(!files.length || disabled || webSearch || browserAgent || uploading.current || !canUpload)return
    if(files.length + items.length > MAX_ATTACHMENTS){onError('Bir mesaja en fazla 10 belge ekleyebilirsiniz.');return}
    uploading.current=true;onBusyChange(true);onError(null);setOpen(false)
    const errors:string[]=[]
    try {
      for(const file of files){
        try {
          const result=await uploadDocument(file)
          onAdd({id:result.version.id,title:result.document.title})
        } catch(error){errors.push(`${file.name}: ${error instanceof Error ? error.message : 'Yüklenemedi.'}`)}
      }
      if(errors.length)onError(errors.join(' '))
    } finally {uploading.current=false;onBusyChange(false)}
  }

  const panel = <div className="atez-composer-attachment-panel" id="chat-attachment-panel" onKeyDown={event=>{if(event.key==='Enter' && event.target instanceof HTMLInputElement)event.preventDefault()}}>
      {onSelectSources&&<Button type="text" onClick={()=>{setOpen(false);onSelectSources()}}>Kaynak seç</Button>}
      {canUpload&&<Button type="text" disabled={disabled||webSearch||browserAgent} onClick={()=>setShowLink(value=>!value)}>Bağlantı ekle</Button>}
      {showLink&&<div><Input aria-label="Belge bağlantısı" placeholder="https://…" value={link} onChange={e=>setLink(e.target.value)}/><Button disabled={disabled||!link||webSearch||browserAgent||items.length>=MAX_ATTACHMENTS} onClick={async()=>{onBusyChange(true);try{const result=await importDocument({kind:'URL',url:link});onAdd({id:result.version.id,title:result.document.title});setLink('');setShowLink(false)}catch(error){onError(error instanceof Error?error.message:'Bağlantı eklenemedi.')}finally{onBusyChange(false)}}}>Bağlantıyı ekle</Button></div>}
      {canUpload && <Button type="text" aria-label="Bilgisayardan dosya ekle" icon={<PaperClipOutlined aria-hidden />} disabled={disabled || webSearch || browserAgent || items.length>=MAX_ATTACHMENTS} onClick={()=>{setOpen(false);input.current?.click()}}>Bilgisayardan dosya ekle</Button>}
      {onWebSearchChange && <Button type="text" aria-label="Web’de ara" icon={<GlobalOutlined aria-hidden />} disabled={disabled || items.length>0 || hasSources} onClick={()=>{onWebSearchChange(!webSearch);setOpen(false)}}>Web’de ara{webSearch ? ' · Açık' : ''}</Button>}
      {onBrowserAgentChange && <Button type="text" aria-label="Tarayıcı ajanı" icon={<DesktopOutlined aria-hidden />} disabled={disabled || items.length>0 || hasSources} onClick={()=>{onBrowserAgentChange(!browserAgent);setOpen(false)}}>Tarayıcı ajanı{browserAgent?' · Açık':''}</Button>}
      <div className="atez-composer-search-section">
        <div className="atez-composer-archive-heading"><span>Dosyalar</span>{items.length>0 && <span>{items.length}/10</span>}</div>
        <Input aria-label="Arşivde belge ara" placeholder="Dosya aramak için yazın…" value={query} variant="borderless" allowClear onChange={event=>{setQuery(event.target.value);setPage(1);setDocuments([]);setError(null)}} />
      </div>
      {query.trim() && <>
      {error && <Alert type="error" title={error} action={<Button size="small" onClick={()=>setReload(current=>current+1)}>Yeniden dene</Button>}/>}
      <Spin spinning={loading}><div className="atez-composer-archive-list">
        {documents.map(doc=>{
          const version=doc.latestVersion
          const selected=items.some(item=>item.id===version?.id)
          return <Checkbox key={doc.id} checked={selected} disabled={disabled || webSearch || browserAgent || !version || (!selected && items.length>=MAX_ATTACHMENTS)} onChange={event=>{if(!version)return;onError(null);if(event.target.checked)onAdd({id:version.id,title:doc.title});else onRemove(version.id)}}><span title={doc.title}>{doc.title}</span></Checkbox>
        })}
        {!loading && !error && !documents.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Belge bulunamadı."/>}
      </div></Spin>
      {total>10 && <Pagination simple current={page} pageSize={10} total={total} onChange={setPage} showSizeChanger={false} size="small"/>}
      </>}
  </div>

  return <div className="atez-composer-attachments" ref={host}>
    <input hidden ref={input} type="file" multiple aria-label="Sohbete dosya yükle" onChange={event=>{const files=Array.from(event.target.files ?? []);event.target.value='';void upload(files)}} />
    {open && panel}
    <Button type="text" shape="circle" aria-label="Belge ekle" aria-expanded={open} aria-controls={open ? 'chat-attachment-panel' : undefined} disabled={disabled} icon={<PlusOutlined />} className="atez-chat-add" onClick={()=>setOpen(current=>!current)} />
  </div>
}
