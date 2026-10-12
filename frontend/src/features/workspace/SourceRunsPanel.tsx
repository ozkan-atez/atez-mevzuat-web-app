import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Space, Table, Tag, Typography } from 'antd'
import { Link } from 'react-router-dom'
import { listSourceRuns, SOURCE_RUN_LABELS } from './sourceRunsApi'
import type { SourceRunSummary } from './sourceRunsApi'
export function SourceRunsPanel() {
  const [runs, setRuns] = useState<SourceRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => { setLoading(true); try { setRuns((await listSourceRuns()).runs); setError(null) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Tarama kayıtları alınamadı.') } finally { setLoading(false) } }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (!runs.some((run) => ['QUEUED', 'RUNNING'].includes(run.status))) return; const timer = setInterval(() => void load(), 5000); return () => clearInterval(timer) }, [runs, load])
  return <Card title="Kaynak tarama geçmişi" extra={<Button loading={loading} onClick={() => void load()}>Yenile</Button>}>
    {error && <Alert type="error" title={error} showIcon />}
    <Table rowKey="id" loading={loading} dataSource={runs} pagination={{ pageSize: 8 }} scroll={{ x: 850 }} columns={[
      { title: 'Kaynak', key: 'source', render: (_, run) => run.source.name },
      { title: 'Tarih', dataIndex: 'targetDate', render: (value: string) => value.slice(0, 10) },
      { title: 'Durum', dataIndex: 'status', render: (value: string, run) => <Tag color={run.canAnalyze ? 'warning' : value === 'COMPLETED' ? 'success' : value === 'FAILED' ? 'error' : 'processing'}>{run.canAnalyze ? 'AI değerlendirmesi bekliyor' : SOURCE_RUN_LABELS[value] ?? value}</Tag> },
      { title: 'Belgeler / AI sonucu', key: 'count', render: (_, run) => <Space orientation="vertical"><Typography.Text>{run.counters?.found ?? run._count.documents} belge bulundu</Typography.Text>{run.counters && <Typography.Text type="secondary">{run.counters.relevant} ilgili · {run.counters.excluded} kapsam dışı · {run.counters.failed} başarısız</Typography.Text>}</Space> },
      { title: 'Hazır rapor', key: 'reports', render: (_, run) => run.counters ? <Tag color={run.counters.readyReports ? 'success' : 'default'}>{run.counters.readyReports}</Tag> : 'Henüz doğrulanmadı' },
      { title: 'İşlem', key: 'detail', render: (_, run) => <Space wrap><Link to={`/source-runs/${run.id}`}>Belgeleri ve raporları aç</Link>{run.scanRunId && <Link to={`/runs/${run.scanRunId}`}>Ana tarama</Link>}</Space> },
    ]} />
  </Card>
}
