import { Button, Card, Collapse, Input, Select, Space, Switch, Typography } from 'antd'
import { ArrowUpOutlined,ArrowDownOutlined,DeleteOutlined,PlusOutlined } from '@ant-design/icons'
import type { TemplateDefinition,TemplateRequirement } from './template-types'
import { newId,moveItem } from './template-types'
export function TemplateContentEditor({value,onChange,disabled=false}:{value:TemplateDefinition;onChange:(value:TemplateDefinition)=>void;disabled?:boolean}) {
  const update=(id:string,patch:Partial<TemplateRequirement>)=>{
    const requirements=value.requirements.map(r=>r.id===id?{...r,...patch,...(patch.required && r.missing==='OMIT'?{missing:'NOTE' as const}:{})}:r)
    onChange({...value,requirements,layout:value.layout.map(p=>p.requirementId===id && patch.enabled!==undefined?{...p,enabled:patch.enabled}:p)})
  }
  const move=(index:number,to:number)=>{
    const requirements=moveItem(value.requirements,index,to), rank=new Map(requirements.map((r,i)=>[r.id,i]))
    onChange({...value,requirements,layout:[...value.layout].sort((a,b)=>(rank.get(a.requirementId ?? '') ?? 999)-(rank.get(b.requirementId ?? '') ?? 999))})
  }
  return <div className="template-content-editor"><Typography.Paragraph type="secondary">Bu açıklamalar AI'a yol gösterir. Raporda açıklamalar yerine kaynaklara göre oluşturulan içerik görünür.</Typography.Paragraph>
    {value.requirements.map((r,index)=><Card key={r.id} size="small" title={`${index+1}. ${r.heading || 'Yeni bölüm'}`} extra={<Space><Switch aria-label={`${r.heading} etkin`} checked={r.enabled} disabled={disabled} onChange={enabled=>update(r.id,{enabled})}/><Button aria-label={`${r.heading} yukarı`} icon={<ArrowUpOutlined/>} disabled={disabled||index===0} onClick={()=>move(index,index-1)}/><Button aria-label={`${r.heading} aşağı`} icon={<ArrowDownOutlined/>} disabled={disabled||index===value.requirements.length-1} onClick={()=>move(index,index+1)}/><Button aria-label={`${r.heading} sil`} danger icon={<DeleteOutlined/>} disabled={disabled||value.requirements.length===1} onClick={()=>onChange({...value,requirements:value.requirements.filter(x=>x.id!==r.id),layout:value.layout.filter(p=>p.requirementId!==r.id)})}/></Space>}>
      <label>Başlık<Input aria-label={`Bölüm ${index+1} başlığı`} value={r.heading} disabled={disabled} maxLength={300} onChange={e=>update(r.id,{heading:e.target.value})}/></label>
      <label>AI bu bölümde ne anlatmalı?<Input.TextArea aria-label={`Bölüm ${index+1} açıklaması`} value={r.instruction} disabled={disabled} rows={3} maxLength={6000} onChange={e=>update(r.id,{instruction:e.target.value})}/></label>
      <Collapse ghost items={[{key:'options',label:'Ek ayarlar',children:<div className="template-options-grid">
        <label>Zorunlu bölüm<Switch checked={r.required} disabled={disabled} onChange={required=>update(r.id,{required})}/></label>
        <label>Kapsam<Select value={r.scope} disabled={disabled} options={[{value:'REPORT',label:'Rapor genelinde'},{value:'DOCUMENT',label:'Belgeleri ayrı ayrı ele al'}]} onChange={scope=>update(r.id,{scope})}/></label>
        <label>Uzunluk<Select value={r.length} disabled={disabled} options={[{value:'SHORT',label:'Kısa'},{value:'MEDIUM',label:'Orta'},{value:'DETAILED',label:'Ayrıntılı'}]} onChange={length=>update(r.id,{length})}/></label>
        <label>Bilgi eksikse<Select value={r.missing} disabled={disabled} options={[{value:'NOTE',label:'Eksiklik notu göster'},{value:'OMIT',label:'Bölümü atla',disabled:r.required},{value:'BLOCK',label:'Raporu durdur, inceleme iste'}]} onChange={missing=>update(r.id,{missing})}/></label>
        <label>Gösterilme koşulu<Input value={r.condition} disabled={disabled} maxLength={1000} placeholder="Örn. yalnız GTİP değişikliği varsa" onChange={e=>update(r.id,{condition:e.target.value})}/></label>
      </div>}]} />
    </Card>)}
    <Button icon={<PlusOutlined/>} disabled={disabled||value.requirements.length>=30} onClick={()=>{const id=newId();onChange({...value,requirements:[...value.requirements,{id,heading:'Yeni bölüm',instruction:'Bu bölümün içeriğini kaynaklara dayanarak açıkla.',required:false,enabled:true,scope:'REPORT',length:'MEDIUM',condition:'',missing:'NOTE'}],layout:[...value.layout,{id:newId(),requirementId:id,componentId:'auto',enabled:true,title:'',staticText:'',columns:1,tone:'plain'}]})}}>İçerik bölümü ekle</Button>
  </div>
}
