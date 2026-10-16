import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Drawer, Empty, Input, Modal, Pagination, Select, Spin, Typography } from 'antd'
import { DownloadOutlined, ExportOutlined, FilterOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons'
import { Can } from '../auth/Can'
import { listDocuments, uploadDocument, type ArchiveDocument } from './api'
import './documents.css'

function sourceUrl(value?: string | null) {
  try { const url = new URL(value ?? ''); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null }
}
function dateLabel(value?: string | null) {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }) : 'Belirtilmemiş'
}
function format(doc: ArchiveDocument) {
  const filename=doc.latestVersion?.originalFilename || (sourceUrl(doc.canonicalUrl) ? new URL(doc.canonicalUrl!).pathname : '')
  const extension=filename.match(/\.(pdf|html?|docx?|xlsx?|csv|txt|png|jpe?g|gif|webp|zip)$/i)?.[1]
  if(extension)return extension.toUpperCase()
  const mime = doc.latestVersion?.mimeType ?? ''
  return ({ 'application/pdf': 'PDF', 'text/html': 'HTML', 'text/plain': 'TXT', 'text/csv': 'CSV', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX' } as Record<string,string>)[mime] ?? (mime.startsWith('image/') ? mime.slice(6).toUpperCase() : 'Belge')
}
function originLabel(doc: ArchiveDocument) { if(doc.source) return doc.source.name || (sourceUrl(doc.source.baseUrl) ? new URL(doc.source.baseUrl).hostname : doc.source.key); const url=sourceUrl(doc.canonicalUrl); if(url)return new URL(url).hostname.replace(/^www\./,''); return doc.origin === 'SOURCE' ? 'Web kaynağı' : doc.origin === 'USER_TEXT' ? 'Eklenen metin' : 'Yüklenen belge' }
export function DocumentsPage() {
  const [documents,setDocuments] = useState<ArchiveDocument[]>([])
  const [page,setPage] = useState(1), [total,setTotal] = useState(0)
  const [query,setQuery] = useState(''), [search,setSearch] = useState('')
  const [from,setFrom] = useState(''), [to,setTo] = useState(''), [origin,setOrigin] = useState('')
  const [sourceId,setSourceId] = useState(''), [sort,setSort] = useState('OLDEST')
  const [sources,setSources] = useState<Array<{id:string;name:string|null;key:string;baseUrl:string}>>([])
  const [classification,setClassification] = useState('IN')
  const [filtersOpen,setFiltersOpen] = useState(false), [reload,setReload] = useState(0)
  const [loading,setLoading] = useState(true), [loaded,setLoaded] = useState(false), [error,setError] = useState<string|null>(null)
  const [detail,setDetail] = useState<ArchiveDocument|null>(null)
  const [uploadOpen,setUploadOpen] = useState(false), [selectedFile,setSelectedFile] = useState<File|null>(null)
  const [uploading,setUploading] = useState(false), [uploadError,setUploadError] = useState<string|null>(null), [dragging,setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const invalidDates = !!(from && to && from > to)
  const activeFilters = Number(!!from) + Number(!!to) + Number(!!origin) + Number(!!sourceId)
  useEffect(() => {
    if (invalidDates) { setLoading(false); return }
    let current = true
    setLoading(true); setError(null)
    listDocuments(query,{page,limit:30,from,to,origin,classification,sourceId,sort}).then(result => {
      if (current) { setDocuments(result.documents); setSources(result.sources ?? []); setTotal(result.total); setLoaded(true) }
    }).catch(e => { if (current) setError((e as Error).message) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  },[query,page,from,to,origin,classification,sourceId,sort,reload,invalidDates])
  function choose(files: FileList | File[]) {
    if (files.length !== 1) { setUploadError('Her seferinde bir belge ekleyin.'); return }
    const file = files[0]!
    if (!/\.(pdf|docx|xlsx|csv|txt|png|jpe?g|webp)$/i.test(file.name)) { setUploadError('Bu dosya biçimi desteklenmiyor.'); return }
    if (!file.size || file.size > 20*1024*1024) { setUploadError('Boş olmayan, en fazla 20 MB bir dosya seçin.'); return }
    setSelectedFile(file); setUploadError(null)
  }
  async function save() {
    if (!selectedFile) return
    setUploading(true); setUploadError(null)
    try { await uploadDocument(selectedFile,true); setUploadOpen(false); setSelectedFile(null); setPage(1); setReload(value=>value+1) }
    catch(e) { setUploadError((e as Error).message) } finally { setUploading(false) }
  }
  const reset = () => { setFrom(''); setTo(''); setOrigin(''); setSourceId(''); setClassification('ALL'); setQuery(''); setSearch(''); setPage(1) }
  const groups = new Map<string,{label:string;documents:ArchiveDocument[]}>()
  for(const doc of documents){
    const day=doc.publishedOn?.slice(0,10) ?? 'undated'
    const key=`${day}:${doc.source?.id ?? originLabel(doc)}`
    const group=groups.get(key) ?? {label:`${day==='undated'?'Yayın tarihi belirtilmemiş':dateLabel(doc.publishedOn)} · ${originLabel(doc)}`,documents:[]}
    group.documents.push(doc);groups.set(key,group)
  }
  return <div className="atez-page-stack document-library">
    <header className="document-library-heading"><div><Typography.Title level={2}>Belgeler</Typography.Title><p>Kaynaklardan gelen ve eklediğiniz belgeler, tek bir arşivde.</p></div><Can permission="document.upload"><Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={()=>{setUploadError(null);setUploadOpen(true)}}>Belge ekle</Button></Can></header>
    <div className="document-library-toolbar"><Input.Search aria-label="Belge ara" placeholder="Belgelerde ara…" prefix={<SearchOutlined aria-hidden />} value={search} onChange={e=>{setSearch(e.target.value);if(!e.target.value){setQuery('');setPage(1)}}} allowClear onSearch={value=>{setQuery(value.trim());setPage(1)}} /><Select className="document-scope-select" aria-label="Kapsam filtresi" value={classification} onChange={value=>{setClassification(value);setPage(1)}} options={[{value:'IN',label:'IN · Kapsamda'},{value:'ALL',label:'Tüm belgeler'},{value:'OUT',label:'OUT · Kapsam dışı'},{value:'MAYBE',label:'Kontrol gerekli'},{value:'UNREVIEWED',label:'Değerlendirilmemiş'}]} /><Select className="document-sort-select" aria-label="Belge sıralaması" value={sort} onChange={value=>{setSort(value);setPage(1)}} options={[{value:'OLDEST',label:'Tarih · Eski → yeni'},{value:'NEWEST',label:'Tarih · Yeni → eski'}]} /><Button icon={<FilterOutlined aria-hidden />} aria-expanded={filtersOpen} aria-controls="document-filters" onClick={()=>setFiltersOpen(value=>!value)}>Filtreler{activeFilters ? ` · ${activeFilters}` : ''}</Button><Button icon={<ReloadOutlined aria-hidden />} aria-label="Arşivi yenile" loading={loading} onClick={()=>setReload(value=>value+1)} /></div>
    {filtersOpen && <section id="document-filters" className="document-library-filters" aria-label="Belge filtreleri"><label>Web kaynağı<Select aria-label="Web kaynağı" value={sourceId} onChange={value=>{setSourceId(value);setPage(1)}} options={[{value:'',label:'Tüm web kaynakları'},...sources.map(source=>({value:source.id,label:source.name || source.key}))]} /></label><label>Belge türü<Select aria-label="Belge türü" value={origin} onChange={value=>{setOrigin(value);setPage(1)}} options={[{value:'',label:'Tüm belgeler'},{value:'SOURCE',label:'Web kaynakları'},{value:'UPLOAD',label:'Yüklenen belgeler'},{value:'USER_TEXT',label:'Eklenen metinler'}]} /></label><label>Yayın başlangıcı<Input aria-label="Yayın başlangıcı" type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1)}} /></label><label>Yayın bitişi<Input aria-label="Yayın bitişi" type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1)}} /></label><Button type="text" onClick={reset}>Temizle</Button><small>Yayın tarihi filtreleri, tarihi belirtilmiş belgelerde uygulanır.</small></section>}
    {invalidDates && <Alert type="warning" title="Başlangıç tarihi bitiş tarihinden sonra olamaz." showIcon />}
    {error && <Alert type="error" title={error} showIcon action={<Button onClick={()=>setReload(value=>value+1)}>Tekrar dene</Button>} />}
    <div className="document-library-caption"><span>{loaded ? `${total} belge` : 'Belge arşivi'}{query || activeFilters || classification!=='ALL' ? ' · Filtrelenmiş sonuçlar' : ''}</span>{(query || activeFilters > 0 || classification!=='ALL') && <Button type="link" size="small" onClick={reset}>Tüm belgeleri göster</Button>}</div>
    <Spin spinning={loading}><section className="document-library-list" aria-label="Belge arşivi" aria-busy={loading}>
      <div className="document-library-columns"><span>Belge</span><span>Uzantı</span><span>Kapsam</span><span /></div>
      {!error && !invalidDates && [...groups.entries()].map(([key,group])=><section className="document-library-group" key={key} aria-label={group.label}>
        <h3>{group.label}<small>{group.documents.length} belge · bu sayfada</small></h3>
        {group.documents.map(doc=><article className="document-library-row" key={doc.id}>
          <button className="document-library-identity" onClick={()=>setDetail(doc)}><strong>{doc.title}</strong></button>
          <span className="document-extension">{format(doc)}</span><span className={`document-classification is-${doc.classification ?? 'UNREVIEWED'}`}>{({IN:'IN',OUT:'OUT',MAYBE:'Kontrol gerekli'} as Record<string,string>)[doc.classification ?? ''] ?? 'Bekliyor'}</span><div className="document-row-actions">{sourceUrl(doc.canonicalUrl) && <Button type="text" size="small" icon={<ExportOutlined aria-hidden />} href={sourceUrl(doc.canonicalUrl)!} target="_blank" rel="noopener noreferrer" aria-label={`${doc.title} kaynağını aç`} title="Kaynağa git" />}<Button type="text" size="small" onClick={()=>setDetail(doc)}>İncele</Button></div>
        </article>)}
      </section>)}
      {loaded && !loading && !error && !invalidDates && !documents.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query || activeFilters || classification!=='ALL' ? 'Bu filtrelere uygun belge bulunamadı. Tüm belgeler görünümüne geçebilirsiniz.' : 'Henüz belge yok. İlk belgenizi ekleyin.'} />}
    </section></Spin>
    <Pagination current={page} pageSize={30} total={total} onChange={setPage} showSizeChanger={false} hideOnSinglePage />
    <Drawer title="Belge ayrıntıları" open={!!detail} onClose={()=>setDetail(null)} size="min(560px, 100vw)" className="document-library-detail">
      {detail && <div className="document-detail-content"><header className="document-detail-heading"><span className="document-library-format">{format(detail)}</span><h2>{detail.title}</h2></header><dl><dt>Kaynak</dt><dd>{originLabel(detail)}</dd><dt>Yayın tarihi</dt><dd>{dateLabel(detail.publishedOn)}</dd><dt>Arşive eklenme</dt><dd>{dateLabel(detail.latestVersion?.createdAt)}</dd><dt>Dosya adı</dt><dd>{detail.latestVersion?.originalFilename || 'Belirtilmemiş'}</dd><dt>Kayıtlı sürüm</dt><dd>{detail.versions.length || (detail.latestVersion ? 1 : 0)}</dd></dl>
      <div className="document-library-detail-actions">{sourceUrl(detail.canonicalUrl) && <Button icon={<ExportOutlined aria-hidden />} href={sourceUrl(detail.canonicalUrl)!} target="_blank" rel="noopener noreferrer">Kaynağı aç</Button>}{detail.latestVersion?.hasOriginal && <Button icon={<DownloadOutlined aria-hidden />} href={`/api/v1/document-versions/${encodeURIComponent(detail.latestVersion.id)}/original`}>Özgün dosyayı indir</Button>}</div>
      <section className="document-library-note"><h3>İçerik ve analiz</h3><p>Bu görünüm belgenin arşiv bilgilerini gösterir. Ayrıntılı analiz için Sohbetler sayfasında bu belgeyi ekleyebilirsiniz.</p><p>Arşiv kaydı, analiz veya kapsam değerlendirmesinin tamamlandığı anlamına gelmez.</p></section></div>}
    </Drawer>
    <Modal title="Belge ekle" open={uploadOpen} onCancel={()=>{if(!uploading)setUploadOpen(false)}} closable={!uploading} mask={{closable:!uploading}} keyboard={!uploading} okText="Arşive ekle" cancelText="Vazgeç" confirmLoading={uploading} cancelButtonProps={{disabled:uploading}} okButtonProps={{disabled:!selectedFile}} onOk={()=>void save()}>
      <p className="document-library-upload-description">Özgün dosyanız arşivlenir. Analiz için daha sonra sohbetinize ekleyebilirsiniz.</p>
      <input hidden ref={input} type="file" aria-label="Arşive belge yükle" accept=".pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp" disabled={uploading} onChange={e=>{if(e.target.files?.length)choose(e.target.files);e.target.value=''}} />
      <button type="button" disabled={uploading} className={`document-library-drop ${dragging?'is-dragging':''}`} onClick={()=>input.current?.click()} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(!uploading)choose(e.dataTransfer.files)}}><UploadOutlined aria-hidden /><strong>{selectedFile ? selectedFile.name : 'Belgenizi buraya sürükleyin'}</strong><span>{selectedFile ? `${(selectedFile.size/1024/1024).toFixed(2)} MB · Değiştirmek için tıklayın` : 'veya dosya seçmek için tıklayın'}</span><small>PDF, Word, Excel, CSV, metin ve görsel · En fazla 20 MB</small></button>
      {uploadError && <Alert showIcon type="error" title={uploadError} />}
    </Modal>
  </div>
}
