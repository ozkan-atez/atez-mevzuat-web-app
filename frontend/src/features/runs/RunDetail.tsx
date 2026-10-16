import { RunFlow } from './RunFlow'
import { ActionLink, PageToolbar } from '../../components/layout/PageToolbar'
import { useState } from 'react'
import { Alert, Button, Card, Result, Skeleton, Statistic, Tag } from 'antd'
import { CalendarDays } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { retryAiFilter, retryPreviousSources } from '../scans/api'
import { useScanRun } from '../scans/useScanRun'
import type { ScanRunStatus } from '../scans/types'
import { CollectedDocuments } from './CollectedDocuments'
import { OperationSteps } from './OperationSteps'
import './runs.css'

const statusLabels: Record<ScanRunStatus, string> = {
  QUEUED: 'Sırada', RUNNING: 'Çalışıyor', AWAITING_RETRY: 'Yeniden deneme bekliyor', COMPLETED: 'Tamamlandı', PARTIAL: 'Kısmen tamamlandı', FAILED: 'Başarısız', CANCELLED: 'İptal edildi',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long', timeZone: 'Europe/Istanbul' }).format(new Date(`${value}T12:00:00+03:00`))
}

export function RunDetail() {
  const { id } = useParams<{ id: string }>()
  const { run, isLoading, notFound, error, refresh, reconnect } = useScanRun(id)
  const [isRetrying, setIsRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  const handleRetry = async (kind: 'filter' | 'previous-sources') => {
    if (!id || isRetrying) return
    setIsRetrying(true)
    setRetryError(null)
    try {
      await (kind === 'filter' ? retryAiFilter(id) : retryPreviousSources(id))
      await reconnect()
    } catch (caught) {
      setRetryError(caught instanceof Error ? caught.message : 'İşlem yeniden başlatılamadı')
    } finally {
      setIsRetrying(false)
    }
  }

  if (isLoading) {
    return <Card className="atez-run-card"><Skeleton active paragraph={{ rows: 5 }} /></Card>
  }

  if (notFound) {
    return <Result status="404" title="Tarama bulunamadı" subTitle="Bu çalışma silinmiş olabilir veya bağlantı geçersizdir." extra={<ActionLink to="/" type="primary">Ana sayfaya dön</ActionLink>} />
  }

  if (!run) {
    return <Alert type="error" showIcon message={error || 'Tarama bilgileri alınamadı.'} action={<Button onClick={() => void refresh()}>Tekrar dene</Button>} />
  }

  return (
    <div className="atez-run-page">
      <PageToolbar backTo="/" backLabel="Taramalara dön" />

      <div
        data-testid="run-overview"
        className="atez-run-overview"
      >
        <section className="atez-run-hero">
          <div className="atez-run-hero-content">
            <div>
              <div className="atez-run-date"><CalendarDays className="h-4 w-4" />{formatDate(run.targetDate)}</div>
              <h1>Çalışma özeti</h1>
              <p>{[...(run.sourceKeys?.includes('resmi-gazete') || !run.sourceKeys ? ['Resmî Gazete'] : []), ...(run.sourceRuns ?? []).map(source => source.source.name)].join(' · ') || 'Seçilen kaynaklar'}</p>
            </div>
            <Tag color={run.status === 'COMPLETED' ? 'success' : run.status === 'FAILED' ? 'error' : 'processing'}>{statusLabels[run.status]}</Tag>
          </div>
        </section>

        <section aria-label="Operasyon özeti" className="atez-run-metrics">
          <Card className="atez-run-card"><Statistic title="Taranan madde" value={run.counts.documents} /><span>Seçilen kaynaklardan toplanan kayıt</span></Card>
          <Card className="atez-run-card"><Statistic title="İlgili mevzuat" value={run.editions.flatMap(edition => edition.documents).filter(document => document.filter?.finalDecision === 'IN').length || run.filter?.counts.in || 0} /><span>Şirket operasyonlarını ilgilendiren değişiklik</span></Card>
        </section>
      </div>

      {run.errorSummary && <Alert type={run.status === 'PARTIAL' ? 'warning' : 'error'} message={run.errorSummary} showIcon />}
      {error && (
        <Alert type="warning" message={error} showIcon action={<Button onClick={() => void refresh()}>Yenile</Button>} />
      )}

      <RunFlow run={run} />
      <section className="run-report-results" aria-label="Oluşturulan raporlar">
        <h2 className="atez-run-section-title">Oluşturulan raporlar</h2>
        {run.reports?.length ? <div className="run-report-list">{run.reports.map(report=><Link key={report.id} to={`/runs/${run.id}/reports/${report.id}`}><div><strong>{report.card==='K6'?'Değişiklik bulunmadı':report.title}</strong><small>{report.card==='K6'?'Bu çalışmada raporlanacak yeni değişiklik tespit edilmedi.':`Sürüm ${report.version}`}</small></div><span>{report.card==='K6'?'Değişiklik yok raporunu aç':'Raporu aç'} →</span></Link>)}</div> : <p className="atez-run-card-subtitle">{run.status==='COMPLETED'?'Bu çalışmada oluşturulmuş rapor bulunmuyor.':'Henüz rapor oluşturulmadı. Çalışma durumunu yukarıdaki akıştan takip edebilirsiniz.'}</p>}
      </section>
      <details className="run-secondary-details"><summary>Belgeler ve kapsam sonuçları · {run.counts.documents}</summary><CollectedDocuments editions={run.editions} /></details>
      <details className="run-secondary-details"><summary>İşlem ayrıntıları ve yeniden deneme</summary><OperationSteps run={run} onRetryAiFilter={() => void handleRetry('filter')} onRetryPreviousSources={() => void handleRetry('previous-sources')} isRetrying={isRetrying} retryError={retryError} /></details>

    </div>
  )
}
