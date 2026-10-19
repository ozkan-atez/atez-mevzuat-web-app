import {useState} from 'react'
import {Select} from 'antd'
import {Check, Circle, Clock3, Info, LoaderCircle, Minus, TriangleAlert} from 'lucide-react'
import type {ScanRunDetail} from '../scans/types'

const stages = [
  {title:'Kaynak tarama', source:['ACCESS','DISCOVERY'], gazette:['DISCOVERING']},
  {title:'Belge toplama', source:['CAPTURE','VALIDATION'], gazette:['DOWNLOADING_DOCUMENTS','DISCOVERING_ASSETS','DOWNLOADING_ASSETS','VALIDATING']},
  {title:'Kapsam değerlendirme', source:['FILTER'], gazette:['AI_FILTERING']},
  {title:'Analiz ve karşılaştırma', source:['PREVIOUS_SOURCES','ANALYSIS'], gazette:['DISCOVERING_PREVIOUS_SOURCES','ANALYZING_TOPICS']},
  {title:'Rapor hazırlama', source:['REPORT','COMPLETE'], gazette:['GENERATING_REPORTS','WRITING_MANIFEST']},
]
const activities: Record<string,string> = {
  ACCESS:'Kaynak bağlantısı', DISCOVERY:'Yayınların taranması', DISCOVERING:'Ana sayı ve mükerrerlerin taranması',
  CAPTURE:'Belgeler ve ekler', DOWNLOADING_DOCUMENTS:'Belgelerin alınması', DISCOVERING_ASSETS:'Belge eklerinin bulunması', DOWNLOADING_ASSETS:'Eklerin alınması',
  VALIDATION:'İçerik doğrulama', VALIDATING:'İçerik doğrulama', FILTER:'Gümrük ve dış ticaret değerlendirmesi', AI_FILTERING:'Gümrük ve dış ticaret değerlendirmesi',
  PREVIOUS_SOURCES:'Önceki kaynakların araştırılması', DISCOVERING_PREVIOUS_SOURCES:'Önceki kaynakların araştırılması',
  ANALYSIS:'İlgili belgelerin analizi', ANALYZING_TOPICS:'İlgili belgelerin analizi', REPORT:'Raporların oluşturulması', GENERATING_REPORTS:'Raporların oluşturulması',
  COMPLETE:'Sonuçların kaydedilmesi', WRITING_MANIFEST:'Sonuçların kaydedilmesi',
}
const labels: Record<string,string> = {COMPLETED:'Tamamlandı',SKIPPED:'Gerekmedi',RUNNING:'İşleniyor',FAILED:'Hata oluştu',PARTIAL:'Eksik tamamlandı',BLOCKED:'Kontrol gerekli',AWAITING_RETRY:'Tekrar bekliyor',PENDING:'Bekliyor',UNKNOWN:'Kayıt yok'}
const terminalStatuses = ['COMPLETED','FAILED','PARTIAL','CANCELLED']

export function flowStatus(values: string[], finished: boolean) {
  return ['FAILED','BLOCKED','PARTIAL','AWAITING_RETRY','RUNNING'].find(status=>values.includes(status))
    ?? (values.every(status=>status==='SKIPPED') ? 'SKIPPED'
      : values.every(status=>status==='COMPLETED'||status==='SKIPPED') ? 'COMPLETED'
        : finished ? 'UNKNOWN' : 'PENDING')
}

export function RunFlow({run}:{run:ScanRunDetail}) {
  const sources=[...(run.sourceKeys?.includes('resmi-gazete') || (!run.sourceKeys && run.editions.some(e=>e.type!=='EXTERNAL'))?[{value:'resmi-gazete',label:'Resmî Gazete'}]:[]),...(run.sourceRuns??[]).map(s=>({value:s.source.key,label:s.source.name}))]
  const names:Record<string,string>={'ticaret-bakanligi':'Ticaret Bakanlığı',igmd:'İGMD',tariff:'Tariff','mevzuat-net':'Mevzuat.net'}
  for(const value of run.sourceKeys??[]) if(!sources.some(s=>s.value===value)) sources.push({value,label:names[value]??value})
  const [selected,setSelected]=useState('')
  const key=sources.some(s=>s.value===selected)?selected:sources[0]?.value
  const gazette=key==='resmi-gazete'
  const sourceRun=run.sourceRuns?.find(s=>s.source.key===key)
  const records=gazette?run.stages:sourceRun?.stages??[]
  const finished=terminalStatuses.includes(gazette?run.status:sourceRun?.status??run.status)

  return <section className="run-flow" aria-label="İşlem akışı">
    <header><div><h2>İşlem akışı</h2><p>Kaynağın işlenme durumu ve aşama ayrıntıları</p></div><Select aria-label="Akış kaynağı" value={key} onChange={setSelected} options={sources}/></header>
    <div className="run-flow-stages">{stages.map(step=>{
      const keys=gazette?step.gazette:step.source
      const state=flowStatus(keys.map(k=>records.find(r=>r.stage===k)?.status??'PENDING'),finished)
      const Icon=state==='COMPLETED'?Check:state==='RUNNING'?LoaderCircle:['FAILED','PARTIAL','BLOCKED'].includes(state)?TriangleAlert:state==='AWAITING_RETRY'?Clock3:state==='SKIPPED'?Minus:state==='UNKNOWN'?Info:Circle
      return <section key={step.title} className={`run-flow-stage is-${state.toLowerCase()}`} aria-label={step.title}>
        <div className="run-flow-stage-heading"><h3>{step.title}</h3></div>
        <div className="run-flow-track"><span className="run-flow-indicator" role="img" aria-label={labels[state]}><Icon size={16} aria-hidden="true"/></span></div>
        <div className="run-flow-stage-body">
        {state!=='COMPLETED' && <span className="run-flow-status">{labels[state]}</span>}
        {state==='SKIPPED' && <p>Yeni belge olmadığı için tekrar işlem gerekmedi.</p>}
        <ul className="run-flow-logs">{keys.map(stage=>{
          const record=records.find(r=>r.stage===stage)
          if(!record) return null
          return <li key={stage}><span>{activities[stage]}</span><small>{record.status!=='COMPLETED' && (labels[record.status]??'Durum bilinmiyor')}{record.totalItems>0 && `${record.status==='COMPLETED'?'':' · '}${record.completedItems} / ${record.totalItems} kayıt`}</small>
            {'failedItems' in record && record.failedItems>0 && <small className="run-flow-error">{record.failedItems} kayıt işlenemedi.</small>}
            {'error' in record && record.error && <details className="run-flow-error"><summary>Hata ayrıntısı</summary><p>{record.error}</p></details>}
          </li>
        })}</ul>
        {state!=='SKIPPED' && !keys.some(k=>records.some(r=>r.stage===k)) && <p className="run-flow-empty">{finished?'Bu aşamaya ait işlem kaydı bulunmuyor.':'Bu aşama için henüz işlem kaydı yok.'}</p>}</div>
      </section>
    })}</div>
    {!!sourceRun?.notes?.length && <details className="run-flow-notes"><summary>Kaynak tarama notları</summary><ul>{sourceRun.notes.map((note,i)=><li key={i}>{note}</li>)}</ul></details>}
  </section>
}
