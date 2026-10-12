import { useCan } from '../auth/AuthProvider'
import { useEffect, useState } from 'react'
import { Alert, Button, Space } from 'antd'
import { Link } from 'react-router-dom'
import { getDraftPublicationContext, publishStandaloneDraft, type DraftPublicationContext } from './standalone-api'
export function PublishStandaloneDraft({taskId}:{taskId:string}) {
  const canPublish=useCan('report.publish')
  const [context,setContext]=useState<DraftPublicationContext|null>(null)
  const [error,setError]=useState<string|null>(null)
  const [busy,setBusy]=useState(false)
  const [reload,setReload]=useState(0)
  useEffect(()=>{if(!canPublish)return;let disposed=false;void getDraftPublicationContext(taskId).then(result=>{if(!disposed&&typeof result.expectedVersion==='number'&&typeof result.isPublished==='boolean'){setContext(result);setError(null)}}).catch(e=>{if(!disposed)setError(e.message)});return()=>{disposed=true}},[taskId,reload,canPublish])
  const publish=async()=>{if(!context)return;setBusy(true);setError(null);try{const result=await publishStandaloneDraft(taskId,context.expectedVersion);setContext({...context,reportId:result.reportId,isPublished:true,version:result.version})}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Space wrap>{context?.isPublished&&context.reportId?<Link to={`/reports/documents/${context.reportId}`}>Yayımlanmış raporu aç · v{context.version}</Link>:context&&canPublish&&<Button type="primary" loading={busy} onClick={()=>void publish()}>Taslağı rapor olarak yayımla</Button>}{error&&<Alert type="warning" showIcon title={error} action={<Button size="small" onClick={()=>setReload(value=>value+1)}>Güncel sürümü kontrol et</Button>} />}</Space>
}
