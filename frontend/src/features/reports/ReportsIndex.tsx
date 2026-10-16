import { ActionLink, ReviseButton } from '../../components/layout/PageToolbar'
import { StandaloneReportCorrection } from './StandaloneReportCorrection'
import { useCan } from '../auth/AuthProvider'
import { ReportCorrectionDrawer } from '../revision/ReportCorrectionDrawer'
import { ReportWorkspace } from '../revision/ReportWorkspace'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Empty, Grid, Input, Select, Space, Table, Tag, Typography } from 'antd'
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import { listStandaloneReports, type StandaloneReport } from './standalone-api'
import { StartScanButton } from '../scans/StartScanButton'
import { useNavigate } from 'react-router-dom'
import { getScanRun, listScanRuns } from '../scans/api'
import type { ScanRunDetail } from '../scans/types'
import './reports-index.css'

type ReportRow = {
  key: string
  id: string
  runId: string
  topicId: string | null
  title: string
  version: number
  targetDate: string
  publishedAt: string
  card: string
  automationId?: string | null
  automationName?: string | null
  creationType: string
  standalone?: boolean
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeZone: 'Europe/Istanbul' })
    .format(new Date(`${value}T12:00:00+03:00`))
}

export function ReportsIndex() {
  const navigate = useNavigate()
  const canEdit = useCan('report.edit')
  const [editing, setEditing] = useState<ReportRow | null>(null)
  const screens = Grid.useBreakpoint()
  const [standalone, setStandalone] = useState<StandaloneReport[]>([])
  const [standaloneError, setStandaloneError] = useState<string | null>(null)
  const [runs, setRuns] = useState<Array<ScanRunDetail & {automationId?:string|null;automationName?:string|null;trigger?:string}>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('newest')
  const [filter, setFilter] = useState('Tümü')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void listScanRuns(50)
      .then(async (summaries) => {
        const details: PromiseSettledResult<ScanRunDetail>[] = []
        for (let index = 0; index < summaries.length; index += 5) {
          if (cancelled) return
          details.push(...await Promise.allSettled(summaries.slice(index, index + 5).map((run) => getScanRun(run.id))))
        }
        if (cancelled) return
        const available = details.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
        setRuns(available.map(run=>{const summary=summaries.find(item=>item.id===run.id);return {...run,automationId:summary?.automationId,automationName:summary?.automationName,trigger:summary?.trigger}}))
        if (details.some((result) => result.status === 'rejected')) {
          setError('Bazı taramaların raporları alınamadı. Listeyi yenileyebilirsiniz.')
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Raporlar alınamadı.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reload])

  useEffect(() => { let cancelled = false; void listStandaloneReports().then(result => { if (!cancelled) { setStandalone(result.reports); setStandaloneError(null) } }).catch(error => { if (!cancelled) setStandaloneError(error.message) }); return () => { cancelled = true } }, [reload])

  const rows = useMemo<ReportRow[]>(() => [...runs.flatMap((run) => (run.reports ?? []).map((report) => ({
    key: `${run.id}:${report.id}`,
    id: report.id,
    runId: run.id,
    topicId: report.topicId,
    title: report.title,
    version: report.version,
    targetDate: run.targetDate,
    publishedAt: report.publishedAt ?? run.startedAt ?? run.targetDate,
    card: report.card,
    automationId:run.automationId,automationName:run.automationName,
    creationType:run.automationId || run.automationName || run.trigger==='CRON' ? 'Otomasyon' : run.trigger==='MANUAL' ? 'Manuel' : 'Belirtilmemiş',
  }))), ...standalone.map(report => ({ key: `standalone:${report.id}`, id: report.id, runId: '', topicId: null, title: report.title, version: report.latestVersion, targetDate: report.createdAt.slice(0, 10), publishedAt: report.createdAt, card: 'DOCUMENT', creationType: report.automationId ? 'Otomasyon' : 'Manuel', automationId:report.automationId,automationName:report.automationName, standalone: true }))], [runs, standalone])
  const filtered = rows.filter((row) => {
    const matchesQuery = `${row.title} ${row.id} ${row.targetDate} ${row.automationName ?? ''} ${row.creationType}`.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR'))
    return matchesQuery && (filter === 'Tümü' || (filter === 'Değişiklik yok' ? row.card === 'K6' : filter === 'Belge analizi' ? row.standalone : row.card !== 'K6' && !row.standalone))
  }).sort((a, b) => sort === 'date' ? b.targetDate.localeCompare(a.targetDate) : b.publishedAt.localeCompare(a.publishedAt))

  return (
    <div className="atez-page-stack">
      <div className="atez-page-heading">
        <div>
          <Typography.Title level={2}>Raporlar</Typography.Title>
          <Typography.Text type="secondary">Tarama ve belge analizlerinden yayımlanan raporlar ve sürümleri.</Typography.Text>
        </div>
        <StartScanButton onClick={() => navigate('/chat')} />
      </div>
      <Card className="atez-surface-card">
        <Space wrap className="atez-report-toolbar">
          <Input.Search aria-label="Raporlarda ara" placeholder="Raporlarda ara" value={query} onChange={(event) => setQuery(event.target.value)} allowClear style={{ width: 260, maxWidth: '100%' }} />
          <Select aria-label="Rapor içeriği" style={{ width: 200, maxWidth: '100%' }} options={['Tümü', 'Mevzuat raporu', 'Değişiklik yok', 'Belge analizi'].map(value => ({ value, label: value }))} value={filter} onChange={setFilter} />
          <Select aria-label="Rapor sıralaması" value={sort} onChange={setSort} style={{width:210}} options={[{value:'newest',label:'Son oluşturulanlar'},{value:'date',label:'Mevzuat tarihi'}]} />
          <Button icon={<ReloadOutlined />} onClick={() => setReload((value) => value + 1)}>Yenile</Button>
        </Space>
        {standaloneError && <Alert type="warning" showIcon title={standaloneError} style={{ marginBottom: 16 }} />}
        {error && <Alert type="warning" showIcon message={error} style={{ marginBottom: 16 }} />}
        <Table<ReportRow>
          rowKey="key"
          dataSource={filtered}
          loading={loading}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description="Henüz rapor oluşturulmadı." /> }}
          scroll={screens.sm ? { x: 1100 } : undefined}
          columns={[
            { title: 'Rapor', dataIndex: 'title', key: 'title', render: (_value, row) => <><Typography.Text strong>{row.title}</Typography.Text><br /><Typography.Text type="secondary">{row.id.slice(0, 8)}</Typography.Text>{!screens.md && <div className="atez-report-mobile-meta"><Typography.Text type="secondary">{formatDate(row.targetDate)} · v{row.version} · {row.creationType}{row.automationName ? ` · ${row.automationName}` : ''}</Typography.Text><Tag>{row.card === 'K6' ? 'Değişiklik yok' : row.standalone ? 'Belge analizi' : 'Mevzuat raporu'}</Tag></div>}</> },
            { title: 'Mevzuat tarihi', dataIndex: 'targetDate', key: 'date', responsive: ['sm'], render: (value: string) => formatDate(value), sorter: (a, b) => a.targetDate.localeCompare(b.targetDate) },
            { title: 'Tür', key:'creationType',responsive:['md'],width:110,render:(_value,row)=><Tag>{row.creationType}</Tag> },
            { title: 'Otomasyon', key:'automation',responsive:['md'],width:190,render:(_value,row)=>row.automationId ? <ActionLink to={`/automations/${row.automationId}`}>{row.automationName || 'Otomasyon ayrıntıları'}</ActionLink> : <Typography.Text type="secondary">{row.automationName || (row.creationType==='Otomasyon'?'Zamanlanmış tarama':'—')}</Typography.Text> },
            { title: 'Rapor içeriği', dataIndex: 'card', key: 'card', responsive: ['md'], render: (value: string) => <Tag color={value === 'K6' ? 'green' : 'purple'}>{value === 'K6' ? 'Değişiklik yok' : value === 'DOCUMENT' ? 'Belge analizi' : 'Mevzuat raporu'}</Tag> },
            { title: 'Sürüm', dataIndex: 'version', key: 'version', responsive: ['sm'], render: (value: number) => `v${value}` },
            { title: 'İşlemler', key: 'open', width: 236, align: 'right', render: (_value, row) => <div className="atez-report-row-actions"><ActionLink icon={<EyeOutlined aria-hidden />} to={row.standalone ? `/reports/documents/${row.id}` : row.topicId ? `/reports/${row.topicId}` : `/runs/${row.runId}/reports/${row.id}`}>İncele</ActionLink>{canEdit && <ReviseButton type="default" onClick={() => setEditing(row)} />}</div> },
          ]}
        />
      </Card>
      <ReportCorrectionDrawer open={Boolean(editing)} onClose={() => setEditing(null)}>
        <div className="atez-report-correction-content">{editing?.standalone ? <StandaloneReportCorrection key={editing.key} reportId={editing.id}/> : editing && <ReportWorkspace key={editing.key} topicId={editing.topicId ?? editing.id} popup onRevisionSaved={() => setReload(value => value + 1)} />}</div>
      </ReportCorrectionDrawer>
    </div>
  )
}
