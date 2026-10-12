import { Checkbox, Select, Space, Typography } from 'antd'
import type { DocumentAttachment } from './AttachmentList'
import type { OperationTask } from '../operations/api'
export type DocumentRole = 'PRIMARY' | 'ATTACHMENT' | 'PREVIOUS' | 'TARIFF' | 'SUPPORTING'
export const roleOptions = [{value:'PRIMARY',label:'Ana belge'},{value:'ATTACHMENT',label:'Ek belge'},{value:'PREVIOUS',label:'Önceki düzenleme'},{value:'TARIFF',label:'Tarife verisi'},{value:'SUPPORTING',label:'Destekleyici belge'}]
export function resolveDocumentRoles(items:DocumentAttachment[],roles:Record<string,DocumentRole>):Record<string,DocumentRole> {
  const primary = items.find(item=>roles[item.id]==='PRIMARY')?.id ?? items[0]?.id
  return Object.fromEntries(items.map(item=>[item.id,item.id===primary?'PRIMARY':roles[item.id]==='PRIMARY'?'SUPPORTING':roles[item.id]??'SUPPORTING']))
}
export function AnalysisInputs({documents,roles,onRolesChange,evidenceTasks=[],evidenceTaskIds=[],onEvidenceChange}:{documents:DocumentAttachment[];roles:Record<string,DocumentRole>;onRolesChange:(roles:Record<string,DocumentRole>)=>void;evidenceTasks?:OperationTask[];evidenceTaskIds?:string[];onEvidenceChange?:(ids:string[])=>void}) {
  const resolved=resolveDocumentRoles(documents,roles)
  const eligible=evidenceTasks.filter(task=>task.status==='SUCCEEDED'&&['PREVIOUS_SOURCES','TARIFF_LOOKUP','CAPTURE'].includes(task.operation))
  return <Space orientation="vertical" style={{width:'100%'}}><Typography.Text type="secondary">Bir ana belge seçin; ekler ve önceki düzenlemeler ayrı rollerle değerlendirilir.</Typography.Text>{documents.map(document=><Space wrap key={document.id}><Typography.Text>{document.title}</Typography.Text><Select aria-label={`${document.title} belgesinin rolü`} value={resolved[document.id]} options={roleOptions} style={{minWidth:210}} onChange={(role:DocumentRole)=>{const next={...resolved,[document.id]:role};if(role==='PRIMARY')for(const item of documents)if(item.id!==document.id&&next[item.id]==='PRIMARY')next[item.id]='SUPPORTING';onRolesChange(next)}} /></Space>)}{eligible.length>0&&onEvidenceChange&&<><Typography.Text strong>Tamamlanmış destekleyici sonuçlar</Typography.Text>{eligible.map((task,index)=><Checkbox key={task.id} checked={evidenceTaskIds.includes(task.id)} onChange={event=>onEvidenceChange(event.target.checked?[...evidenceTaskIds,task.id]:evidenceTaskIds.filter(id=>id!==task.id))}>{task.operation==='TARIFF_LOOKUP'?'Tarife sonucu':task.operation==='CAPTURE'?'Çekilmiş belge sonucu':'Önceki kaynak sonucu'} {index+1}</Checkbox>)}</>}</Space>
}
