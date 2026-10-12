import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ArrowRightOutlined } from '@ant-design/icons'
import { listScanRuns } from '../scans/api'
import type { ScanRunStatus, ScanRunSummary } from '../scans/types'

const statusLabels: Record<ScanRunStatus, string> = {
  QUEUED: 'Sırada', RUNNING: 'Çalışıyor', AWAITING_RETRY: 'AI filtresi bekliyor', COMPLETED: 'Tamamlandı', PARTIAL: 'Kısmen tamamlandı', FAILED: 'Başarısız', CANCELLED: 'İptal edildi',
}
const statusColors: Record<ScanRunStatus, string> = {
  QUEUED: 'default', RUNNING: 'processing', AWAITING_RETRY: 'warning', COMPLETED: 'success', PARTIAL: 'warning', FAILED: 'error', CANCELLED: 'default',
}
const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeZone: 'Europe/Istanbul' })
const timeFormat = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })

const columns: ColumnsType<ScanRunSummary> = [
  { title: 'Tarih', dataIndex: 'targetDate', key: 'date', render: (date: string, run) => <><span>{dateFormat.format(new Date(`${date}T12:00:00+03:00`))}</span><small className="atez-table-sub">{timeFormat.format(new Date(run.createdAt))}</small></> },
  { title: 'Çalışma', dataIndex: 'id', key: 'run', render: (id: string, run) => <><strong>{run.automationName ?? run.scheduleLabel ?? (run.trigger === 'CRON' ? 'Zamanlanmış tarama' : 'Manuel tarama')}</strong><Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>{id.slice(0, 8)}</Typography.Text><small className="atez-table-sub">{run.counts.documents} belge · {run.counts.assets} bağlı dosya · {run.counts.editions} sayı</small></> },
  { title: 'Kaynak / Tür', dataIndex: 'trigger', key: 'trigger', render: (trigger: ScanRunSummary['trigger']) => <Tag>Resmî Gazete · {trigger === 'MANUAL' ? 'Manuel' : 'Cron'}</Tag> },
  { title: 'Durum', dataIndex: 'status', key: 'status', render: (status: ScanRunStatus) => <Tag color={statusColors[status]}>{statusLabels[status]}</Tag> },
  { title: 'Aksiyon', dataIndex: 'id', key: 'action', align: 'right', render: (id: string) => <Link to={`/runs/${id}`}><Button size="small" type="link" icon={<ArrowRightOutlined />} iconPlacement="end">İncele</Button></Link> },
]

export function RecentScanRuns({ onLoaded }: { onLoaded?: (runs: ScanRunSummary[]) => void }) {
  const [runs, setRuns] = useState<ScanRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void listScanRuns(10)
      .then((next) => { setRuns(next); onLoaded?.(next) })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Taramalar alınamadı'))
      .finally(() => setLoading(false))
  }, [onLoaded])

  return <Card className="atez-dashboard-card atez-scans-card" title={<><strong>Son taramalar</strong><Typography.Text type="secondary">Gerçek tarama kayıtları ve durumları</Typography.Text></>} extra={<Link to="/reports"><Button type="link" size="small">Tüm raporlar <ArrowRightOutlined /></Button></Link>} data-purpose="recent-scan-runs">
    {error ? <Typography.Text type="danger">{error}</Typography.Text> : <Table<ScanRunSummary> rowKey="id" columns={columns} dataSource={runs} loading={loading} pagination={false} size="small" scroll={{ x: 650 }} locale={{ emptyText: 'Henüz tarama oluşturulmadı.' }} />}
  </Card>
}
