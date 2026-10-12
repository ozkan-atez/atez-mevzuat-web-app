import { useRef, useState } from 'react'
import { Alert, Button, DatePicker, Modal, Spin, Typography } from 'antd'
import { CalendarOutlined, PlayCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { createManualScan } from '../scans/api'
import { listSources } from '../workspace/api'
import { useResource } from '../workspace/useResource'
import './trigger-workflow-modal.css'

interface Props { onClose: () => void; onTriggered?: (runId: string) => void }

export function TriggerWorkflowModal({ onClose, onTriggered }: Props) {
  const [selectedDate, setSelectedDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  const [selectedSourceKeys, setSelectedSourceKeys] = useState<string[]>(['resmi-gazete'])
  const sources = useResource(listSources, { sources: [] })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const availableSources = sources.data.sources.filter(source => source.isActive && source.scanSupported)
  const sourceKeys = selectedSourceKeys.filter(key => availableSources.some(source => source.key === key)).sort()
  const canStart = !sources.loading && !sources.error && sourceKeys.length > 0 && sourceKeys.length <= 30

  const attempt = useRef<{ signature: string; key: string } | null>(null)
  const handleTrigger = async () => {
    if (!canStart || isLoading) return
    setIsLoading(true); setError(null)
    try {
      const signature = JSON.stringify({ date: selectedDate, sourceKeys })
      if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
      const data = await createManualScan(selectedDate, attempt.current.key, sourceKeys)
      attempt.current = null
      onTriggered?.(data.runId)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Tarama başlatılamadı')
    } finally { setIsLoading(false) }
  }

  return <Modal open title={<span><CalendarOutlined style={{ marginRight: 8 }} />Yeni mevzuat taraması</span>} onCancel={onClose} closable={!isLoading} mask={{ closable: !isLoading }} footer={<><Button onClick={onClose} disabled={isLoading}>İptal</Button><Button type="primary" icon={<PlayCircleOutlined />} aria-label="Taramayı Başlat" loading={isLoading} disabled={!canStart} onClick={handleTrigger}>Taramayı Başlat</Button></>}>
    <Typography.Paragraph type="secondary">Hedef tarihi ve taramak istediğiniz kaynakları seçin.</Typography.Paragraph>
    <label htmlFor="scan-target-date" className="atez-modal-label">Tarama tarihi</label>
    <DatePicker id="scan-target-date" aria-label="Tarama tarihi" value={dayjs(selectedDate)} onChange={(date) => date && setSelectedDate(date.format('YYYY-MM-DD'))} format="DD.MM.YYYY" style={{ width: '100%', marginTop: 7 }} disabled={isLoading} />
    <fieldset style={{ border: 0, padding: 0, margin: '18px 0 0' }}>
      <legend className="atez-modal-label">Taranacak kaynaklar</legend>
      {sources.loading ? <Spin size="small" aria-label="Kaynaklar yükleniyor" /> : sources.error ? <Alert type="error" showIcon title={sources.error} action={<Button size="small" onClick={() => void sources.refresh()}>Tekrar dene</Button>} /> : <>
        <div className="atez-scan-source-toggles">
          {sources.data.sources.map(source => <Button
            key={source.id}
            className="atez-scan-source-toggle"
            aria-pressed={sourceKeys.includes(source.key)}
            disabled={isLoading || !source.isActive || !source.scanSupported}
            title={!source.isActive ? 'Kaynak pasif' : !source.scanSupported ? 'Kaynak taramaya hazır değil' : undefined}
            onClick={() => setSelectedSourceKeys(keys => keys.includes(source.key) ? keys.filter(key => key !== source.key) : [...keys, source.key])}
          >{source.name}</Button>)}
        </div>
        {!availableSources.length ? <Typography.Paragraph type="secondary">Taramaya hazır kaynak bulunamadı.</Typography.Paragraph> : <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0, fontSize: 12 }}>{sourceKeys.length} kaynak seçildi. En az bir, en fazla 30 kaynak seçin.</Typography.Paragraph>}
      </>}
    </fieldset>
    <Typography.Paragraph type="secondary" style={{ marginTop: 14, fontSize: 12 }}>Seçilen kaynaklarda bu tarihte yayımlanan belgeler taranır. Resmî Gazete seçildiğinde ana ve mükerrer sayılar ile bağlı dosyalar da arşivlenir. İlgili belgeler analiz edilerek rapora dönüştürülür.</Typography.Paragraph>
    {error && <Alert type="error" showIcon title={error} style={{ marginTop: 18 }} />}
  </Modal>
}
