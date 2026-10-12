import { Can } from '../auth/Can'
import { SourceProfilePanel } from './SourceProfilePanel'
import { useRef, useState } from 'react'
import { Alert, Button, DatePicker, Empty, Input, List, Modal, Select, Space, Tag, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { OperationModeSelect, type OperationMode } from '../operations/OperationModeSelect'
import { startOperation } from '../operations/api'
import { createManualScan } from '../scans/api'
import { workspaceRequest } from './api'
import type { WorkspaceSource } from './api'

export function SourceActions({ source, onChanged }: { source: WorkspaceSource; onChanged: () => void }) {
  const [stepOpen, setStepOpen] = useState(false)
  const [step, setStep] = useState<'DISCOVER' | 'CAPTURE'>('DISCOVER')
  const [stepMode, setStepMode] = useState<OperationMode>('REUSE_ONLY')
  const [stepUrl, setStepUrl] = useState('')
  const [scanOpen, setScanOpen] = useState(false)
  const [datePolicy,setDatePolicy]=useState('PUBLISHED_DATE')
  const [feedsOpen, setFeedsOpen] = useState(false)
  const [date, setDate] = useState(() => dayjs(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, holder] = message.useMessage()
  const navigate = useNavigate()
  const attempt = useRef<{ date: string; key: string } | null>(null)
  const scan = async () => {
    if (!date) return
    setBusy(true); setError(null)
    try {
      const targetDate = date.format('YYYY-MM-DD')
      const attemptIdentity=`${targetDate}:${datePolicy}`
      if (attempt.current?.date !== attemptIdentity) attempt.current = { date: attemptIdentity, key: crypto.randomUUID() }
      const result = await createManualScan(targetDate, attempt.current.key, [source.key],datePolicy)
      attempt.current = null
      setScanOpen(false); navigate(`/runs/${result.runId}`)
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  const endpointAction = async (path: string) => {
    setBusy(true)
    try { await workspaceRequest(`source-sites/${source.id}/${path}`, { method: 'POST' }); onChanged(); void feedback.success('Kaynak güncellendi.') } catch (caught) { void feedback.error((caught as Error).message) } finally { setBusy(false) }
  }
  return <>{holder}<Space wrap><Can permission="scan.run"><Button disabled={!source.isActive || !source.scanSupported} onClick={() => { attempt.current = null; setScanOpen(true) }}>Kaynağı tara</Button></Can><Can permission="analysis.run"><Button disabled={!source.isActive || !source.scanSupported} onClick={() => { setError(null); setStepOpen(true) }}>Tek adım çalıştır</Button></Can><Button onClick={() => setFeedsOpen(true)}>Kaynak akışları</Button><Can permission="config.manage"><SourceProfilePanel source={source} onChanged={onChanged} /></Can></Space>
    <Modal title={`${source.name} · Bağımsız işlem`} open={stepOpen} onCancel={() => setStepOpen(false)} confirmLoading={busy} okText="Adımı başlat" cancelText="Vazgeç" onOk={() => { setBusy(true); setError(null); void startOperation({ operation: step, mode: stepMode, documentVersionIds: [], sourceId: source.id, date: date.format('YYYY-MM-DD'), datePolicy, ...(stepUrl.trim() ? { url: stepUrl.trim() } : {}) }).then(result => { setStepOpen(false); navigate(`/operations/${result.id}`) }).catch(e => setError(e.message)).finally(() => setBusy(false)) }}><Space orientation="vertical" style={{ width: '100%' }}><Select aria-label="Kaynak işlem adımı" value={step} onChange={setStep} options={[{ value: 'DISCOVER', label: 'Bağlantıları keşfet' }, { value: 'CAPTURE', label: 'Belge içeriğini çek' }]} /><DatePicker aria-label="İşlem tarihi" value={date} onChange={value => { if (value) setDate(value) }} allowClear={false} /><OperationModeSelect value={stepMode} onChange={setStepMode} />{step === 'CAPTURE' && <Input aria-label="Çekilecek belge bağlantısı" placeholder="Belge bağlantısı (isteğe bağlı)" value={stepUrl} onChange={event => setStepUrl(event.target.value)} />}{error && <Alert type="error" title={error} showIcon />}</Space></Modal>
    <Modal title={`${source.name} taraması`} open={scanOpen} onCancel={() => setScanOpen(false)} onOk={() => void scan()} confirmLoading={busy} okText="Taramayı başlat" cancelText="Vazgeç"><DatePicker aria-label="Tarama tarihi" value={date} onChange={value => { if (value) setDate(value) }} format="DD.MM.YYYY" allowClear={false} style={{ width: '100%' }} />{source.key!=='resmi-gazete'&&<Select aria-label="İçerik seçimi" value={datePolicy} onChange={setDatePolicy} style={{width:'100%',marginTop:12}} options={[{value:'PUBLISHED_DATE',label:'Seçilen gün yayımlananlar'},{value:'NEW_OR_CHANGED',label:'Yeni veya değişen içerikler (tarihsizler dahil)'}]}/>}{error && <Alert type="error" title={error} style={{ marginTop: 12 }} />}</Modal>
    <Modal title={`${source.name} · Kaynak akışları`} open={feedsOpen} onCancel={() => setFeedsOpen(false)} footer={<Space><Can permission="config.manage"><Button loading={busy} onClick={() => void endpointAction('discover')}>Yeni bağlantıları keşfet</Button></Can><Button onClick={() => setFeedsOpen(false)}>Kapat</Button></Space>} width={760}><List dataSource={source.endpoints ?? []} locale={{ emptyText: <Empty description={source.key === 'resmi-gazete' ? 'Resmî Gazete günlük ve mükerrer sayıları standart tarayıcıyla okunur.' : 'Kaynak bağlantılarını keşfedebilirsiniz.'} /> }} renderItem={endpoint => <List.Item actions={endpoint.status === 'ACTIVE' ? [<Tag color="success" key="active">Etkin</Tag>] : [<Can permission="config.manage" key="activate"><Button key="activate" loading={busy} onClick={() => void endpointAction(`endpoints/${endpoint.id}/activate`)}>Etkinleştir</Button></Can>, <Can permission="config.manage" key="reject"><Button key="reject" loading={busy} onClick={() => void endpointAction(`endpoints/${endpoint.id}/reject`)}>Reddet</Button></Can>]}><List.Item.Meta title={<a href={endpoint.url} target="_blank" rel="noreferrer">{endpoint.title}</a>} description={<>{endpoint.url}<br />{endpoint.adapter ? 'Tarihli tarama bağlayıcısı hazır' : 'Raporlara kaynak içeriği sağlar'}</>} /></List.Item>} /></Modal>
  </>
}
