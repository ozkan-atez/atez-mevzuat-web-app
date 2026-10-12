import { useCan } from '../auth/AuthProvider'
import { useRef, useState } from 'react'
import { Alert, Button, Card, Input, Select, Space, Typography } from 'antd'
import { AnalysisInputs, resolveDocumentRoles, type DocumentRole } from '../documents/AnalysisInputs'
import { DocumentPicker } from '../documents/DocumentPicker'
import { AttachmentList, type DocumentAttachment } from '../documents/AttachmentList'
import { OperationModeSelect, type OperationMode } from '../operations/OperationModeSelect'
import { OperationTaskCard } from '../operations/OperationTaskCard'
import type { OperationInput, OperationRequest } from '../operations/api'
import { workspaceRequest, type WorkspaceAutomation, type WorkspaceSource } from './api'
const stages = [
  {value:'DISCOVER',label:'Bağlantıları keşfet'}, {value:'CAPTURE',label:'Belge içeriğini çek'},
  {value:'EXTRACT',label:'Belgeden metin çıkar'}, {value:'FILTER',label:'Kapsam filtresi'},
  {value:'PREVIOUS_SOURCES',label:'Önceki kaynakları bul'}, {value:'ANALYZE',label:'Belgeleri analiz et'},
  {value:'TARIFF_LOOKUP',label:'GTİP tarife sorgusu'}, {value:'BUILD_REPORT',label:'Analizden rapor taslağı oluştur'},
]
export function AutomationStagePanel({automation,sources,operations=[]}:{automation:WorkspaceAutomation;sources:WorkspaceSource[];operations?:OperationRequest[]}) {
  const canAnalyze=useCan('analysis.run')
  const [operation,setOperation]=useState<OperationInput['operation']>('DISCOVER')
  const [mode,setMode]=useState<OperationMode>('REUSE_ONLY')
  const [sourceId,setSourceId]=useState<string|undefined>(automation.sourceIds.length===1?automation.sourceIds[0]:undefined)
  const [date,setDate]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))
  const [url,setUrl]=useState('')
  const [code,setCode]=useState('')
  const [origin,setOrigin] = useState('')
  const [previousDate,setPreviousDate]=useState('')
  const [instruction,setInstruction]=useState('')
  const [analysisTaskId,setAnalysisTaskId]=useState<string|undefined>()
  const [roles,setRoles] = useState<Record<string,DocumentRole>>({})
  const [evidenceTaskIds,setEvidenceTaskIds] = useState<string[]>([])
  const [documents,setDocuments]=useState<DocumentAttachment[]>([])
  const [pickerOpen,setPickerOpen]=useState(false)
  const [started,setStarted]=useState<OperationRequest[]>([])
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const attempt=useRef<{signature:string;key:string}|null>(null)
  const available=[...started,...operations.filter(item=>!started.some(existing=>existing.id===item.id))]
  const analysisTasks=available.flatMap(request=>request.tasks.filter(task=>task.status==='SUCCEEDED'&&['ANALYZE','REVISE_ANALYSIS'].includes(task.operation)))
  const needsSource=['DISCOVER','CAPTURE'].includes(operation)
  const needsDocuments=['EXTRACT','FILTER','PREVIOUS_SOURCES','ANALYZE'].includes(operation)
  const invalid=needsSource? !sourceId||!date||(operation==='CAPTURE'&&!url.trim()):needsDocuments?documents.length===0||(operation==='PREVIOUS_SOURCES'&&!date):operation==='TARIFF_LOOKUP'?!code.trim()||!date:operation==='BUILD_REPORT'?!analysisTaskId:false
  const start=async()=>{
    const input:OperationInput={operation,mode,documentVersionIds:needsDocuments?documents.map(item=>item.id):[],...(needsSource?{sourceId,date,...(operation==='CAPTURE'?{url:url.trim()}:{})}:{}),...(operation==='ANALYZE'?{documentRoles:resolveDocumentRoles(documents,roles),...(evidenceTaskIds.length?{evidenceTaskIds}:{})}:{}),...(operation==='PREVIOUS_SOURCES'?{date}:{}),...(operation==='TARIFF_LOOKUP'?{code:code.trim(),date,...(previousDate?{previousDate}:{} ),...(origin.trim()?{origin:origin.trim()}:{})}:{}),...(operation==='BUILD_REPORT'?{analysisTaskId}:{}),...(instruction.trim()?{instruction:instruction.trim()}:{})}
    const signature=JSON.stringify(input);if(attempt.current?.signature!==signature)attempt.current={signature,key:crypto.randomUUID()}
    setBusy(true);setError(null)
    try{const result=await workspaceRequest<OperationRequest>(`automations/${automation.id}/operations`,{method:'POST',headers:{'Idempotency-Key':attempt.current.key},body:JSON.stringify(input)});setStarted(current=>[...current.filter(request=>request.id!==result.id),result]);attempt.current=null}catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  if(!canAnalyze)return <Space orientation="vertical">{available.map(request=><OperationTaskCard key={request.id} requestId={request.id} />)}</Space>
  return <Card title="Tek bir adımı çalıştır" style={{marginTop:18}}><Space orientation="vertical" style={{width:'100%'}} size="middle">
    <Typography.Paragraph type="secondary">Otomasyonun kaynak ve şablon ayarları kullanılır. Her adım bağımsız izlenir; rapor taslağı ayrıca yayımlanır.</Typography.Paragraph>
    <Select aria-label="Otomasyon işlem adımı" value={operation} onChange={setOperation} options={stages} style={{minWidth:280}} disabled={busy} />
    {needsSource&&<Space wrap><Select aria-label="Otomasyon işlem kaynağı" placeholder="Kaynak seçin" value={sourceId} onChange={setSourceId} style={{minWidth:230}} options={sources.filter(source=>automation.sourceIds.includes(source.id)).map(source=>({value:source.id,label:source.name}))} /><Input type="date" aria-label="Otomasyon işlem tarihi" value={date} onChange={e=>setDate(e.target.value)} />{operation==='CAPTURE'&&<Input aria-label="Otomasyonda çekilecek belge bağlantısı" placeholder="https://…" value={url} onChange={e=>setUrl(e.target.value)} />}</Space>}
    {needsDocuments&&<><Button onClick={()=>setPickerOpen(true)} disabled={busy}>Arşivden belge seç / yükle</Button><AttachmentList items={documents} onRemove={id=>setDocuments(current=>current.filter(item=>item.id!==id))} /></>}
    {operation==='PREVIOUS_SOURCES'&&<Input type="date" aria-label="Önceki kaynak son tarihi" value={date} onChange={e=>setDate(e.target.value)} style={{maxWidth:220}} />}
    {operation==='TARIFF_LOOKUP'&&<Space wrap><Input aria-label="Otomasyon GTİP kodu" value={code} onChange={e=>setCode(e.target.value)} placeholder="GTİP kodu" /><Input type="date" aria-label="Otomasyon tarife tarihi" value={date} onChange={e=>setDate(e.target.value)} /><Input type="date" aria-label="Otomasyon karşılaştırma tarihi" value={previousDate} onChange={e=>setPreviousDate(e.target.value)} /><Input aria-label="Otomasyon tarife menşei" placeholder="Menşe (isteğe bağlı)" value={origin} onChange={e=>setOrigin(e.target.value)} /></Space>}
    {operation==='BUILD_REPORT'&&<Select aria-label="Otomasyon rapor analiz kaydı" placeholder="Tamamlanmış analiz seçin" value={analysisTaskId} onChange={setAnalysisTaskId} style={{minWidth:280}} options={analysisTasks.map((task,index)=>({value:task.id,label:`Tamamlanmış analiz ${index+1}`}))} notFoundContent="Önce bir belge analizi tamamlayın." />}
    {operation==='ANALYZE'&&<AnalysisInputs documents={documents} roles={roles} onRolesChange={setRoles} evidenceTasks={available.flatMap(request=>request.tasks)} evidenceTaskIds={evidenceTaskIds} onEvidenceChange={setEvidenceTaskIds} />}
    <OperationModeSelect value={mode} onChange={setMode} disabled={busy} />
    {['ANALYZE','FILTER'].includes(operation)&&<Input.TextArea aria-label="Otomasyon analiz isteği" placeholder="Odaklanılacak konu (isteğe bağlı)" value={instruction} onChange={e=>setInstruction(e.target.value)} />}
    {error&&<Alert type="error" showIcon title={error} />}
    <Button type="primary" loading={busy} disabled={invalid} onClick={()=>void start()}>Seçili adımı başlat</Button>
    {available.map(request=><OperationTaskCard key={request.id} requestId={request.id} onUpdated={updated => setStarted(current => [...current.filter(item => item.id !== updated.id), updated])} />)}
    <DocumentPicker open={pickerOpen} onClose={()=>setPickerOpen(false)} selected={documents} onSelect={setDocuments} />
  </Space></Card>
}
