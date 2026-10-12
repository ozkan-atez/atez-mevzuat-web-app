import { Can } from '../auth/Can'
import { Alert, Button, Card, Progress, Tag } from 'antd'
import { Link } from 'react-router-dom'
import { AlertCircle, Check, Circle, LoaderCircle } from 'lucide-react'
import type { ScanRunDetail, ScanStage, StageExecutionStatus } from '../scans/types'

const sourceStageLabels: Record<string,string> = { ACCESS: 'Kaynak ve hesap kontrolü', DISCOVERY: 'Liste ve arşiv taraması', CAPTURE: 'Belgeler ve eklerin alınması', VALIDATION: 'İçerik doğrulama', FILTER: 'Gümrük ve dış ticaret filtresi', PREVIOUS_SOURCES: 'Önceki kaynakların değerlendirilmesi', ANALYSIS: 'Belge analizi', REPORT: 'Rapor oluşturma', COMPLETE: 'Tarama envanterinin tamamlanması' }
const steps: Array<{ stage: ScanStage; title: string; description: string }> = [
  { stage: 'DISCOVERING', title: 'Resmî Gazete yayınları bulunuyor', description: 'Ana sayı ve mükerrer yayın bağlantıları bulunuyor.' },
  { stage: 'AI_FILTERING', title: 'Gümrük ve dış ticaret ilgisi belirleniyor', description: 'Başlıklar birlikte değerlendirilir; belirsiz belgeler içerikleriyle kesin olarak ilgili veya ilgisiz sınıflandırılır.' },
  { stage: 'DOWNLOADING_DOCUMENTS', title: 'Belgeler indiriliyor', description: 'Resmî Gazete belgeleri güvenli biçimde arşivleniyor.' },
  { stage: 'DISCOVERING_ASSETS', title: 'Belge ekleri bulunuyor', description: 'Belge içindeki resim ve ek dosya bağlantıları çıkarılıyor.' },
  { stage: 'DOWNLOADING_ASSETS', title: 'Varlıklar indiriliyor', description: 'Keşfedilen resim ve ek dosyalar nesne deposuna yazılıyor.' },
  { stage: 'VALIDATING', title: 'Dosyalar doğrulanıyor', description: 'İndirilen içeriklerin türü, boyutu ve bütünlüğü kontrol ediliyor.' },
  { stage: 'DISCOVERING_PREVIOUS_SOURCES', title: 'Önceki kaynaklar hazırlanıyor', description: 'İlgili her belge için önceki mevzuat kaynağı bağımsız olarak aranır ve arşivlenir.' },
  { stage: 'ANALYZING_TOPICS', title: 'Mevzuat değişiklikleri analiz ediliyor', description: 'Her ilgili belge, kaynaklarıyla birlikte bağımsız bir işlem olarak analiz edilir.' },
  { stage: 'GENERATING_REPORTS', title: 'Raporlar oluşturuluyor', description: 'Tamamlanan analizlerden doğrulanmış ATEZ bültenleri hazırlanır.' },
  { stage: 'WRITING_MANIFEST', title: 'Tarama kaydı tamamlanıyor', description: 'Çalışmanın denetlenebilir dosya envanteri oluşturuluyor.' },
]

function resolveStatus(run: ScanRunDetail, stage: ScanStage): StageExecutionStatus {
  return run.stages.find((item) => item.stage === stage)?.status
    ?? (run.currentStage === stage ? 'RUNNING' : 'PENDING')
}

interface OperationStepsProps {
  run: ScanRunDetail
  onRetryAiFilter: () => void
  onRetryPreviousSources: () => void
  isRetrying: boolean
  retryError: string | null
}

export function OperationSteps({ run, onRetryAiFilter, onRetryPreviousSources, isRetrying, retryError }: OperationStepsProps) {
  const hasGazette = run.sourceKeys ? run.sourceKeys.includes('resmi-gazete') : !run.sourceRuns?.length || run.editions.some(edition => edition.type !== 'EXTERNAL')
  const sourceKeys = run.sourceKeys?.filter(key => key !== 'resmi-gazete') ?? run.sourceRuns?.map(source => source.source.key) ?? []
  const sourceLabels: Record<string, string> = { 'ticaret-bakanligi': 'Ticaret Bakanlığı', tariff: 'TARIFF', igmd: 'İGMD', 'mevzuat-net': 'Mevzuat.net' }
  return (
    <Card className="atez-run-card" title="Operasyon adımları" extra={<span>Her adım sırayla işlenir.</span>}>

      <ol className="atez-operation-list">
        {sourceKeys.map(key => {
          const source = run.sourceRuns?.find(item => item.source.key === key)
          const status = source?.status ?? (['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(run.status) ? 'CANCELLED' : 'QUEUED')
          const label = source?.source.name ?? sourceLabels[key] ?? key
          return <li key={key} className="atez-operation-step">
            <div className="min-w-0 flex-1">
              <div className="atez-operation-heading"><h3 className="atez-operation-title">{label}</h3><Tag color={status === 'COMPLETED' ? 'success' : status === 'RUNNING' ? 'processing' : status === 'FAILED' ? 'error' : status === 'PARTIAL' ? 'warning' : 'default'}>{status === 'COMPLETED' ? 'Tamamlandı' : status === 'RUNNING' ? 'İşleniyor' : status === 'FAILED' ? 'Hatalı' : status === 'PARTIAL' ? 'Kısmen tamamlandı' : status === 'CANCELLED' ? 'Çalıştırılmadı' : 'Bekliyor'}</Tag></div>
              <p className="atez-operation-description">Otomasyonun tarih ve içerik seçimine göre kayıtlar taranır; belgeler ve ekleri alınır, ilgili içerikler analiz edilerek raporlanır.</p>
              {source && <p>{source.documentCount} belge · <Link to={`/source-runs/${source.id}`}>Belgeleri ve işlem ayrıntılarını incele</Link></p>}
              {Boolean(source?.stages?.length) && <ol style={{paddingLeft:18,marginTop:12}}>{source?.stages?.slice().sort((a,b)=>Object.keys(sourceStageLabels).indexOf(a.stage)-Object.keys(sourceStageLabels).indexOf(b.stage)).map(stage => <li key={stage.stage} style={{marginBottom:8}}><span>{sourceStageLabels[stage.stage]??stage.stage}</span> <Tag color={stage.status==='COMPLETED'?'success':stage.status==='RUNNING'?'processing':['BLOCKED','FAILED','PARTIAL'].includes(stage.status)?'warning':'default'}>{stage.status==='COMPLETED'?'Tamamlandı':stage.status==='RUNNING'?'İşleniyor':stage.status==='SKIPPED'?(source?.documentCount===0?'Belge yok · gerekmedi':'Uygulanmıyor'):stage.status==='BLOCKED'?'Müdahale gerekli':stage.status==='PARTIAL'?'Eksik kapsam':stage.status==='FAILED'?'Hata':'Bekliyor'}</Tag>{stage.totalItems>0&&<small>{stage.completedItems}/{stage.totalItems}</small>}</li>)}</ol>}
              {source?.notes?.map(note=><Alert key={note} type="info" title={note} />)}
              {source?.errorSummary && <Alert type={status === 'FAILED' ? 'error' : 'warning'} title={source.errorSummary} />}
            </div>
          </li>
        })}
        {(hasGazette ? steps : []).map((step, index) => {
          const status = resolveStatus(run, step.stage)
          const execution = run.stages.find((item) => item.stage === step.stage)
          return (
            <li key={step.stage} className="atez-operation-step">
              <div className={`atez-operation-icon is-${status.toLowerCase()}`}>
                {status === 'COMPLETED' && <Check size={14} />}
                {status === 'RUNNING' && <LoaderCircle size={14} className="animate-spin" />}
                {status === 'FAILED' && <AlertCircle size={14} />}
                {status === 'AWAITING_RETRY' && <AlertCircle size={14} />}
                {status === 'PENDING' && <Circle size={12} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="atez-operation-heading">
                  <h3 className="atez-operation-title"><span aria-hidden="true">{index + 1}. </span><span>{step.title}</span></h3>
                  <Tag color={status === 'COMPLETED' ? 'success' : status === 'RUNNING' ? 'processing' : status === 'FAILED' ? 'error' : status === 'AWAITING_RETRY' ? 'warning' : 'default'}>
                    {status === 'COMPLETED' ? 'Tamamlandı' : status === 'RUNNING' ? 'İşleniyor' : status === 'AWAITING_RETRY' ? 'Yeniden deneme bekliyor' : status === 'FAILED' ? 'Hatalı' : 'Bekliyor'}
                  </Tag>
                </div>
                <p className="atez-operation-description">{step.description}</p>
                {execution && execution.totalItems > 0 && (
                  <div className="atez-run-progress"><Progress strokeColor={status === 'FAILED' ? 'var(--atez-error)' : status === 'COMPLETED' ? 'var(--atez-success)' : 'var(--atez-accent)'} railColor="var(--atez-border)" percent={Math.round(execution.completedItems / execution.totalItems * 100)} size="small" showInfo={false} /><span>{execution.completedItems}/{execution.totalItems} tamamlandı{execution.failedItems > 0 ? ` · ${execution.failedItems} hatalı` : ''}</span></div>
                )}
                {step.stage === 'AI_FILTERING' && run.filter?.retryAvailable && (
                  <div className="mt-3">
                    <Can permission="analysis.run"><Button onClick={onRetryAiFilter} loading={isRetrying}>AI filtresini tekrar dene</Button></Can>
                    {retryError && <p className="mt-2 text-xs font-medium text-red-600">{retryError}</p>}
                  </div>
                )}
                {step.stage === 'DISCOVERING_PREVIOUS_SOURCES' && run.previousSources?.retryAvailable && (
                  <div className="mt-3">
                    <Can permission="analysis.run"><Button onClick={onRetryPreviousSources} loading={isRetrying}>Önceki kaynakları tekrar dene</Button></Can>
                    {retryError && <p className="mt-2 text-xs font-medium text-red-600">{retryError}</p>}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
