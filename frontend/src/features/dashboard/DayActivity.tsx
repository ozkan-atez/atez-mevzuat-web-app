import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Button, Card, Empty, Select, Skeleton } from 'antd'
import { CheckCircleOutlined, CommentOutlined, EditOutlined, FileTextOutlined, ReloadOutlined, ArrowRightOutlined } from '@ant-design/icons'
import { apiFetch } from '../../lib/apiFetch'
import type { ScheduleView } from '../scans/types'
import './day-activity.css'

type Kind = 'REPORT' | 'REVISION' | 'CHAT' | 'SCAN'
interface Item { id: string; kind: Kind; title: string; detail: string; at: string; href: string; version?: number }
interface Activity { items: Item[]; hasMore: boolean; summary: { reports: number; revisions: number; chats: number; scans: number }; latestReport: { id: string; title: string; version: number; at: string; href: string } | null }
const labels: Record<Kind, string> = { REPORT: 'Rapor', REVISION: 'Revizyon', CHAT: 'Sohbet', SCAN: 'Tarama' }
const icons = { REPORT: <FileTextOutlined />, REVISION: <EditOutlined />, CHAT: <CommentOutlined />, SCAN: <CheckCircleOutlined /> }
const stamp = (value: string) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }).format(new Date(value))
const slotLabels = { COMPLETED: 'Tamamlandı', RUNNING: 'Sürüyor', ATTENTION: 'Kontrol gerekli', DUE: 'Sırada', PENDING: 'Bekliyor' }

export function DayActivity({ schedule }: { schedule: ScheduleView | null }) {
  const [days, setDays] = useState('1')
  const [kind, setKind] = useState('ALL')
  const [data, setData] = useState<Activity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    setData(null)
    setLoading(true)
    setError(null)
    const load = async () => {
      if (pending) return
      pending = true
      try {
        const response = await apiFetch(`/api/v1/workspace/activity?days=${days}${kind === 'ALL' ? '' : `&kind=${kind}`}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Günün akışı alınamadı. Yeniden deneyebilirsiniz.')
        const next = await response.json() as Activity
        if (!Array.isArray(next.items) || !next.summary) throw new Error('Günün akışı alınamadı. Yeniden deneyebilirsiniz.')
        if (!controller.signal.aborted) { setData(next); setError(null) }
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Günün akışı alınamadı.')
      } finally { pending = false; if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void load() }, 30_000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [days, kind, reload])

  return <Card className="atez-dashboard-card atez-day-activity" title={<strong>Günün akışı</strong>} extra={<Button type="text" icon={<ReloadOutlined />} aria-label="Günün akışını yenile" onClick={() => setReload(value => value + 1)} />}>
    <div className="day-activity-toolbar">
      <Select aria-label="Akış dönemi" value={days} onChange={setDays} options={[{ value: '1', label: 'Bugün' }, { value: '7', label: 'Son 7 gün' }]} />
      <Select aria-label="Hareket türü" value={kind} onChange={setKind} options={[{ value: 'ALL', label: 'Tümü' }, { value: 'REPORT', label: 'Raporlar' }, { value: 'REVISION', label: 'Revizyonlar' }, { value: 'CHAT', label: 'Sohbetler' }, { value: 'SCAN', label: 'Taramalar' }]} />
    </div>
    {error && <Alert type="warning" showIcon title={error} description={data ? 'Son alınan bilgiler gösteriliyor.' : undefined} />}
    {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : data && <>
      <div className="day-activity-summary" aria-label={days === '1' ? 'Bugünkü hareket özeti' : 'Son 7 günün hareket özeti'}>
        {[['Tarama', data.summary.scans], ['Rapor', data.summary.reports], ['Revizyon', data.summary.revisions], ['Sohbet', data.summary.chats]].map(([label, count]) => <div key={label}><strong>{count}</strong><span>{label}</span></div>)}
      </div>
      {data.latestReport ? <Link className="day-activity-latest" to={data.latestReport.href}>
        <span className="day-activity-eyebrow"><FileTextOutlined /> SON RAPOR <span>v{data.latestReport.version}</span></span>
        <strong>{data.latestReport.title}</strong>
        <span className="day-activity-latest-footer"><time dateTime={data.latestReport.at}>{stamp(data.latestReport.at)}</time><span>Raporu aç <ArrowRightOutlined /></span></span>
      </Link> : <p className="day-activity-muted">Henüz yayımlanmış rapor yok.</p>}
      {data.items.length ? <ol className="day-activity-list" aria-label="Son hareketler">{data.items.map(item => <li key={item.id}>
        <span className={`day-activity-icon day-activity-icon-${item.kind.toLowerCase()}`}>{icons[item.kind]}</span>
        <Link to={item.href} className="day-activity-entry">
          <span className="day-activity-meta"><span>{labels[item.kind]}{item.version ? ` · v${item.version}` : ''}</span><time dateTime={item.at}>{stamp(item.at)}</time></span>
          <strong>{item.title}</strong><span className="day-activity-detail">{item.detail}</span>
        </Link>
      </li>)}</ol> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={kind === 'ALL' ? (days === '1' ? 'Bugün henüz hareket yok.' : 'Son 7 günde hareket yok.') : 'Bu dönemde seçili türde hareket yok.'} />}
      {data.hasMore && <p className="day-activity-muted">Son 100 hareket gösteriliyor. Dönem veya tür seçerek listeyi daraltabilirsiniz.</p>}
    </>}
    {!!schedule?.slots?.length && <details className="day-activity-schedule"><summary>Bugünün tarama planı <span>{schedule.slots.filter(slot => slot.state === 'COMPLETED').length}/{schedule.slots.length} tamamlandı</span></summary><ul>{schedule.slots.map(slot => <li key={slot.key}><span>{slot.time} · {slot.label}</span><span>{slot.run ? <Link to={`/runs/${slot.run.id}`}>{slotLabels[slot.state]}</Link> : slotLabels[slot.state]}</span></li>)}</ul></details>}
  </Card>
}
