import { AlertCircle, Check, Circle, LoaderCircle } from 'lucide-react'
import type { ScanRunDetail, ScanStage, StageExecutionStatus } from '../scans/types'

const steps: Array<{ stage: ScanStage; title: string; description: string }> = [
  { stage: 'DISCOVERING', title: 'Resmî Gazete yayınları bulunuyor', description: 'Ana sayı ve mükerrer yayın bağlantıları bulunuyor.' },
  { stage: 'DOWNLOADING_DOCUMENTS', title: 'Belgeler indiriliyor', description: 'Resmî Gazete belgeleri güvenli biçimde arşivleniyor.' },
  { stage: 'DISCOVERING_ASSETS', title: 'Belge ekleri bulunuyor', description: 'Belge içindeki resim ve ek dosya bağlantıları çıkarılıyor.' },
  { stage: 'DOWNLOADING_ASSETS', title: 'Varlıklar indiriliyor', description: 'Keşfedilen resim ve ek dosyalar nesne deposuna yazılıyor.' },
  { stage: 'VALIDATING', title: 'Dosyalar doğrulanıyor', description: 'İndirilen içeriklerin türü, boyutu ve bütünlüğü kontrol ediliyor.' },
  { stage: 'WRITING_MANIFEST', title: 'Tarama kaydı tamamlanıyor', description: 'Çalışmanın denetlenebilir dosya envanteri oluşturuluyor.' },
]

function resolveStatus(run: ScanRunDetail, stage: ScanStage): StageExecutionStatus {
  return run.stages.find((item) => item.stage === stage)?.status
    ?? (run.currentStage === stage ? 'RUNNING' : 'PENDING')
}

export function OperationSteps({ run }: { run: ScanRunDetail }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
        <h2 className="font-bold text-slate-900">Operasyon Adımları</h2>
        <p className="mt-1 text-sm text-slate-500">Her adım tamamlandıktan sonra sıradaki işlem başlar.</p>
      </div>
      <ol className="divide-y divide-slate-100 px-5 sm:px-6">
        {steps.map((step, index) => {
          const status = resolveStatus(run, step.stage)
          const execution = run.stages.find((item) => item.stage === step.stage)
          return (
            <li key={step.stage} className="flex gap-4 py-4">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50">
                {status === 'COMPLETED' && <Check className="h-4 w-4 text-emerald-600" />}
                {status === 'RUNNING' && <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" />}
                {status === 'FAILED' && <AlertCircle className="h-4 w-4 text-red-600" />}
                {status === 'PENDING' && <Circle className="h-3 w-3 text-slate-400" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900"><span aria-hidden="true">{index + 1}. </span><span>{step.title}</span></h3>
                  <span className="text-xs font-medium text-slate-500">
                    {status === 'COMPLETED' ? 'Tamamlandı' : status === 'RUNNING' ? 'İşleniyor' : status === 'FAILED' ? 'Hatalı' : 'Bekliyor'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{step.description}</p>
                {execution && execution.totalItems > 0 && (
                  <p className="mt-2 text-xs font-medium text-slate-500">
                    {execution.completedItems}/{execution.totalItems} tamamlandı
                    {execution.failedItems > 0 ? ` · ${execution.failedItems} hatalı` : ''}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
