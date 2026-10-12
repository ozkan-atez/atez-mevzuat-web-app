import { Can } from '../auth/Can'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Empty, Input, Modal, Pagination, Space, Spin, Typography } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { listDocuments, uploadDocument, documentStatusLabel, type ArchiveDocument } from './api'
import type { DocumentAttachment } from './AttachmentList'
export function DocumentPicker({ open, onClose, selected, onSelect }: { open: boolean; onClose: () => void; selected: DocumentAttachment[]; onSelect: (items: DocumentAttachment[]) => void }) {
  const [documents, setDocuments] = useState<ArchiveDocument[]>([])
  const [chosen, setChosen] = useState<DocumentAttachment[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page,setPage] = useState(1)
  const [total,setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) setChosen(selected) }, [open, selected])
  useEffect(() => {
    if (!open) return
    let disposed = false; setLoading(true); setError(null)
    listDocuments(query,{page,limit:30}).then(result => { if (!disposed) {setDocuments(result.documents);setTotal(result.total)} }).catch(e => { if (!disposed) setError(e.message) }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [open, query, page])
  const upload = async (file: File) => {
    setUploading(true); setError(null)
    try {
      const result = await uploadDocument(file)
      setDocuments(current => [{ ...result.document, latestVersion: result.version }, ...current.filter(doc => doc.id !== result.document.id)])
      setChosen(current => current.length < 10 ? [...current.filter(item => item.id !== result.version.id), { id: result.version.id, title: result.document.title }] : current)
    } catch (e) { setError(e instanceof Error ? e.message : 'Belge yüklenemedi.') } finally { setUploading(false); if (input.current) input.current.value = '' }
  }
  return <Modal title="Belge ekle" open={open} onCancel={onClose} onOk={() => { onSelect(chosen); onClose() }} okText="Seçilenleri ekle" cancelText="Vazgeç" confirmLoading={uploading}>
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Typography.Paragraph type="secondary">Yükleme belgeyi arşive kaydeder. Analiz için belgenizi seçip isteğinizi ayrıca gönderin. En fazla 10 belge seçebilirsiniz.</Typography.Paragraph>
      <input hidden ref={input} type="file" aria-label="Yüklenecek belge" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
      <Can permission="document.upload"><Button icon={<UploadOutlined />} loading={uploading} onClick={() => input.current?.click()}>Bilgisayardan yükle</Button></Can>
      <Input.Search aria-label="Arşivde belge ara" placeholder="Arşivde ara" onSearch={value=>{setQuery(value);setPage(1)}} allowClear />
      {error && <Alert type="error" title={error} showIcon />}
      <Spin spinning={loading}><Space orientation="vertical" style={{ width: '100%', maxHeight: 320, overflowY: 'auto' }}>{documents.map(doc => doc.latestVersion && <Checkbox key={doc.id} checked={chosen.some(item => item.id === doc.latestVersion!.id)} disabled={chosen.length >= 10 && !chosen.some(item => item.id === doc.latestVersion!.id)} onChange={event => setChosen(current => event.target.checked ? [...current, { id: doc.latestVersion!.id, title: doc.title }] : current.filter(item => item.id !== doc.latestVersion!.id))}>{doc.title} <Typography.Text type="secondary">({documentStatusLabel(doc.latestVersion.extractionStatus)})</Typography.Text></Checkbox>)}</Space>{!loading && documents.length === 0 && <Empty description="Arşivde belge yok." image={Empty.PRESENTED_IMAGE_SIMPLE} />}</Spin>
      <Pagination current={page} pageSize={30} total={total} onChange={setPage} showSizeChanger={false} size="small" showTotal={count=>`${count} belge`} />
    </Space>
  </Modal>
}
