import { useRef,useState } from 'react'
import { Alert,Button,Card,Empty,Input,Modal,Space,Spin,Switch,Tag,Typography,message } from 'antd'
import { ArrowLeftOutlined,PlusOutlined,RedoOutlined,UndoOutlined } from '@ant-design/icons'
import { Can } from '../auth/Can'
import { listTemplates,workspaceRequest } from './api'
import type { WorkspaceTemplate,TemplateSection } from './api'
import { useResource } from './useResource'
import { createVisualTemplatePreview } from './VisualTemplateEditor'
import { TemplateComponentLibrary } from './TemplateComponentLibrary'
import type { TemplateDefinition } from './template-types'
import './template-studio.css'

interface Draft {name:string;description:string;isActive:boolean;definition:TemplateDefinition|null;sections:TemplateSection[];html:string}
export function TemplatesPage() {
  const resource=useResource(listTemplates,{templates:[],components:[],defaultHtml:undefined,defaultSections:undefined,defaultDefinition:undefined})
  const [editing,setEditing]=useState<WorkspaceTemplate|'new'|null>(null),[draft,setDraft]=useState<Draft|null>(null)
  const draftRef=useRef(draft);draftRef.current=draft
  const [past,setPast]=useState<Draft[]>([]),[future,setFuture]=useState<Draft[]>([]),[saving,setSaving]=useState(false),[saved,setSaved]=useState('')
  const [preview,setPreview]=useState('')
  const [feedback,holder]=message.useMessage(), session=useRef(0)
  const change=(next:Draft)=>{if(!draftRef.current)return;setPast(p=>[...p,draftRef.current!].slice(-80));setFuture([]);setDraft(next);draftRef.current=next}
  const open=(template:WorkspaceTemplate|'new')=>{
    session.current++;setEditing(template)
    const next:Draft=template==='new'?{name:'',description:'',isActive:true,definition:structuredClone(resource.data.defaultDefinition ?? null),sections:structuredClone(resource.data.defaultSections ?? []),html:resource.data.defaultHtml ?? '{{sections}}'}:{name:template.name,description:template.description ?? '',isActive:template.isActive,definition:structuredClone(template.definition ?? null),sections:structuredClone(template.sections),html:template.html}
    if(next.definition){next.description=next.definition.brief ?? next.definition.requirements.filter(r=>r.enabled).map(r=>`${r.heading}: ${r.instruction}`).join('\n\n');next.definition.brief=next.description}
    setDraft(next);draftRef.current=next;setSaved(JSON.stringify(next));setPast([]);setFuture([])
  }
  const close=()=>{
    const leave=()=>{session.current++;setEditing(null);setDraft(null)}
    if(JSON.stringify(draft)!==saved)Modal.confirm({title:'Kaydedilmemiş değişiklikler var',content:'Çıkarsanız bu değişiklikler kaybolur.',okText:'Kaydetmeden çık',cancelText:'Düzenlemeye devam et',onOk:leave})
    else leave()
  }
  const undo=()=>{const last=past.at(-1);if(!last||!draft)return;setFuture(f=>[draft,...f]);setPast(p=>p.slice(0,-1));setDraft(last)}
  const redo=()=>{const next=future[0];if(!next||!draft)return;setPast(p=>[...p,draft]);setFuture(f=>f.slice(1));setDraft(next)}
  const save=async()=>{
    if(!draft?.name.trim()){void feedback.error('Şablon adı gerekli.');return}
    if(draft.definition&&!draft.description.trim()){void feedback.error('Rapordan ne beklendiğini açıklayın.');return}
    setSaving(true)
    try {
      const result=await workspaceRequest<WorkspaceTemplate>(editing==='new'?'templates':`templates/${(editing as WorkspaceTemplate).id}`,{method:editing==='new'?'POST':'PATCH',body:JSON.stringify({...draft,...(editing!=='new'?{expectedRevision:(editing as WorkspaceTemplate).revision ?? 1}:{})})})
      setEditing(result);setSaved(JSON.stringify(draft));await resource.refresh();void feedback.success('Şablon kaydedildi.')
    }catch(e){void feedback.error((e as Error).message)}finally{setSaving(false)}
  }
  const showPreview=async(t:WorkspaceTemplate)=>{
    try{if(t.definition){const result=await workspaceRequest<{html:string}>('templates/preview',{method:'POST',body:JSON.stringify({definition:t.definition,title:t.name})});setPreview(result.html)}else setPreview(createVisualTemplatePreview(t.html,t.name,t.sections,true,true))}catch(e){void feedback.error((e as Error).message)}
  }
  if(draft && editing)return <div className="template-studio">{holder}
    <div className="template-studio-toolbar"><Space><Button icon={<ArrowLeftOutlined/>} onClick={close} disabled={saving}>Şablonlar</Button><Typography.Title level={3}>Rapor şablonu</Typography.Title><Tag>{editing==='new'?'Yeni':`Sürüm ${editing.revision ?? 1}`}</Tag></Space><Space><Typography.Text type="secondary">{JSON.stringify(draft)===saved?'Kaydedildi':'Kaydedilmemiş değişiklikler'}</Typography.Text><Button aria-label="Geri al" icon={<UndoOutlined/>} disabled={!past.length||saving} onClick={undo}/><Button aria-label="İleri al" icon={<RedoOutlined/>} disabled={!future.length||saving} onClick={redo}/><Can permission="config.manage"><Button type="primary" loading={saving} onClick={()=>void save()}>Şablonu kaydet</Button></Can></Space></div>
    <div className="template-info"><label>Şablon adı<Input value={draft.name} maxLength={200} disabled={saving} onChange={e=>change({...draft,name:e.target.value})}/></label><label>Aktif<Switch checked={draft.isActive} disabled={saving} onChange={isActive=>change({...draft,isActive})}/></label></div>
    {draft.definition?<>
      <Card title="Rapordan ne bekleniyor?">
        <Typography.Paragraph type="secondary">İstediğiniz başlıkları ve her başlıkta nelerin anlatılacağını yazın. AI bu açıklamayı talimat olarak kullanır; açıklamanın kendisi raporda görünmez.</Typography.Paragraph>
        <Input.TextArea aria-label="Şablon açıklaması" rows={10} maxLength={2000} showCount value={draft.description} disabled={saving} onChange={e=>change({...draft,description:e.target.value,definition:{...draft.definition!,brief:e.target.value}})} placeholder="Yönetici özeti: Önemli değişiklikleri kısaca özetle.&#10;Kaynak ve yürürlük: Kaynakları ve tarihleri belirt.&#10;Etki analizi: İş süreçlerine etkisini açıkla.&#10;GTİP karşılaştırması: İlgili veriler varsa önceki ve yeni durumu karşılaştır.&#10;Önerilen aksiyonlar: Uygulanabilir adımları listele."/>
      </Card>
      <TemplateComponentLibrary key={session.current} definition={draft.definition} disabled={saving} onChange={definition=>change({...draftRef.current!,definition})}/>
    </>:<Alert type="info" title="Mevcut şablon" description="Bu şablon eski düzeniyle çalışmaya devam eder. Açıklama ve AI bileşen havuzunu kullanmak için yeni bir kopya oluşturun." action={<Button disabled={!resource.data.defaultDefinition} onClick={()=>{const name=draft.name;open('new');change({...draftRef.current!,name:`${name} — Yeni düzen`})}}>Yeni düzende kopya oluştur</Button>}/>}
  </div>
  return <div className="atez-demo-page">{holder}<div className="atez-demo-heading"><div><Typography.Title level={1}>Rapor şablonları</Typography.Title><Typography.Paragraph type="secondary">Rapordan beklentinizi açıklayın, AI için kullanılabilir bileşenler ekleyin.</Typography.Paragraph></div><Can permission="config.manage"><Button type="primary" icon={<PlusOutlined/>} disabled={resource.loading||!!resource.error||!resource.data.defaultDefinition} onClick={()=>open('new')}>Şablon oluştur</Button></Can></div>
    {resource.error&&<Alert type="error" title={resource.error} action={<Button onClick={()=>void resource.refresh()}>Yeniden dene</Button>}/>}
    <Spin spinning={resource.loading}><div className="template-card-grid">{resource.data.templates.map(t=><Card key={t.id} title={t.name} extra={<Tag color={t.isActive?'success':'default'}>{t.isActive?'Aktif':'Pasif'}</Tag>}><Typography.Paragraph ellipsis={{rows:3}}>{t.definition?.brief ?? t.description}</Typography.Paragraph><Tag>{t.definition ? `${t.definition.components.length} kullanılabilir bileşen` : 'Mevcut düzen'}</Tag><div className="atez-source-footer"><Button onClick={()=>void showPreview(t)}>Önizle</Button><Can permission="config.manage"><Button onClick={()=>open(t)}>Şablonu düzenle</Button></Can></div></Card>)}</div>{!resource.loading&&!resource.data.templates.length&&<Empty description="İlk rapor şablonunuzu oluşturun."/>}</Spin>
    <Modal title="Şablon önizlemesi" open={!!preview} onCancel={()=>setPreview('')} footer={null} width={1000}><Alert type="info" title="Bu önizleme yalnızca görünüm örneğidir. Gerçek raporun bölümleri açıklamanıza ve analiz içeriğine göre hazırlanır."/><iframe className="template-preview" title="Şablon önizlemesi" sandbox="" srcDoc={preview}/></Modal>
  </div>
}
