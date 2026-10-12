import { Can } from '../auth/Can'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Input } from 'antd'
import { ArrowRightOutlined } from '@ant-design/icons'
import { RecentScanRuns } from './RecentScanRuns'
import { DayActivity } from './DayActivity'
import { useScanSchedule } from './useScanSchedule'
import { createChatSession } from '../chat/api'
import { MAX_MESSAGE_LENGTH } from '../chat/types'
import type { ScanRunSummary } from '../scans/types'

export function Dashboard() {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<ScanRunSummary[]>([])
  const [prompt, setPrompt] = useState('')
  const [isStartingChat, setIsStartingChat] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const startingChat = useRef(false)
  const schedule = useScanSchedule()
  const completed = runs.filter((run) => run.status === 'COMPLETED').length
  const attention = runs.filter((run) => ['AWAITING_RETRY', 'PARTIAL', 'FAILED'].includes(run.status)).length
  const active = runs.filter((run) => ['QUEUED', 'RUNNING'].includes(run.status)).length
  const docs = runs.reduce((total, run) => total + run.counts.documents, 0)
  const metrics = [
    { label: 'İnceleme gerektiren', value: attention, sub: 'Son taramalardaki dikkat gerektiren çalışmalar', featured: true },
    { label: 'Tamamlanan tarama', value: completed, sub: 'Son tarama kayıtlarında' },
    { label: 'Aktif çalışmalar', value: active, sub: 'Sırada veya çalışıyor' },
    { label: 'Taranan belge', value: docs, sub: 'Son taramaların toplamı' },
  ]

  const submitPrompt = async () => {
    if (startingChat.current) return
    const content = prompt.trim()
    if (content.length > MAX_MESSAGE_LENGTH) { setChatError(`Mesaj en fazla ${MAX_MESSAGE_LENGTH} karakter olabilir.`); return }
    startingChat.current = true
    setIsStartingChat(true)
    setChatError(null)
    try {
      const session = await createChatSession()
      navigate(`/chat/${session.id}`, { state: content ? { initialMessage: content } : null, viewTransition: true })
    } catch (caught) {
      setChatError(caught instanceof Error ? caught.message : 'Sohbet başlatılamadı.')
      startingChat.current = false
      setIsStartingChat(false)
    }
  }


  return <div className="atez-dashboard" data-purpose="dashboard">
    <div className="atez-page-heading"><div><h1>Çalışma alanı</h1><p>Mevzuat gündeminiz, tek bir yerde.</p></div></div>
    <section className="atez-ai-hero" aria-label="Mevzuat Radar AI">
      <div className="atez-hero-grid" aria-hidden="true" />
      <div className="atez-ai-orb" aria-hidden="true"><span /></div>
      <div className="atez-ai-hero-copy"><div className="atez-eyebrow">MEVZUAT RADAR AI</div><h2>Mevzuatı takip edin.<br /><span>Bir adım önde kalın.</span></h2><p>Araştırın, analiz edin ve raporlayın. Asistanınız hazır.</p></div>
      <Can permission="chat.write"><form className="atez-ai-command" onSubmit={(event) => { event.preventDefault(); void submitPrompt() }}><Input aria-label="Asistana rapor talimatı" value={prompt} maxLength={MAX_MESSAGE_LENGTH} disabled={isStartingChat} onChange={(event) => setPrompt(event.target.value)} placeholder="Bugünün gümrük düzenlemelerini analiz et…" variant="borderless" /><Button htmlType="submit" type="primary" loading={isStartingChat}>Sohbete geç <ArrowRightOutlined /></Button></form></Can>
      {chatError && <Alert type="error" showIcon title={chatError} style={{ marginTop: 12 }} />}
    </section>
    <section className="atez-metric-grid" aria-label="Tarama özeti">{metrics.map((metric) => <Card key={metric.label} className={`atez-metric ${metric.featured ? 'featured' : ''}`}><div className="atez-metric-label">{metric.label}</div><strong>{String(metric.value).padStart(2, '0')}</strong><small>{metric.sub}</small></Card>)}</section>
    <div className="atez-dashboard-grid">
      <RecentScanRuns onLoaded={setRuns} />
      <DayActivity schedule={schedule} />
    </div>
  </div>
}
