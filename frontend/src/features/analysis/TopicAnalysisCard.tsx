import { Can } from '../auth/Can'
import { Alert, Button, Card, Spin, Tag, Typography } from 'antd'
import { CheckCircleOutlined, FileTextOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import type { TopicSummary } from './types'
import './analysis.css'

const labels: Record<TopicSummary['status'], string> = {
  QUEUED: 'Sırada', ANALYZING: 'Analiz ediliyor', ANALYZED: 'Analiz tamamlandı', RENDERING: 'Rapor hazırlanıyor', VALIDATING: 'Rapor doğrulanıyor',
  COMPLETED: 'Tamamlandı', AWAITING_RETRY: 'Yeniden deneme bekliyor', BLOCKED: 'İnceleme gerekli', FAILED: 'Başarısız',
}

export function TopicAnalysisCard({ topic, onRetry, isRetrying = false }: { topic: TopicSummary; onRetry: (topicId: string) => void; isRetrying?: boolean }) {
  const errorMessage = topic.errorCategory === 'INVALID_RESPONSE' && topic.errorMessage?.trim().startsWith('[')
    ? 'Analiz çıktısı içerik doğrulamasından geçmedi. Analizin yeniden hazırlanması gerekiyor.'
    : topic.errorMessage
  const active = ['ANALYZING', 'RENDERING', 'VALIDATING'].includes(topic.status)
  return (
    <Card className="atez-surface-card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Typography.Text type="secondary" className="text-[11px] font-bold uppercase tracking-wider">Topic analizi</Typography.Text>
          <Typography.Title level={5} style={{ margin: '4px 0 0' }}>{topic.title}</Typography.Title>
        </div>
        <Tag color={topic.status === 'COMPLETED' ? 'success' : active ? 'processing' : 'warning'} icon={active ? <Spin size="small" /> : topic.status === 'COMPLETED' ? <CheckCircleOutlined /> : <WarningOutlined />}>
          {labels[topic.status]}
        </Tag>
      </div>
      {errorMessage && <Alert style={{ marginTop: 12 }} type="warning" showIcon title={errorMessage} />}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {topic.reportVersion && <Link className="atez-topic-report-link" to={`/reports/${topic.id}?revision=${topic.reportVersion}`}><FileTextOutlined /> Raporu aç</Link>}
        {topic.retryAvailable && <Can permission="analysis.run"><Button aria-label="Analizi tekrar dene" icon={<ReloadOutlined />} loading={isRetrying} onClick={() => onRetry(topic.id)}>Analizi tekrar dene</Button></Can>}
        {topic.analysisVersion && <Typography.Text type="secondary">Analiz r{String(topic.analysisVersion).padStart(2, '0')}</Typography.Text>}
      </div>
    </Card>
  )
}
