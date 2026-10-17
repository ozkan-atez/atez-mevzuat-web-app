import { useState } from 'react'
import { Alert,Button,Card,Empty,Modal,Spin,Tag,Typography,message } from 'antd'
import { listTemplates,workspaceRequest } from './api'
import type { WorkspaceTemplate } from './api'
import { useResource } from './useResource'
import { createVisualTemplatePreview } from './VisualTemplateEditor'
import { StudioNav } from './StudioNav'
import './template-studio.css'

/**
 * Eski backend'in (:3001) şablonları — yalnızca okunur. Yeni şablonlar v2 şablon stüdyosunda
 * yönetilir; eski rapor akışı bu şablonları kullanmaya devam ettiği için burada görünür kalır.
 */
export function LegacyTemplatesPage() {
  const resource=useResource(listTemplates,{templates:[],components:[],defaultHtml:undefined,defaultSections:undefined,defaultDefinition:undefined})
  const [preview,setPreview]=useState('')
  const [feedback,holder]=message.useMessage()
  const showPreview=async(t:WorkspaceTemplate)=>{
    try{if(t.definition){const result=await workspaceRequest<{html:string}>('templates/preview',{method:'POST',body:JSON.stringify({definition:t.definition,title:t.name})});setPreview(result.html)}else setPreview(createVisualTemplatePreview(t.html,t.name,t.sections,true,true))}catch(e){void feedback.error((e as Error).message)}
  }
  return <div className="atez-demo-page studio-page">{holder}<div className="atez-demo-heading"><div><Typography.Title level={1}>Eski şablonlar</Typography.Title><Typography.Paragraph type="secondary">Mevcut rapor akışının kullandığı şablonlar. Yalnızca görüntülenir; yeni şablonlar “Şablonlar” sekmesinde oluşturulur.</Typography.Paragraph></div></div>
    <div className="studio-toolbar"><StudioNav/></div>
    {resource.error&&<Alert type="error" title={resource.error} action={<Button onClick={()=>void resource.refresh()}>Yeniden dene</Button>}/>}
    <Spin spinning={resource.loading}><div className="template-card-grid">{resource.data.templates.map(t=><Card key={t.id} title={t.name} extra={<Tag color={t.isActive?'success':'default'}>{t.isActive?'Aktif':'Pasif'}</Tag>}><Typography.Paragraph ellipsis={{rows:3}}>{t.definition?.brief ?? t.description}</Typography.Paragraph><Tag>Salt okunur</Tag><div className="atez-source-footer"><Button onClick={()=>void showPreview(t)}>Önizle</Button></div></Card>)}</div>{!resource.loading&&!resource.data.templates.length&&<Empty description="Eski şablon yok."/>}</Spin>
    <Modal title="Şablon önizlemesi" open={!!preview} onCancel={()=>setPreview('')} footer={null} width={1000}><iframe className="template-preview" title="Şablon önizlemesi" sandbox="" srcDoc={preview}/></Modal>
  </div>
}
