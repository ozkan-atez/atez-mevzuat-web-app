import { Can } from '../auth/Can'
import { useCan } from '../auth/AuthProvider'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Checkbox, Empty, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd'
import { ExportOutlined, FileTextOutlined, LinkOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { getDocumentContent, importDocument, documentStatusLabel, listDocuments, uploadDocument, type ArchiveDocument } from './api'
import { AnalysisInputs, resolveDocumentRoles, type DocumentRole } from './AnalysisInputs'
import { AttachmentList } from './AttachmentList'
import { OperationModeSelect, type OperationMode } from '../operations/OperationModeSelect'
import { startOperation, type OperationInput, type OperationRequest } from '../operations/api'
import { OperationTaskCard } from '../operations/OperationTaskCard'
import './documents.css'
function documentSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null } catch { return null }
}

export function DocumentsPage() {
  const canAnalyze=useCan('analysis.run')
  const [documents, setDocuments] = useState<ArchiveDocument[]>([])
  const [page,setPage] = useState(1)
  const [total,setTotal] = useState(0)
  const [query,setQuery] = useState('')
  const [from,setFrom] = useState('')
  const [to,setTo] = useState('')
  const [knownTitles,setKnownTitles] = useState<Record<string,string>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [mode, setMode] = useState<OperationMode>('REUSE_ONLY')
  const [operation, setOperation] = useState<OperationInput['operation']>('EXTRACT')
  const [code, setCode] = useState('')
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  const [previousDate, setPreviousDate] = useState('')
  const [origin, setOrigin] = useState('')
  const [instruction, setInstruction] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roles, setRoles] = useState<Record<string,DocumentRole>>({})
  const [evidenceTaskIds,setEvidenceTaskIds] = useState<string[]>([])
  const [completedOperations,setCompletedOperations] = useState<OperationRequest[]>([])
  const [requestId, setRequestId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ title: string; text: string } | null>(null)
  const [textOpen, setTextOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [importKind, setImportKind] = useState<'TEXT' | 'URL'>('TEXT')
  const file = useRef<HTMLInputElement>(null)
  const refresh = async () => { setLoading(true); try { const result=await listDocuments(query,{page,limit:30,from,to}); setDocuments(result.documents); setTotal(result.total); setKnownTitles(current=>({...current,...Object.fromEntries(result.documents.filter(doc=>doc.latestVersion).map(doc=>[doc.latestVersion!.id,doc.title]))})); setError(null) } catch (e) { setError((e as Error).message) } finally { setLoading(false) } }
  useEffect(() => { void refresh() }, [page,query,from,to])
  const execute = async (work: () => Promise<unknown>) => { setLoading(true); setError(null); try { await work() } catch (e) { setError((e as Error).message) } finally { setLoading(false) } }
  const sourceLabel = (doc: ArchiveDocument) => doc.origin === 'UPLOAD' || doc.origin === 'USER_TEXT' ? 'Kullanıcı belgesi' : 'Kaynak belgesi'
  const statusTag = (doc: ArchiveDocument) => <Tag color={['READY', 'EXTRACTED'].includes(doc.latestVersion?.extractionStatus ?? '') ? 'success' : doc.latestVersion?.extractionStatus === 'FAILED' ? 'error' : 'warning'}>{documentStatusLabel(doc.latestVersion?.extractionStatus)}</Tag>
  const openDocument = (doc: ArchiveDocument) => {
    const sourceUrl = documentSourceUrl(doc.canonicalUrl)
    return sourceUrl ? <Button size="small" href={sourceUrl} target="_blank" rel="noopener noreferrer" icon={<ExportOutlined aria-hidden />} title={sourceUrl}>Kaynağı aç</Button> : <Button size="small" disabled={!doc.latestVersion} onClick={() => void execute(async () => { const result = await getDocumentContent(doc.latestVersion!.id); setPreview({ title: doc.title, text: result.text ?? 'Bu belge için okunabilir metin henüz yok.' }) })}>Metni incele</Button>
  }
  return <div className="atez-page-stack atez-documents-page">
    <div className="atez-page-heading">
      <div><Typography.Title level={2}>Belgeler</Typography.Title><Typography.Text type="secondary">Belgelerinizi arşivleyin, inceleyin ve seçerek işleyin.</Typography.Text></div>
      <Space wrap className="atez-document-add-actions">
        <input hidden ref={file} aria-label="Arşive belge yükle" type="file" onChange={event => { const current = event.target.files?.[0]; if (current) void execute(async () => { await uploadDocument(current); await refresh(); if (file.current) file.current.value = '' }) }} />
        <Can permission="document.upload"><Button icon={<FileTextOutlined />} onClick={() => { setImportKind('TEXT'); setTextOpen(true) }}>Metin ekle</Button></Can>
        <Can permission="document.upload"><Button icon={<LinkOutlined />} onClick={() => { setImportKind('URL'); setTextOpen(true) }}>Bağlantıdan ekle</Button></Can>
        <Can permission="document.upload"><Button type="primary" icon={<UploadOutlined />} loading={loading} onClick={() => file.current?.click()}>Belge yükle</Button></Can>
      </Space>
    </div>
    {error && <Alert type="error" showIcon title={error} />}
    {canAnalyze && <Card className="atez-surface-card atez-document-operation" title="Seçili belgelerle işlem"><Typography.Paragraph type="secondary">Belge eklemek analiz başlatmaz. Seçili belgeler için işlem adımını belirleyip ayrıca başlatabilirsiniz.</Typography.Paragraph><Space orientation="vertical" style={{ width: '100%' }}><AttachmentList items={selected.map(id => ({ id, title: knownTitles[id] ?? id }))} onRemove={id => setSelected(current => current.filter(item => item !== id))} /><Select aria-label="İşlem adımı" value={operation} onChange={setOperation} options={[{ value: 'EXTRACT', label: 'Belgeden metin çıkar' }, { value: 'ANALYZE', label: 'Belgeleri analiz et' }, { value: 'FILTER', label: 'Belgeleri kapsam için filtrele' }, { value: 'PREVIOUS_SOURCES', label: 'Önceki düzenleme kaynaklarını bul' }, { value: 'TARIFF_LOOKUP', label: 'GTİP tarife sorgula' }]} />{operation === 'PREVIOUS_SOURCES' && <Input type="date" aria-label="Önceki kaynak son tarihi" value={date} onChange={e => setDate(e.target.value)} style={{maxWidth:220}} />}{operation === 'TARIFF_LOOKUP' && <Space wrap><Input aria-label="GTİP kodu" placeholder="GTİP kodu" value={code} onChange={e => setCode(e.target.value)} /><Input type="date" aria-label="Tarife tarihi" value={date} onChange={e => setDate(e.target.value)} /><Input type="date" aria-label="Karşılaştırma tarihi" value={previousDate} onChange={e => setPreviousDate(e.target.value)} /><Input aria-label="Menşe" placeholder="Menşe (isteğe bağlı)" value={origin} onChange={e => setOrigin(e.target.value)} /></Space>}{operation === 'ANALYZE' && <AnalysisInputs documents={selected.map(id=>({id,title:knownTitles[id]??id}))} roles={roles} onRolesChange={setRoles} evidenceTasks={completedOperations.flatMap(request=>request.tasks)} evidenceTaskIds={evidenceTaskIds} onEvidenceChange={setEvidenceTaskIds} />}<OperationModeSelect value={mode} onChange={setMode} /><Input.TextArea aria-label="Analiz isteği" placeholder="Analizde odaklanılacak konu (isteğe bağlı)" value={instruction} onChange={e => setInstruction(e.target.value)} /><Button type="primary" loading={loading} disabled={operation === 'TARIFF_LOOKUP' ? !code.trim() || !date : selected.length === 0} onClick={() => void execute(async () => { const request = await startOperation({ operation, mode, documentVersionIds: operation === 'TARIFF_LOOKUP' ? [] : selected, ...(operation === 'ANALYZE' ? {documentRoles:resolveDocumentRoles(selected.map(id=>({id,title:id})),roles),...(evidenceTaskIds.length?{evidenceTaskIds}:{})} : {}), ...(operation === 'PREVIOUS_SOURCES' ? {date} : {}), ...(operation === 'TARIFF_LOOKUP' ? { code: code.trim(), date, ...(previousDate ? { previousDate } : {}), ...(origin.trim() ? { origin: origin.trim() } : {}) } : {}), ...(instruction.trim() ? { instruction: instruction.trim() } : {}) }); setRequestId(request.id) })}>İşlemi başlat</Button></Space></Card>}
    {requestId && <OperationTaskCard requestId={requestId} onUpdated={updated=>setCompletedOperations(current=>[...current.filter(request=>request.id!==updated.id),updated])} />}
    <Card className="atez-surface-card atez-document-archive">
      <div className="atez-document-archive-heading">
        <div><Typography.Title level={4}>Belge arşivi</Typography.Title><Typography.Text type="secondary">{total} belge{query || from || to ? ' · Filtrelenmiş sonuçlar' : ''}</Typography.Text></div>
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading}>Yenile</Button>
      </div>
      <div className="atez-document-filters">
        <label className="atez-document-search"><span>Belge ara</span><Input.Search aria-label="Belge ara" placeholder="Başlık veya anahtar kelime" allowClear onSearch={value => { setQuery(value); setPage(1) }} /></label>
        <label><span>Yayın başlangıç tarihi</span><Input type="date" aria-label="Belge yayın başlangıç tarihi" value={from} onChange={event => { setFrom(event.target.value); setPage(1) }} /></label>
        <label><span>Yayın bitiş tarihi</span><Input type="date" aria-label="Belge yayın bitiş tarihi" value={to} onChange={event => { setTo(event.target.value); setPage(1) }} /></label>
      </div>
      <div className="atez-document-selection-bar">
        <Typography.Text type="secondary">{selected.length ? `${selected.length} belge seçildi` : 'İşlem yapmak için listeden belge seçin.'}<span className="atez-document-selection-limit"> · En fazla 10 belge</span></Typography.Text>
        {selected.length > 0 && <Button type="text" size="small" onClick={() => setSelected([])}>Seçimi temizle</Button>}
      </div>
      <Table<ArchiveDocument>
        rowKey="id"
        className="atez-document-table"
        dataSource={documents}
        loading={loading}
        tableLayout="fixed"
        rowClassName={doc => selected.includes(doc.latestVersion?.id ?? '') ? 'atez-document-row-selected' : ''}
        pagination={{ current: page, pageSize: 30, total, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true, showTotal: count => `${count} belge` }}
        locale={{ emptyText: <Empty description={query || from || to ? 'Bu filtrelere uygun belge bulunamadı.' : 'Henüz belge yok. Belge yükleyerek arşivinizi oluşturun.'} /> }}
        columns={[
          { title: '', key: 'select', width: 44, render: (_value, doc) => <Checkbox aria-label={doc.title} checked={selected.includes(doc.latestVersion?.id ?? '')} disabled={!doc.latestVersion || (selected.length >= 10 && !selected.includes(doc.latestVersion.id))} onChange={event => { const id = doc.latestVersion!.id; setSelected(current => event.target.checked ? [...current, id] : current.filter(value => value !== id)) }} /> },
          { title: 'Belge', key: 'title', render: (_value, doc) => <div className="atez-document-title"><Typography.Text strong>{doc.title}</Typography.Text><div className="atez-document-mobile-meta"><Typography.Text type="secondary">{sourceLabel(doc)}</Typography.Text>{statusTag(doc)}{openDocument(doc)}</div></div> },
          { title: 'Tür', key: 'origin', width: 155, responsive: ['lg'], render: (_value, doc) => <Tag>{sourceLabel(doc)}</Tag> },
          { title: 'Durum', key: 'status', width: 185, responsive: ['md'], render: (_value, doc) => statusTag(doc) },
          { title: 'İşlemler', key: 'actions', width: 145, align: 'right', responsive: ['md'], render: (_value, doc) => openDocument(doc) },
        ]}
      />
    </Card>
    <Modal title={preview?.title} open={!!preview} onCancel={() => setPreview(null)} footer={null}><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 480, overflowY: 'auto' }}>{preview?.text}</pre></Modal>
    <Modal title={importKind === 'TEXT' ? 'Metin belgesi ekle' : 'Bağlantıdan belge ekle'} open={textOpen} onCancel={() => setTextOpen(false)} confirmLoading={loading} okButtonProps={{ disabled: (importKind === 'TEXT' && !title.trim()) || !text.trim() }} okText="Arşive kaydet" cancelText="Vazgeç" onOk={() => void execute(async () => { await importDocument(importKind === 'TEXT' ? { kind: 'TEXT', title, text } : { kind: 'URL', url: text.trim(), ...(title.trim() ? { title: title.trim() } : {}) }); setTextOpen(false); setText(''); setTitle(''); await refresh() })}><Space orientation="vertical" style={{ width: '100%' }}><Input aria-label="Belge başlığı" placeholder="Başlık" value={title} onChange={e => setTitle(e.target.value)} />{importKind === 'TEXT' ? <Input.TextArea aria-label="Belge metni" rows={8} value={text} onChange={e => setText(e.target.value)} /> : <Input aria-label="Belge bağlantısı" placeholder="https://…" value={text} onChange={e => setText(e.target.value)} />}<Typography.Text type="secondary">Belge arşive alınır; analiz ayrıca başlatılır.</Typography.Text></Space></Modal>
  </div>
}
