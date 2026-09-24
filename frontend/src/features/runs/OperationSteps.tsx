import { useState } from 'react'
import type { ScanRunDetail, ScanStage, StageExecutionStatus } from '../scans/types'
import './OperationSteps.css'
import { ProcessMarker, ProcessTimeline } from '../../components/progress/ProcessTimeline'

interface OperationStep {
  stage: ScanStage
  title: string
  description: string
}

interface OperationGroup {
  id: string
  title: string
  steps: OperationStep[]
}

const groups: OperationGroup[] = [
  {
    id: 'scanning',
    title: 'Tarama',
    steps: [
      { stage: 'DISCOVERING', title: 'Resmî Gazete yayınları bulunuyor', description: 'Ana sayı ve mükerrer yayın bağlantıları bulunuyor.' },
    ],
  },
  {
    id: 'filtering',
    title: 'Filtreleme',
    steps: [
      { stage: 'AI_FILTERING', title: 'Gümrük ve dış ticaret ilgisi belirleniyor', description: 'Başlıklar birlikte değerlendirilir; belirsiz belgeler içerikleriyle kesin olarak ilgili veya ilgisiz sınıflandırılır.' },
    ],
  },
  {
    id: 'preparation',
    title: 'Hazırlık',
    steps: [
      { stage: 'DOWNLOADING_DOCUMENTS', title: 'Belgeler indiriliyor', description: 'Resmî Gazete belgeleri güvenli biçimde arşivleniyor.' },
      { stage: 'DISCOVERING_ASSETS', title: 'Belge ekleri bulunuyor', description: 'Belge içindeki resim ve ek dosya bağlantıları çıkarılıyor.' },
      { stage: 'DOWNLOADING_ASSETS', title: 'Varlıklar indiriliyor', description: 'Keşfedilen resim ve ek dosyalar nesne deposuna yazılıyor.' },
      { stage: 'VALIDATING', title: 'Dosyalar doğrulanıyor', description: 'İndirilen içeriklerin türü, boyutu ve bütünlüğü kontrol ediliyor.' },
    ],
  },
  {
    id: 'analysis',
    title: 'Analiz',
    steps: [
      { stage: 'DISCOVERING_PREVIOUS_SOURCES', title: 'Önceki kaynaklar hazırlanıyor', description: 'İlgili her belge için önceki mevzuat kaynağı bağımsız olarak aranır ve arşivlenir.' },
      { stage: 'ANALYZING_TOPICS', title: 'Mevzuat değişiklikleri analiz ediliyor', description: 'Her ilgili belge, kaynaklarıyla birlikte bağımsız bir işlem olarak analiz edilir.' },
    ],
  },
  {
    id: 'reporting',
    title: 'Raporlama',
    steps: [
      { stage: 'GENERATING_REPORTS', title: 'Raporlar oluşturuluyor', description: 'Tamamlanan analizlerden doğrulanmış ATEZ bültenleri hazırlanır.' },
      { stage: 'WRITING_MANIFEST', title: 'Tarama kaydı tamamlanıyor', description: 'Çalışmanın denetlenebilir dosya envanteri oluşturuluyor.' },
    ],
  },
]

const sourceGroups: OperationGroup[] = [
  { id: 'scanning', title: 'Tarama', steps: [{ stage: 'DISCOVERING', title: 'Seçilen kaynaklar taranıyor', description: 'Tarihli belge ve duyurular kaynaklara göre toplanıyor.' }] },
  { id: 'preparation', title: 'Doğrulama', steps: [{ stage: 'VALIDATING', title: 'Kaynak sonuçları doğrulanıyor', description: 'Toplanan bağlantılar ve kaynak durumları kontrol ediliyor.' }] },
  { id: 'reporting', title: 'Raporlama', steps: [
    { stage: 'GENERATING_REPORTS', title: 'Kaynak raporları hazırlanıyor', description: 'Her kaynak için bulunan kayıtların raporu hazırlanıyor.' },
    { stage: 'WRITING_MANIFEST', title: 'Tarama kaydı tamamlanıyor', description: 'Kaynak sonuçları aynı tarama kimliğiyle kaydediliyor.' },
  ] },
]

const statusLabels: Record<StageExecutionStatus, string> = {
  COMPLETED: 'Tamamlandı',
  RUNNING: 'İşleniyor',
  AWAITING_RETRY: 'Yeniden deneme bekliyor',
  FAILED: 'Hatalı',
  PENDING: 'Bekliyor',
}

function resolveStatus(run: ScanRunDetail, stage: ScanStage): StageExecutionStatus {
  return run.stages.find((item) => item.stage === stage)?.status
    ?? (run.currentStage === stage ? 'RUNNING' : 'PENDING')
}

function resolveGroupStatus(run: ScanRunDetail, group: OperationGroup): StageExecutionStatus {
  const statuses = group.steps.map((step) => resolveStatus(run, step.stage))
  if (statuses.includes('FAILED')) return 'FAILED'
  if (statuses.includes('AWAITING_RETRY')) return 'AWAITING_RETRY'
  if (statuses.includes('RUNNING')) return 'RUNNING'
  if (statuses.every((status) => status === 'COMPLETED')) return 'COMPLETED'
  return 'PENDING'
}

const statusTextStyles: Record<StageExecutionStatus, string> = {
  COMPLETED: 'text-emerald-300',
  RUNNING: 'text-indigo-300',
  FAILED: 'text-rose-300',
  AWAITING_RETRY: 'text-amber-300',
  PENDING: 'text-slate-400',
}

function StatusBadge({ status }: { status: StageExecutionStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${statusTextStyles[status]}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${status === 'RUNNING' ? 'animate-pulse' : ''}`} />
      {statusLabels[status]}
    </span>
  )
}

function sourceStatus(status: string): StageExecutionStatus {
  if (status === 'COMPLETED') return 'COMPLETED'
  if (status === 'RUNNING' || status === 'QUEUED') return status === 'RUNNING' ? 'RUNNING' : 'PENDING'
  return status === 'PARTIAL' ? 'AWAITING_RETRY' : 'FAILED'
}

interface OperationStepsProps {
  run: ScanRunDetail
  onRetryTopic: (topicId: string) => void
  retryingTopicId: string | null
}

export function OperationSteps({ run, onRetryTopic, retryingTopicId }: OperationStepsProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const activeGroups = run.sourceKeys?.includes('resmi-gazete') === false ? sourceGroups : groups

  const toggleGroup = (groupId: string) => {
    setOpenGroup((current) => current === groupId ? null : groupId)
  }

  const statuses = activeGroups.map((group) => resolveGroupStatus(run, group))
  const lastReached = statuses.reduce((last, status, index) => status !== 'PENDING' ? index : last, 0)
  const completedGroups = statuses.filter((status) => status === 'COMPLETED').length

  return (
    <section aria-labelledby="operation-steps-heading" className="operation-steps relative mt-6 border-t border-white/10 pt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="operation-steps-heading" className="text-base font-bold text-white">Operasyon Adımları</h2>
          <p className="mt-1 text-xs text-slate-400">Taramadan raporlamaya kadar tüm aşamalar. Alt adımlar için bir durum noktasını seçin.</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
          {completedGroups}/{activeGroups.length} aşama tamamlandı
        </span>
      </div>
      <ProcessTimeline
        columns={activeGroups.length === 3 ? 3 : 5}
        stackOnMobile
        progress={lastReached / (activeGroups.length - 1)}
        items={activeGroups.map((group, groupIndex) => {
          const status = statuses[groupIndex]
          const isOpen = openGroup === group.id
          return {
            id: group.id,
            marker: (
              <button
                type="button"
                aria-label={`Durum noktası: ${group.title} — ${statusLabels[status]}`}
                aria-expanded={isOpen}
                aria-controls={`operation-group-${group.id}`}
                onClick={() => toggleGroup(group.id)}
                className="relative z-20 rounded-full p-1.5 -m-1.5 cursor-pointer transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
              >
                <ProcessMarker status={status === 'AWAITING_RETRY' ? 'ATTENTION' : status} />
              </button>
            ),
            content: (
              <span className={`text-sm font-semibold ${isOpen ? 'text-white' : 'text-slate-300'}`}>{group.title}</span>
            ),
          }
        })}
      />
      {activeGroups.filter((group) => openGroup === group.id).map((group) => (
        <div key={group.id} id={`operation-group-${group.id}`} role="region" aria-label={`${group.title} alt adımları`} className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-slate-950/20">
          <ol className="px-4">
            {group.steps.map((step) => {
              const stepStatus = resolveStatus(run, step.stage)
              const execution = run.stages.find((item) => item.stage === step.stage)
              return (
                <li key={step.stage} className="flex min-w-0 flex-col gap-2 border-b border-white/5 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs font-medium text-slate-200">{step.title}</h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{step.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
                    <StatusBadge status={stepStatus} />
                    {execution && execution.totalItems > 0 && (
                      <span className="text-[11px] tabular-nums text-slate-400">
                        {execution.completedItems}/{execution.totalItems} tamamlandı
                        {execution.failedItems > 0 ? ` · ${execution.failedItems} hatalı` : ''}
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
            {group.id === 'scanning' && run.sourceResults?.map((source) => {
              const status = sourceStatus(source.status)
              return <li key={`source-scan-${source.id}`} className="flex min-w-0 flex-col gap-2 border-b border-white/5 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs font-medium text-slate-200">{source.sourceName} kaynağı {status === 'COMPLETED' ? 'tarandı' : 'taranıyor'}</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{source.documentCount > 0 ? `${source.documentCount} tarihli mevzuat kaydı bulundu.` : 'İlgili gün için yeni mevzuat kaydı bulunmadı.'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-1"><StatusBadge status={status} /><span className="text-[11px] tabular-nums text-slate-400">{source.documentCount} kayıt</span></div>
              </li>
            })}
            {group.id === 'reporting' && run.sourceResults?.filter((source) => source.documentCount > 0).map((source) => {
              const status = source.hasReport ? 'COMPLETED' : sourceStatus(source.status)
              return <li key={`source-report-${source.id}`} className="flex min-w-0 flex-col gap-2 border-b border-white/5 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0 flex-1"><h3 className="text-xs font-medium text-slate-200">{source.sourceName} raporu {status === 'COMPLETED' ? 'hazırlandı' : 'hazırlanıyor'}</h3><p className="mt-1 text-[11px] leading-relaxed text-slate-400">Bulunan mevzuat kayıtları ATEZ bülten şablonuyla raporlanıyor.</p></div>
                <StatusBadge status={status} />
              </li>
            })}
            {group.id === 'reporting' && ((run.reports?.length ?? 0) + (run.sourceResults?.filter((source) => source.hasReport).length ?? 0) > 1) && (() => {
              const status = run.reportDuplicateStatus === 'COMPLETED' ? 'COMPLETED' : run.reportDuplicateStatus === 'RUNNING' ? 'RUNNING' : run.reportDuplicateStatus === 'FAILED' ? 'FAILED' : 'PENDING'
              return <li className="flex min-w-0 flex-col gap-2 border-b border-white/5 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0 flex-1"><h3 className="text-xs font-medium text-slate-200">Mükerrer raporlar kontrol ediliyor</h3><p className="mt-1 text-[11px] leading-relaxed text-slate-400">Aynı mevzuatın Resmî Gazete metni, özeti veya yorumu olarak tekrar sunulan raporlar karşılaştırılıyor.</p>{run.reportDuplicateError && <p className="mt-1 text-[11px] text-rose-300">{run.reportDuplicateError}</p>}</div>
                <StatusBadge status={status} />
              </li>
            })()}
          </ol>
          {group.id === 'analysis' && run.analysis?.topics.some((topic) => topic.retryAvailable) && (
            <div className="border-t border-white/10 px-4 py-3">
              <p className="mb-2 text-xs font-medium text-amber-200">Yeniden deneme bekleyen analizler</p>
              <ul className="space-y-2">
                {run.analysis.topics.filter((topic) => topic.retryAvailable).map((topic) => (
                  <li key={topic.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
                    <span className="min-w-0 break-words">{topic.title}</span>
                    <button
                      type="button"
                      onClick={() => onRetryTopic(topic.id)}
                      disabled={retryingTopicId !== null}
                      className="rounded-md border border-amber-400/25 bg-amber-400/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-200 transition hover:bg-amber-400/20 disabled:cursor-wait disabled:opacity-60"
                    >
                      {retryingTopicId === topic.id ? 'Yeniden başlatılıyor…' : 'Analizi tekrar dene'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
