import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Input, Select, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ArrowRightOutlined, DownOutlined, FilterOutlined, UpOutlined } from '@ant-design/icons'
import { listScanRuns } from '../scans/api'
import type { ScanRunStatus, ScanRunSummary } from '../scans/types'
import { emptyScanFilters, filterScanRuns, scanName, type ScanFilters } from './scan-run-filters'
import './recent-scan-runs.css'

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
  { title: 'Çalıştırma türü', dataIndex: 'trigger', key: 'trigger', render: (trigger: ScanRunSummary['trigger']) => <Tag color={trigger === 'MANUAL' ? 'default' : 'blue'}>{trigger === 'MANUAL' ? 'Manuel' : 'Otomasyon'}</Tag> },
  { title: 'Durum', dataIndex: 'status', key: 'status', render: (status: ScanRunStatus) => <Tag color={statusColors[status]}>{statusLabels[status]}</Tag> },
  { title: 'Aksiyon', dataIndex: 'id', key: 'action', align: 'right', render: (id: string) => <Link to={`/runs/${id}`}><Button size="small" type="link" icon={<ArrowRightOutlined />} iconPlacement="end">İncele</Button></Link> },
]

export function RecentScanRuns({ onLoaded }: { onLoaded?: (runs: ScanRunSummary[]) => void }) {
  const [runs, setRuns] = useState<ScanRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ScanFilters>(emptyScanFilters)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filtersId = useId()
  const [page, setPage] = useState(1)
  const updateFilter = (key: keyof ScanFilters, value: string) => {
    setFilters(current => ({ ...current, [key]: value }))
    setPage(1)
  }
  const filteredRuns = filterScanRuns(runs, filters)
  const activeFilterCount = Object.values(filters).filter(Boolean).length
  const hasFilters = activeFilterCount > 0
  const automationNames = [...new Set(runs.filter(run => run.trigger === 'CRON').map(scanName))].sort((a, b) => a.localeCompare(b, 'tr'))

  useEffect(() => {
    void listScanRuns(50)
      .then((next) => { setRuns(next); onLoaded?.(next.slice(0, 10)) })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Taramalar alınamadı'))
      .finally(() => setLoading(false))
  }, [onLoaded])

  return <Card className="atez-dashboard-card atez-scans-card" title={<><strong>Son taramalar</strong><Typography.Text type="secondary">Gerçek tarama kayıtları ve durumları</Typography.Text></>} extra={<Link to="/reports"><Button type="link" size="small">Tüm raporlar <ArrowRightOutlined /></Button></Link>} data-purpose="recent-scan-runs">
    <div className="scan-filter-summary">
      <Button size="small" icon={<FilterOutlined />} aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen(open => !open)}>
        Filtreler{hasFilters ? ` (${activeFilterCount})` : ''} {filtersOpen ? <UpOutlined /> : <DownOutlined />}
      </Button>
      <span className="scan-filter-result" aria-live="polite">{loading ? 'Taramalar yükleniyor…' : `Son ${runs.length} taramadan ${filteredRuns.length} kayıt`}</span>
      {hasFilters && <Button size="small" type="link" onClick={() => { setFilters(emptyScanFilters); setPage(1) }}>Temizle</Button>}
    </div>
    <div id={filtersId} hidden={!filtersOpen} className="scan-filter-panel">
    <div className="scan-filters" role="group" aria-label="Tarama filtreleri">
      <label>Başlangıç tarihi<Input size="small" type="date" aria-label="Başlangıç tarihi" value={filters.from} max={filters.to || undefined} onChange={event => updateFilter('from', event.target.value)} /></label>
      <label>Bitiş tarihi<Input size="small" type="date" aria-label="Bitiş tarihi" value={filters.to} min={filters.from || undefined} onChange={event => updateFilter('to', event.target.value)} /></label>
      <label>Otomasyon adı<Select size="small" aria-label="Otomasyon adı" showSearch optionFilterProp="label" allowClear placeholder="Tüm otomasyonlar" value={filters.automation || undefined} onChange={value => updateFilter('automation', value ?? '')} options={automationNames.map(name => ({ value: name, label: name }))} /></label>
      <label>Çalıştırma türü<Select size="small" aria-label="Çalıştırma türü" allowClear placeholder="Tüm türler" value={filters.type || undefined} onChange={value => updateFilter('type', value ?? '')} options={[{ value: 'MANUAL', label: 'Manuel' }, { value: 'CRON', label: 'Otomasyon' }]} /></label>
      <label>Başlangıç saati<Input size="small" type="time" aria-label="Başlangıç saati" value={filters.startTime} onChange={event => updateFilter('startTime', event.target.value)} /></label>
      <label>Bitiş saati<Input size="small" type="time" aria-label="Bitiş saati" value={filters.endTime} onChange={event => updateFilter('endTime', event.target.value)} /></label>
      <label>Durum<Select size="small" aria-label="Tarama durumu" allowClear placeholder="Tüm durumlar" value={filters.status || undefined} onChange={value => updateFilter('status', value ?? '')} options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} /></label>
      <label>Belge sonucu<Select size="small" aria-label="Belge sonucu" allowClear placeholder="Tüm sonuçlar" value={filters.documents || undefined} onChange={value => updateFilter('documents', value ?? '')} options={[{ value: 'FOUND', label: 'Belge bulunan' }, { value: 'EMPTY', label: 'Belgesiz tamamlanan' }]} /></label>
    </div>
    <Typography.Paragraph type="secondary" className="scan-filter-hint">Filtreler anında uygulanır. Saatler İstanbul saatidir.</Typography.Paragraph>
    </div>
    {filters.from && filters.to && filters.from > filters.to && <Typography.Paragraph type="danger">Başlangıç tarihi bitiş tarihinden sonra olamaz.</Typography.Paragraph>}
    {error ? <Typography.Text type="danger">{error}</Typography.Text> : <Table<ScanRunSummary> rowKey="id" columns={columns} dataSource={filteredRuns} loading={loading} pagination={{ current: page, pageSize: 10, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }} size="small" scroll={{ x: 650 }} locale={{ emptyText: hasFilters ? 'Bu filtrelere uygun tarama bulunamadı.' : 'Henüz tarama oluşturulmadı.' }} />}
  </Card>
}
