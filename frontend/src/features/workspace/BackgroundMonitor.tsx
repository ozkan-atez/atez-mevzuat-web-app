import {useCallback,useEffect,useState} from 'react'
import {Alert,Button,Card,Empty,Modal,Select,Table,Tag} from 'antd'
import {ReloadOutlined} from '@ant-design/icons'
import {getBackgroundStatus,type BackgroundStatus} from './api'
import {useResource} from './useResource'
import {Can} from '../auth/Can'

type Job=BackgroundStatus['jobs'][number]
const labels:Record<string,string>={'resmi-gazete-manual-scan':'Tarama ve rapor hazırlama','resmi-gazete-topic-analysis':'Analiz ve revizyon','resmi-gazete-scheduled-scan':'Zamanlanmış tarama','atez-workspace-daily-automation':'Otomasyon çalışması','atez-source-scan':'Kaynak taraması','atez-source-refresh':'Kaynak güncelleme','atez-operation-task':'Belge ve analiz işlemi','atez-connector-setup':'Kaynak bağlantı testi'}
const statuses:Record<string,string>={RUNNING:'Devam ediyor',RETRY:'Yeniden denenecek',FAILED:'Başarısız',COMPLETED:'Tamamlandı'}
const time=(value:string)=>new Date(value).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',dateStyle:'short',timeStyle:'short'})
function description(job:Job){
 if(job.status==='COMPLETED')return 'İşlem tamamlandı.'
 if(job.status==='RUNNING')return new Date(job.leaseUntil).valueOf()<Date.now()?'İşlemin durumu doğrulanamıyor. Son güncelleme gecikti.':'İşlem arka planda sürüyor.'
 const error=job.lastError ?? ''
 if(/size|too large|boyut|limit.*MB|\d+\s*MB/i.test(error))return 'Belge boyutu izin verilen sınırı aşıyor. Dosyayı veya indirme sınırını kontrol edin.'
 if(/captcha|USER_ACTION_REQUIRED|doğrulama/i.test(error))return 'Kaynak erişim için doğrulama istiyor. Kaynaklar sayfasındaki bağlantıyı kontrol edin.'
 if(/401|403|credential|unauthorized|yetki/i.test(error))return 'Kaynağa erişim izni alınamadı. Bağlantı bilgilerini kontrol edin.'
 if(/timeout|zaman aşımı|ECONN|fetch failed/i.test(error))return 'Kaynak zamanında yanıt vermedi veya bağlantı kurulamadı.'
 return job.status==='RETRY'?'Geçici bir sorun oluştu. Sistem yeniden deneyecek.':'İşlem tamamlanamadı. Ayrıntıları kontrol edin.'
}
function MonitorContent(){
 const [page,setPage]=useState(1),[status,setStatus]=useState(''),[queue,setQueue]=useState('')
 const [detail,setDetail]=useState<Job|null>(null)
 const load=useCallback(()=>getBackgroundStatus({page,status,queue}),[page,status,queue])
 const resource=useResource(load,{connected:false,queues:[],jobs:[]})
 const {refresh}=resource
 useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden)void refresh()},10000);return()=>clearInterval(timer)},[refresh])
 const counts=resource.data.counts ?? {}
 const types=resource.data.types ?? resource.data.queues.map(q=>q.name)
 const label=(name:string)=>labels[name] ?? 'Diğer işlem'
 return <Card className="atez-automation-card atez-background-monitor" title="İşlem geçmişi" extra={<Button size="small" icon={<ReloadOutlined aria-hidden />} loading={resource.loading} onClick={()=>void refresh()}>Yenile</Button>}>
  <p className="activity-description">Kaynak bağlantıları, taramalar, analizler ve rapor hazırlama işlemlerinin arka plan kayıtları.</p>
  {resource.error && <Alert showIcon type="error" title={resource.error} />}
  {!resource.loading && !resource.error && !resource.data.connected && <Alert showIcon type="warning" title="Canlı işlem durumu alınamıyor. Kayıtlı geçmişi inceleyebilirsiniz." />}
  <div className="atez-monitor-metrics">{['RUNNING','RETRY','FAILED','COMPLETED'].map(key=><button key={key} className={status===key?'is-selected':''} onClick={()=>{setStatus(status===key?'':key);setPage(1)}} aria-pressed={status===key}><span>{statuses[key]}</span><strong>{counts[key] ?? '—'}</strong></button>)}</div>
  <div className="activity-filters"><Select aria-label="İşlem türü" value={queue} onChange={value=>{setQueue(value);setPage(1)}} options={[{value:'',label:'Tüm işlem türleri'},...types.map(value=>({value,label:label(value)}))]} /><Select aria-label="İşlem durumu" value={status} onChange={value=>{setStatus(value);setPage(1)}} options={[{value:'',label:'Tüm durumlar'},...Object.entries(statuses).map(([value,label])=>({value,label}))]} /><span>En son güncellenen önce</span></div>
  <Table<Job> size="small" rowKey="id" loading={resource.loading} dataSource={resource.data.jobs} scroll={{x:680}} pagination={{current:page,pageSize:15,total:resource.data.total ?? resource.data.jobs.length,onChange:setPage,showSizeChanger:false,hideOnSinglePage:true}} locale={{emptyText:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={resource.error?'İşlem kayıtları yüklenemedi.':'Bu görünümde işlem kaydı yok.'}/>}} columns={[
   {title:'İşlem',dataIndex:'queue',width:190,render:(value:string)=>label(value)},
   {title:'Durum',width:145,render:(_,job)=><Tag color={job.status==='COMPLETED'?'success':job.status==='FAILED'?'error':job.status==='RETRY'?'warning':'processing'}>{statuses[job.status] ?? 'Bilinmiyor'}</Tag>},
   {title:'Son güncelleme',width:150,render:(_,job)=>time(job.updatedAt)},
   {title:'Açıklama',render:(_,job)=><span className="activity-result">{description(job)}</span>},
   {title:'',width:85,render:(_,job)=><Button size="small" type="text" onClick={()=>setDetail(job)}>Ayrıntılar</Button>},
  ]}/>
  <p className="atez-monitor-note">{resource.data.checkedAt?`Son kontrol: ${time(resource.data.checkedAt)} · `:''}Sayfa açıkken 10 saniyede bir güncellenir. Saatler İstanbul saatidir. Tamamlandı durumu, ilgili arka plan adımının tamamlandığını belirtir.</p>
  <Modal title={detail?label(detail.queue):'İşlem ayrıntıları'} open={!!detail} onCancel={()=>setDetail(null)} footer={<Button onClick={()=>setDetail(null)}>Kapat</Button>}>
   {detail && <div className="activity-detail"><Tag>{statuses[detail.status] ?? 'Bilinmiyor'}</Tag><p>{description(detail)}</p><dl><dt>Son güncelleme</dt><dd>{time(detail.updatedAt)}</dd><dt>Deneme sayısı</dt><dd>{detail.attempts}</dd></dl>{detail.status==='RETRY' && <p>Yeniden deneme sistem tarafından yapılacak; şu anda ek bir işlem başlatmanız gerekmiyor.</p>}{detail.status==='FAILED' && <p>Kaynak bağlantısını Kaynaklar sayfasından; tarama ve rapor adımlarını ilgili çalışmanın ayrıntısından kontrol edebilirsiniz.</p>}<details><summary>Teknik ayrıntılar</summary><dl><dt>Kayıt numarası</dt><dd>{detail.id}</dd></dl><pre>{detail.lastError || 'Kayıtlı hata yok.'}</pre></details></div>}
  </Modal>
 </Card>
}
export function BackgroundMonitor(){return <Can permission="admin.manage"><MonitorContent /></Can>}
