import { ActionLink, ReviseButton } from '../../components/layout/PageToolbar'
import { StandaloneReportCorrection } from './StandaloneReportCorrection'
import { useCan } from '../auth/AuthProvider'
import { ReportCorrectionDrawer } from '../revision/ReportCorrectionDrawer'
import { ReportWorkspace } from '../revision/ReportWorkspace'
import { useEffect, useState } from 'react'
import { Alert, Button, Card, Empty, Grid, Input, Select, Space, Table, Tag, Typography } from 'antd'
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import { StartScanAction } from '../scans/StartScanAction'
import { listReports, type ReportListRow } from './reports-api'
import './reports-index.css'

const originLabels = { AUTOMATION: 'Otomasyon', MANUAL: 'Manuel', UNKNOWN: 'Belirlenemedi' }
const contentLabels = { LEGISLATION: 'Mevzuat raporu', DOCUMENT: 'Belge analizi', NO_CHANGE: 'Değişiklik yok' }
function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeZone: 'Europe/Istanbul' }).format(new Date(`${value}T12:00:00+03:00`)) : '—'
}
export function ReportsIndex() {
  const canEdit = useCan('report.edit')
  const [editing, setEditing] = useState<ReportListRow | null>(null)
  const screens = Grid.useBreakpoint()
  const [rows, setRows] = useState<ReportListRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('newest')
  const [origin, setOrigin] = useState('ALL')
  const [content, setContent] = useState('ALL')
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null)
    listReports({ page, pageSize: 10, query, sort, origin, content }, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setRows(result.reports); setTotal(result.total) } })
      .catch(caught => { if (!controller.signal.aborted) { setRows([]); setError(caught instanceof Error ? caught.message : 'Raporlar alınamadı.') } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [page, query, sort, origin, content, reload])
  const changeFilter = (setter: (value: string) => void) => (value: string) => { setter(value); setPage(1) }
  return <div className="atez-page-stack">
    <div className="atez-page-heading"><div><Typography.Title level={2}>Raporlar</Typography.Title><Typography.Text type="secondary">Sohbetlerden ve otomasyonlardan oluşturulan raporlar.</Typography.Text></div><StartScanAction /></div>
    <Card className="atez-surface-card">
      <Space wrap className="atez-report-toolbar">
        <Input.Search aria-label="Raporlarda ara" placeholder="Raporlarda ara" value={query} onChange={event => changeFilter(setQuery)(event.target.value)} allowClear style={{ width: 260, maxWidth: '100%' }} />
        <Select aria-label="Üretim türü" style={{ width: 180 }} options={[{ value: 'ALL', label: 'Tüm üretim türleri' }, ...Object.entries(originLabels).map(([value, label]) => ({ value, label }))]} value={origin} onChange={changeFilter(setOrigin)} />
        <Select aria-label="Rapor içeriği" style={{ width: 190 }} options={[{ value: 'ALL', label: 'Tüm içerikler' }, ...Object.entries(contentLabels).map(([value, label]) => ({ value, label }))]} value={content} onChange={changeFilter(setContent)} />
        <Select aria-label="Rapor sıralaması" value={sort} onChange={changeFilter(setSort)} style={{ width: 195 }} options={[{ value: 'newest', label: 'Son güncellenenler' }, { value: 'date', label: 'Mevzuat tarihi' }]} />
        <Button icon={<ReloadOutlined />} onClick={() => setReload(value => value + 1)}>Yenile</Button>
      </Space>
      {error && <Alert type="warning" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Table<ReportListRow> rowKey="id" dataSource={rows} loading={loading} pagination={{ current: page, pageSize: 10, total, showSizeChanger: false, hideOnSinglePage: true, onChange: setPage }}
        locale={{ emptyText: <Empty description="Bu seçimle eşleşen rapor bulunamadı." /> }} scroll={screens.sm ? { x: 850 } : undefined}
        columns={[
          { title: 'Rapor', dataIndex: 'title', render: (_value, row) => <><Typography.Text strong>{row.title}</Typography.Text><br /><Typography.Text type="secondary">{row.automationName ?? row.initiatedBy?.name ?? contentLabels[row.contentType]}</Typography.Text>{!screens.sm && <div className="atez-report-mobile-meta"><Tag>{originLabels[row.origin]}</Tag><Typography.Text type="secondary">{formatDate(row.targetDate)} · v{row.version}</Typography.Text></div>}</> },
          { title: 'Mevzuat tarihi', dataIndex: 'targetDate', responsive: ['sm'], render: formatDate },
          { title: 'Tür', dataIndex: 'origin', responsive: ['sm'], render: (value: ReportListRow['origin']) => <Tag color={value === 'AUTOMATION' ? 'purple' : value === 'MANUAL' ? 'blue' : 'default'}>{originLabels[value]}</Tag> },
          { title: 'İçerik', dataIndex: 'contentType', responsive: ['lg'], render: (value: ReportListRow['contentType']) => contentLabels[value] },
          { title: 'Sürüm', dataIndex: 'version', responsive: ['sm'], render: (value: number) => `v${value}` },
          { title: 'İşlemler', width: 236, align: 'right', render: (_value, row) => <div className="atez-report-row-actions"><ActionLink icon={<EyeOutlined aria-hidden />} to={row.standalone ? `/reports/documents/${row.id}` : row.topicId ? `/reports/${row.topicId}` : `/runs/${row.runId}/reports/${row.id}`}>İncele</ActionLink>{canEdit && <ReviseButton type="default" onClick={() => setEditing(row)} />}</div> },
        ]} />
    </Card>
    <ReportCorrectionDrawer open={Boolean(editing)} onClose={() => setEditing(null)}><div className="atez-report-correction-content">{editing?.standalone ? <StandaloneReportCorrection key={editing.id} reportId={editing.id} /> : editing && <ReportWorkspace key={editing.id} topicId={editing.topicId ?? editing.id} popup onRevisionSaved={() => setReload(value => value + 1)} />}</div></ReportCorrectionDrawer>
  </div>
}
