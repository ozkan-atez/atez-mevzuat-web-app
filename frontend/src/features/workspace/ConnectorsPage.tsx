import { SourceIcon } from './SourceIcon'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Form, Input, Modal, Popconfirm, Space, Spin, Typography } from 'antd'
import { EditOutlined, DeleteOutlined, FileTextOutlined, GlobalOutlined, PlusOutlined, CloudUploadOutlined, LinkOutlined, SearchOutlined, CloseOutlined, CheckOutlined, ArrowRightOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { Can } from '../auth/Can'
import { apiFetch } from '../../lib/apiFetch'
import { workspaceRequest } from './api'
import type { ManagedSource } from './ManagedSourcesPanel'
import './connectors.css'

type Connector = { isActive?:boolean; id:string; name:string; baseUrl:string; key:string; profiles:Array<{status:string;verifiedAt:string|null;validation:{message?:string;checkedAt?:string}|null}> }
type Document = {id:string;title:string;canonicalUrl?:string;latestVersion:{mimeType:string;extractionStatus:string}|null}
type Extra = ManagedSource
type EditableSource = { kind: 'connector'; source: Connector } | { kind: 'extra'; source: Extra }
const fileLabel=(type:string|undefined)=>type==='application/pdf'?'PDF':type?.includes('wordprocessingml')?'Word belgesi':type?.includes('spreadsheetml')?'Excel tablosu':type?.startsWith('image/')?'Görsel':type==='text/csv'?'CSV tablosu':'Belge'
const labels:Record<string,string>={VERIFIED:'Bağlı',SETUP_QUEUED:'Kurulum sırada',SETUP_RUNNING:'Kontrol ediliyor',NEEDS_REVIEW:'Kontrol gerekli',DRAFT:'Kurulum bekliyor'}
const busyStatus=(status:string)=>['SETUP_QUEUED','SETUP_RUNNING'].includes(status)
const cleanMessage=(message:string)=>message.replace(/^[A-Z_]+:\s*/, '')
const recoveryHint=(message:string)=>message.includes('USER_ACTION_REQUIRED')?'Otomatik erişimde insan doğrulaması tespit edildi. Kaynak bağlantısını açarak sayfanın erişilebilirliğini kontrol edebilirsiniz. Kendi tarayıcınızda yaptığınız doğrulama arka plandaki tarayıcıya aktarılmaz; engel sürerse bağlantı kurulumu teknik olarak incelenmelidir. Belgeyi indirip Kaynak ekle → Yerel dosya yoluyla ekleyebilirsiniz.':message.includes('AUTH_REQUIRED')||message.includes('SUBSCRIPTION_REQUIRED')?'Test et üzerinden kayıtlı hesabı kontrol edin. Kullanıcı adı, parola ve gerekiyorsa abonelik geçerli olmalıdır.':'Test et ile yeniden deneyin. Sorun sürerse aşağıdaki hata ayrıntısı üzerinden kaynak adresi, erişim ve liste yapısı incelenmelidir.'
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'İşlem tamamlanamadı.'
export function ConnectorsPage(){
  const [sources,setSources]=useState<Connector[]>([]),[documents,setDocuments]=useState<Document[]>([]),[extras,setExtras]=useState<Extra[]>([])
  const [loading,setLoading]=useState(true)
  const [catalogLoaded,setCatalogLoaded]=useState(false)
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState<string|null>(null),[open,setOpen]=useState(false)
  const [kind,setKind]=useState('WEB'),[file,setFile]=useState<File|null>(null),[account,setAccount]=useState<Connector|null>(null)
  const [query,setQuery]=useState(''),[dragging,setDragging]=useState(false)
  const fileInput=useRef<HTMLInputElement>(null)
  const [issue,setIssue]=useState<Connector|null>(null)
  const [form]=Form.useForm(),[accountForm]=Form.useForm(),[editForm]=Form.useForm()
  const [editing,setEditing]=useState<EditableSource|null>(null)
  const [editError,setEditError]=useState('')
  const load=useCallback(async()=>{
    const result=await workspaceRequest<{sources:Connector[]}>('connectors');setSources(result.sources.filter(source=>source.isActive!==false));setCatalogLoaded(true)
    const results=await Promise.allSettled([
      workspaceRequest<{documents:Document[]}>('documents?origin=UPLOAD&limit=100'),
      workspaceRequest<{sources:Extra[]}>('managed-sources'),
    ])
    if(results[0].status==='fulfilled')setDocuments(results[0].value.documents??[])
    else if(!/403/.test(String(results[0].reason?.status)))setError('Belge arşivi yüklenemedi: '+errorMessage(results[0].reason))
    if(results[1].status==='fulfilled')setExtras((results[1].value.sources??[]).filter(source=>source.isActive!==false))
  },[])
  useEffect(()=>{void load().catch(e=>setError(errorMessage(e))).finally(()=>setLoading(false))},[load])
  useEffect(()=>{if(!sources.some(s=>busyStatus(s.profiles?.[0]?.status??'')))return;const timer=setInterval(()=>void load().catch(e=>setError(errorMessage(e))),3000);return()=>clearInterval(timer)},[sources,load])
  async function test(id:string,path:string,body?:unknown){setBusy(id);setError('');setNotice('');try{const result=await workspaceRequest<{message?:string}>(path,{method:'POST',...(body?{body:JSON.stringify(body)}:{})});setNotice(result.message??'Bağlantı kontrolü sıraya alındı. Sonuç burada görünecek.');await load()}catch(e){setError(errorMessage(e))}finally{setBusy(null)}}
  function edit(item:EditableSource){
    setEditError('');setEditing(item)
    editForm.setFieldsValue({name:item.kind==='connector'?item.source.name:item.source.title,url:item.kind==='connector'?item.source.baseUrl:item.source.url})
  }
  async function saveEdit(){
    const values=await editForm.validateFields().catch(()=>null);if(!values||!editing)return
    setBusy('edit');setEditError('')
    try{
      const item=editing
      await workspaceRequest(item.kind==='connector'?`sources/${item.source.id}`:`managed-sources/${item.source.id}`,{
        method:item.kind==='connector'?'PATCH':'PUT',
        body:JSON.stringify(item.kind==='connector'?{name:values.name.trim(),baseUrl:values.url.trim()}:{title:values.name.trim(),url:values.url.trim(),description:item.source.description,keywords:item.source.keywords,useInChat:item.source.useInChat,useInRuns:item.source.useInRuns,isActive:item.source.isActive}),
      })
      setEditing(null);setNotice('Kaynak güncellendi.');await load()
    }catch(e){setEditError(errorMessage(e))}finally{setBusy(null)}
  }
  async function remove(item:EditableSource){
    setBusy(item.source.id);setError('');setNotice('')
    try{
      await workspaceRequest(`${item.kind==='connector'?'sources':'managed-sources'}/${item.source.id}`,{method:'DELETE'})
      setNotice('Kaynak silindi. Geçmiş rapor ve kayıtlar korundu.');await load()
    }catch(e){setError(errorMessage(e))}finally{setBusy(null)}
  }
  function managementActions(item:EditableSource){
    const name=item.kind==='connector'?item.source.name:item.source.title
    return <Space size={4}><Button type="text" size="small" icon={<EditOutlined/>} title="Düzenle" disabled={!!busy} onClick={()=>edit(item)} aria-label={`${name} kaynağını düzenle`}/><Popconfirm title="Kaynak silinsin mi?" description={`${name} listeden kaldırılır ve yeni taramalarda kullanılmaz. Geçmiş rapor ve kayıtlar korunur.`} okText="Sil" cancelText="Vazgeç" okButtonProps={{danger:true}} onConfirm={()=>remove(item)}><Button type="text" size="small" icon={<DeleteOutlined/>} title="Sil" danger disabled={!!busy} aria-label={`${name} kaynağını sil`}/></Popconfirm></Space>
  }
  function chooseFile(candidate:File|undefined){
    if(!candidate)return
    if(!/\.(pdf|docx|xlsx|csv|txt|png|jpe?g|webp)$/i.test(candidate.name)){setError('Bu dosya türü desteklenmiyor. PDF, Word, Excel, CSV, metin veya görsel seçin.');return}
    if(!candidate.size){setError('Boş dosya eklenemez.');return}
    if(candidate.size>20*1024*1024){setError('Dosya 20 MB sınırını aşıyor. Daha küçük bir belge seçin.');return}
    setError('');setFile(candidate)
    if(!form.getFieldValue('name'))form.setFieldValue('name',candidate.name.replace(/\.[^.]+$/,''))
  }
  const matches=(...values:string[])=>values.join(' ').toLocaleLowerCase('tr-TR').includes(query.trim().toLocaleLowerCase('tr-TR'))
  const visibleSources=sources.filter(s=>matches(s.name,s.baseUrl)),visibleExtras=extras.filter(s=>matches(s.title,s.url)),visibleDocuments=documents.filter(d=>matches(d.title))
  const connected=sources.filter(s=>s.profiles?.[0]?.status==='VERIFIED').length
  const attention=sources.filter(s=>s.profiles?.[0]?.status==='NEEDS_REVIEW').length
  async function add(){
    const values=await form.validateFields().catch(()=>null);if(!values)return
    if(kind==='FILE'&&!file){setError('Bir dosya seçin.');return}
    if(kind==='FILE'&&file&&file.size>20*1024*1024){setError('Dosya 20 MB sınırını aşıyor. Daha küçük bir belge seçin.');return}
    setBusy('new');setError('')
    try{
      if(kind==='WEB')await workspaceRequest('connectors',{method:'POST',body:JSON.stringify({name:values.name,url:values.url})})
      else if(kind==='URL')await workspaceRequest('documents/imports',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({kind:'URL',title:values.name,url:values.url,originalOnly:'true'})})
      else{
        const data=new FormData();data.append('title',values.name);data.append('originalOnly','true');data.append('file',file!)
        const response=await apiFetch('/api/v1/documents/uploads',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:data})
        if(!response.ok)throw new Error((await response.json()).message??'Dosya eklenemedi.')
      }
      setOpen(false);form.resetFields();setFile(null);setNotice(kind==='WEB'?'Kaynak kaydedildi. Arka planda bağlantı kuruluyor.':'Özgün belge arşive eklendi.');await load()
    }catch(e){setError(errorMessage(e))}finally{setBusy(null)}
  }
  return <div className="atez-demo-page connectors-page">
    <header className="connector-heading"><div><Typography.Title level={1}>Kaynaklar</Typography.Title><p>Bağlantılarınızı ve belgelerinizi yönetin.</p></div><div className="connector-header-actions"><Input className="connector-search" aria-label="Kaynaklarda ara" prefix={<SearchOutlined/>} placeholder="Kaynak veya belge ara" value={query} onChange={e=>setQuery(e.target.value)} allowClear/><Can permission="config.manage"><Button type="primary" size="large" icon={<PlusOutlined/>} onClick={()=>{setError('');setOpen(true)}}>Kaynak ekle</Button></Can></div></header>
    {error&&!open&&<Alert type="error" title={error} closable onClose={()=>setError('')}/>}{notice&&<Alert type="info" title={notice} closable onClose={()=>setNotice('')}/>}
    <div className="connector-toolbar"><div className="connector-counts"><span><i className="status-dot good"/>{connected} bağlı</span><span>{documents.length} belge</span>{attention>0&&<span className="attention-count">{attention} kontrol bekliyor</span>}</div></div>
    <Spin spinning={loading}>
      {(visibleSources.length>0||visibleExtras.length>0)&&<section className="connector-section" aria-label="Web bağlantıları"><div className="connector-section-heading"><h2>Web bağlantıları <span>{visibleSources.length+visibleExtras.length}</span></h2><p>Bağlantı durumunu kontrol edin, güncel kalın.</p></div><div className="connector-list"><div className="connector-column-head" aria-hidden="true"><span>Kaynak</span><span>Tür</span><span>Durum</span><span/></div>
      {visibleSources.map(source=>{const profile=source.profiles?.[0],status=profile?.status??'DRAFT';return <article key={source.id} className="connector-row">
        <SourceIcon url={source.baseUrl} sourceKey={source.key}/>
        <div className="connector-identity"><h3>{source.name||source.key}</h3><a href={source.baseUrl} target="_blank" rel="noreferrer">{source.baseUrl.replace(/^https?:\/\//,'').replace(/\/$/,'')}</a>{status==='NEEDS_REVIEW'&&<p className="connector-error-summary">{cleanMessage(profile?.validation?.message??'Bağlantı doğrulanamadı.')}</p>}</div>
        <span className="connector-kind">Web{source.key==='tariff'&&<small>API</small>}</span><div className="connector-health">{status==='NEEDS_REVIEW'?<button className="connector-status warning" onClick={()=>setIssue(source)}><i className="status-dot"/>Kontrol gerekli · Ayrıntılar <ArrowRightOutlined aria-hidden="true"/></button>:<span className={`connector-status ${status==='VERIFIED'?'good':''}`}><i className="status-dot"/>{labels[status]??'Kontrol gerekli'}</span>}<small>{profile?.verifiedAt?`Son test · ${new Date(profile.verifiedAt).toLocaleDateString('tr-TR')}`:busyStatus(status)?'Sonuç otomatik güncellenir':'İlk bağlantı kontrolü bekleniyor'}</small></div>
        <Can permission="config.manage"><Space className="connector-actions" size={8}><Button className="connector-test" loading={busy===source.id||busyStatus(status)} onClick={()=>{if(['tariff','mevzuat-net'].includes(source.key)){accountForm.resetFields();setAccount(source)}else void test(source.id,`connectors/${source.id}/test`)}}>Test et</Button>{managementActions({kind:'connector',source})}</Space></Can>
      </article>})}
      {visibleExtras.map(source=><article key={`extra-${source.id}`} className="connector-row"><SourceIcon url={source.url}/><div className="connector-identity"><h3>{source.title}</h3><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>{source.fetchError&&<p className="connector-error-summary">{cleanMessage(source.fetchError)}</p>}</div><span className="connector-kind">Web <small>Ek kaynak</small></span><span className={`connector-status ${source.fetchError?'warning':'good'}`}><i className="status-dot"/>{source.fetchError?'Kontrol gerekli':source.fetchedAt?'İçerik alındı':'Test bekliyor'}</span><Can permission="config.manage"><Space className="connector-actions" size={8}><Button className="connector-test" loading={busy===source.id} onClick={()=>void test(source.id,`managed-sources/${source.id}/refresh`)}>Test et</Button>{managementActions({kind:'extra',source})}</Space></Can></article>)}
      </div></section>}
      {visibleDocuments.length>0&&<section className="connector-section" aria-label="Belgeler"><div className="connector-section-heading"><h2>Belgeler <span>{visibleDocuments.length}</span></h2><p>Eklediğiniz dosyaların özgün kopyaları burada saklanır.</p></div><div className="connector-list"><div className="connector-column-head" aria-hidden="true"><span>Kaynak</span><span>Tür</span><span>Durum</span><span/></div>{visibleDocuments.map(doc=><article key={doc.id} className="connector-row"><div className="connector-mark document-mark"><FileTextOutlined/></div><div className="connector-identity"><h3>{doc.title}</h3><p>{fileLabel(doc.latestVersion?.mimeType)} <span>·</span> {doc.canonicalUrl?'Bağlantıdan eklendi':'Yüklenen dosya'}</p></div><span className="connector-kind">{fileLabel(doc.latestVersion?.mimeType)}</span><div className="connector-health"><span className={`connector-status ${doc.latestVersion?.extractionStatus==='FAILED'?'warning':''}`}><i className="status-dot"/>{doc.latestVersion?.extractionStatus==='FAILED'?'İçerik kontrolü gerekli':'Arşivde'}</span><small>Özgün dosya saklanıyor</small></div><Can permission="document.upload"><Button className="connector-test" loading={busy===doc.id} onClick={()=>void test(doc.id,`documents/${doc.id}/test`)}>Test et</Button></Can></article>)}</div></section>}
      {!loading&&catalogLoaded&&!visibleSources.length&&!visibleDocuments.length&&!visibleExtras.length&&<div className="connector-empty"><Empty description={query?'Aramanızla eşleşen kaynak bulunamadı.':'Henüz kaynak eklenmedi.'}/></div>}
    </Spin>
    <p className="connector-footnote"><SafetyCertificateOutlined/> Bağlantı testi erişimi doğrular. Belge analizi ayrı olarak yapılır.</p>
    <Modal title="Kaynağı düzenle" open={!!editing} onCancel={()=>{if(busy!=='edit')setEditing(null)}} onOk={()=>void saveEdit()} okText="Kaydet" cancelText="Vazgeç" confirmLoading={busy==='edit'} cancelButtonProps={{disabled:busy==='edit'}} closable={busy!=='edit'} mask={{closable:busy!=='edit'}}>
      <Form form={editForm} layout="vertical" disabled={busy==='edit'}>
        <Form.Item name="name" label="Kaynak adı" rules={[{required:true,whitespace:true,max:200,message:'Kaynak adını girin (en fazla 200 karakter).'}]}><Input/></Form.Item>
        <Form.Item name="url" label="Kaynak bağlantısı" rules={[{required:true,type:'url',message:'Geçerli bir bağlantı girin.'},{validator:(_,value)=>!value||/^https?:\/\//i.test(value)?Promise.resolve():Promise.reject(new Error('HTTP veya HTTPS bağlantısı girin.'))}]}><Input/></Form.Item>
      </Form>
      {editError&&<Alert type="error" title={editError} showIcon/>}
    </Modal>
    <Modal title={`${issue?.name??'Kaynak'} · Bağlantı sorunu`} open={!!issue} onCancel={()=>setIssue(null)} footer={<Button onClick={()=>setIssue(null)}>Kapat</Button>}>
      <Alert type="warning" showIcon title={cleanMessage(issue?.profiles[0]?.validation?.message??'Bağlantı doğrulanamadı.')} />
      <Typography.Title level={5}>Ne yapabilirim?</Typography.Title>
      <Typography.Paragraph>{recoveryHint(issue?.profiles[0]?.validation?.message??'')}</Typography.Paragraph>
      {issue&&<Typography.Paragraph><a href={issue.baseUrl} target="_blank" rel="noreferrer">Kaynağı tarayıcıda aç</a></Typography.Paragraph>}
      {issue?.profiles[0]?.validation?.checkedAt&&<Typography.Paragraph type="secondary">Son deneme: {new Date(issue.profiles[0].validation.checkedAt).toLocaleString('tr-TR')}</Typography.Paragraph>}
      <details><summary>Teknik hata ayrıntısı</summary><Typography.Paragraph>{issue?.profiles[0]?.validation?.message}</Typography.Paragraph></details>
    </Modal>
    <Modal className="connector-add-modal" width={640} cancelText="Vazgeç" title={<div className="connector-modal-title"><span className="connector-eyebrow">KAYNAK KÜTÜPHANESİ</span><h2>Yeni bir kaynak ekleyin</h2><p>Bir siteye bağlanın veya kendi belgenizle başlayın.</p></div>} open={open} onCancel={()=>{if(!busy)setOpen(false)}} onOk={()=>void add()} okText={busy==='new'?(kind==='FILE'?'Dosya yükleniyor…':'Kaynak ekleniyor…'):kind==='WEB'?'Bağlantıyı kur':'Belgeyi ekle'} confirmLoading={busy==='new'} cancelButtonProps={{disabled:busy==='new'}} closable={busy!=='new'} mask={{closable:busy!=='new'}} destroyOnHidden>
      <div className="connector-type-picker" role="group" aria-label="Kaynak türü">{[{value:'WEB',label:'Web sitesi',icon:<GlobalOutlined/>},{value:'URL',label:'Belge bağlantısı',icon:<LinkOutlined/>},{value:'FILE',label:'Yerel dosya',icon:<CloudUploadOutlined/>}].map(option=><button type="button" key={option.value} aria-pressed={kind===option.value} disabled={busy==='new'} onClick={()=>{setKind(option.value);setError('')}}>{option.icon}<span>{option.label}</span></button>)}</div>
      <Form form={form} layout="vertical" disabled={busy==='new'}>
        {kind==='FILE'?<div className="connector-upload">
          <input ref={fileInput} hidden aria-label="Belge" type="file" accept=".pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp" disabled={busy==='new'} onChange={e=>{chooseFile(e.target.files?.[0]);e.target.value=''}}/>
          <button type="button" className={`connector-dropzone ${dragging?'is-dragging':''}`} disabled={busy==='new'} onClick={()=>fileInput.current?.click()} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(busy==='new')return;if(e.dataTransfer.files.length>1){setError('Her seferinde bir belge ekleyin.');return}chooseFile(e.dataTransfer.files[0])}}><span className="dropzone-icon"><CloudUploadOutlined/></span><strong>{dragging?'Dosyayı buraya bırakın':file?'Başka bir dosya seçin':'Belgenizi buraya sürükleyin'}</strong><span>veya <em>dosyalara göz atın</em></span><small>PDF, Word, Excel, CSV, TXT ve görseller · En fazla 20 MB</small></button>
          {file&&<div className="connector-selected-file"><FileTextOutlined/><div><strong>{file.name}</strong><span>{file.size<1024*1024?`${Math.ceil(file.size/1024)} KB`:`${(file.size/1024/1024).toFixed(1)} MB`} · {busy==='new'?'Yükleniyor':'Yüklemeye hazır'}</span></div><CheckOutlined className="file-ready"/><Button type="text" aria-label="Dosyayı kaldır" icon={<CloseOutlined/>} disabled={busy==='new'} onClick={()=>setFile(null)}/></div>}
        </div>:<Form.Item name="url" label={kind==='WEB'?'Web sitesi adresi':'Belge bağlantısı'} rules={[{required:true,type:'url',message:'Geçerli bir bağlantı girin.'}]} extra={kind==='WEB'?'Takip etmek istediğiniz sitenin veya duyuru sayfasının adresi.':'PDF, belge veya içerik sayfasının doğrudan bağlantısı.'}><Input size="large" prefix={<LinkOutlined/>} placeholder={kind==='WEB'?'https://www.ornek.gov.tr':'https://ornek.gov.tr/belge.pdf'} aria-label="Kaynak bağlantısı"/></Form.Item>}
        <Form.Item name="name" label="Kaynak adı" rules={[{required:true,message:'Kaynak adını girin.'}]}><Input size="large" placeholder={kind==='FILE'?'Belgenize bir ad verin':'Örn. Ticaret Bakanlığı'} /></Form.Item>
      </Form>
      {error&&<Alert type="error" title={error} showIcon/>}
      <div className="connector-setup-note"><SafetyCertificateOutlined/><p>{kind==='WEB'?'Bağlantıyı kurduğunuzda erişim arka planda kontrol edilir. Sonucu kaynak listenizde takip edebilirsiniz.':'Dosyanız özgün biçimiyle saklanır. İçerik analizi ve rapor oluşturma ayrı adımlardır.'}</p></div>
    </Modal>
    <Modal cancelText="Vazgeç" title={`${account?.name} · Bağlantı testi`} open={!!account} onCancel={()=>setAccount(null)} okText="Test et" confirmLoading={!!busy} onOk={()=>void accountForm.validateFields().then(async values=>{if(account){await test(account.id,`connectors/${account.id}/test`,values.username||values.password?values:undefined);setAccount(null)}})}><Typography.Paragraph>Kayıtlı hesapla test etmek için alanları boş bırakın. Hesabı değiştirmek için iki alanı da doldurun.</Typography.Paragraph><Form form={accountForm} layout="vertical"><Form.Item name="username" label="Kullanıcı adı"><Input autoComplete="username"/></Form.Item><Form.Item name="password" label="Parola"><Input.Password autoComplete="new-password"/></Form.Item></Form></Modal>
  </div>
}
