import { ActionLink, PageToolbar } from '../../components/layout/PageToolbar'
import { useState } from 'react'
import { Alert, Button, Card, Result, Skeleton, Statistic, Tag } from 'antd'
import { CalendarDays } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { retryAiFilter, retryPreviousSources } from '../scans/api'
import { retryTopicAnalysis } from '../analysis/api'
import { TopicAnalysisCard } from '../analysis/TopicAnalysisCard'
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
  const [retryingTopicId, setRetryingTopicId] = useState<string | null>(null)

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

  const handleTopicRetry = async (topicId: string) => {
    if (retryingTopicId) return
    setRetryingTopicId(topicId)
    setRetryError(null)
    try {
      await retryTopicAnalysis(topicId)
      await reconnect()
    } catch (caught) {
      setRetryError(caught instanceof Error ? caught.message : 'Topic analizi yeniden başlatılamadı')
    } finally {
      setRetryingTopicId(null)
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
              <h1>Tarama İnceleme Masası</h1>
              <p>{[...(run.sourceKeys?.includes('resmi-gazete') || !run.sourceKeys ? ['Resmî Gazete'] : []), ...(run.sourceRuns ?? []).map(source => source.source.name)].join(' · ') || 'Seçilen kaynaklar'} · {run.id}</p>
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

      <div className="atez-run-workbench">
        <OperationSteps
          run={run}
          onRetryAiFilter={() => void handleRetry('filter')}
          onRetryPreviousSources={() => void handleRetry('previous-sources')}
          isRetrying={isRetrying}
          retryError={retryError}
        />
        <CollectedDocuments editions={run.editions} />
      </div>

      {(run.analysis?.topics.length ?? 0) > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="atez-run-section-title">İlgili mevzuat analizleri</h2>
            <p className="atez-run-card-subtitle">Her belge bağımsız analiz edilir ve tek bir bülten üretir.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {run.analysis?.topics.map((topic) => (
              <TopicAnalysisCard key={topic.id} topic={topic} onRetry={(topicId) => void handleTopicRetry(topicId)} isRetrying={retryingTopicId === topic.id} />
            ))}
          </div>
        </section>
      )}

      {run.reports?.find((report) => report.card === 'K6') && (
        <section className="atez-run-empty-day">
          <h2 className="font-bold text-emerald-950">Değişiklik bulunmadı</h2>
          <p className="mt-1 text-sm text-emerald-800">Bu tarihte gümrük ve dış ticaretle ilgili bir mevzuat değişikliği tespit edilmedi.</p>
          <Link to={`/runs/${run.id}/reports/${run.reports.find((report) => report.card === 'K6')?.id}`}><Button type="primary">Değişiklik yok raporunu aç</Button></Link>
        </section>
      )}
    </div>
  )
}
