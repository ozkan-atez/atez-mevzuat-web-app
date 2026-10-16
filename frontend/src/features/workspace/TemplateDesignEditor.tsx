import { useEffect,useRef,useState } from 'react'
import { Alert,Button,Card,Input,InputNumber,Select,Space,Switch,Typography } from 'antd'
import { ArrowUpOutlined,ArrowDownOutlined,CopyOutlined,DeleteOutlined,PlusOutlined } from '@ant-design/icons'
import { workspaceRequest } from './api'
import { moveItem,newId } from './template-types'
import type { TemplateDefinition,TemplatePlacement,TemplateNode } from './template-types'
export const nodeOptions=[{value:'paragraph',label:'Metin'},{value:'list',label:'Madde listesi'},{value:'table',label:'Tablo'},{value:'comparison',label:'Karşılaştırma'},{value:'timeline',label:'Zaman çizelgesi'},{value:'notice',label:'Bilgi kutusu'},{value:'divider',label:'Ayırıcı'},{value:'heading',label:'Başlık'}]
export function TemplateDesignEditor({value,title,onChange,disabled=false}:{value:TemplateDefinition;title:string;onChange:(d:TemplateDefinition)=>void;disabled?:boolean}) {
  const [selected,setSelected]=useState(value.layout[0]?.id ?? ''),[html,setHtml]=useState(''),[error,setError]=useState('')
  const frame=useRef<HTMLIFrameElement>(null), dragging=useRef<{kind:'slot'|'component';id:string}|null>(null)
  const latest=useRef({value,onChange,disabled});latest.current={value,onChange,disabled}
  const current=value.layout.find(p=>p.id===selected),component=value.components.find(c=>c.id===current?.componentId)
  const [libraryId,setLibraryId]=useState('')
  const libraryComponent=value.components.find(c=>c.id===libraryId)
  useEffect(()=>{
    const controller=new AbortController()
    const timer=setTimeout(()=>{void workspaceRequest<{html:string}>('templates/preview',{method:'POST',signal:controller.signal,body:JSON.stringify({definition:value,title})}).then(r=>{setHtml(r.html);setError('')}).catch(e=>{if(!controller.signal.aborted)setError(e.message)})},300)
    return ()=>{clearTimeout(timer);controller.abort()}
  },[value,title])
  const insert=(componentId:string,index=latest.current.value.layout.length)=>{
    const {value:d,onChange:change,disabled:locked}=latest.current;if(locked)return
    const placement:TemplatePlacement={id:newId(),componentId,requirementId:null,enabled:true,title:d.components.find(c=>c.id===componentId)?.name ?? 'Yeni alan',staticText:'Sabit metni düzenleyin veya bu parçayı bir içerik bölümüne bağlayın.',columns:1,tone:'plain'}
    const layout=[...d.layout];layout.splice(index,0,placement);change({...d,layout});setSelected(placement.id)
  }
  const drop=(position:number)=>{
    const item=dragging.current,{value:d,onChange:change,disabled:locked}=latest.current
    if(!item||locked)return
    if(item.kind==='component')insert(item.id,position)
    else {const from=d.layout.findIndex(p=>p.id===item.id);if(from>=0)change({...d,layout:moveItem(d.layout,from,position>from?position-1:position)})}
    dragging.current=null
  }
  const bindFrame=()=>{
    const doc=frame.current?.contentDocument;if(!doc)return
    doc.querySelectorAll<HTMLElement>('[data-template-placement]').forEach(el=>{
      el.draggable=!latest.current.disabled;el.style.cursor='pointer'
      el.addEventListener('click',e=>{e.preventDefault();setSelected(el.dataset.templatePlacement!)})
      el.addEventListener('dragstart',e=>{dragging.current={kind:'slot',id:el.dataset.templatePlacement!};e.dataTransfer?.setData('text/plain',el.dataset.templatePlacement!)})
      el.addEventListener('dragover',e=>{e.preventDefault();el.style.outline='2px dashed #7652ad'})
      el.addEventListener('dragleave',()=>{el.style.outline=''})
      el.addEventListener('drop',e=>{e.preventDefault();el.style.outline='';drop(latest.current.value.layout.findIndex(p=>p.id===el.dataset.templatePlacement))})
    })
    doc.querySelectorAll('a').forEach(a=>a.addEventListener('click',e=>e.preventDefault()))
  }
  const patch=(update:Partial<TemplatePlacement>)=>onChange({...value,layout:value.layout.map(p=>p.id===selected?{...p,...update}:p)})
  const onlyPlacement=!!current?.requirementId && value.requirements.some(r=>r.id===current.requirementId&&r.enabled) && value.layout.filter(p=>p.enabled&&p.requirementId===current.requirementId).length===1
  const editNode=(id:string,update:Partial<TemplateNode>)=>onChange({...value,components:value.components.map(c=>c.id===libraryId?{...c,nodes:c.nodes.map(n=>n.id===id?{...n,...update}:n)}:c)})
  return <div className="template-design-grid">
    <aside className="template-panel"><Typography.Title level={5}>Bileşen kitaplığı</Typography.Title><Typography.Paragraph type="secondary">Sayfaya sürükleyin veya ekleyin.</Typography.Paragraph>
      {value.components.map(c=><div className="template-library-row" key={c.id} draggable={!disabled} onDragStart={e=>{dragging.current={kind:'component',id:c.id};e.dataTransfer.setData('text/plain',c.id)}}><Button type="text" onClick={()=>setLibraryId(c.id)}>{c.name}</Button><Button aria-label={`${c.name} ekle`} icon={<PlusOutlined/>} disabled={disabled} onClick={()=>insert(c.id)}/></div>)}
      <Button block disabled={disabled} onClick={()=>{const id=newId();onChange({...value,components:[...value.components,{id,name:'Özel bileşen',description:'',nodes:[{id:newId(),type:'paragraph',field:'body',label:'',text:''}]}]});setLibraryId(id)}}>Yeni bileşen</Button>
      <Typography.Title level={5}>Sayfa sırası</Typography.Title>
      {value.layout.map((p,i)=><div key={p.id} className={`template-layer ${p.id===selected?'selected':''}`} draggable={!disabled} onDragStart={()=>{dragging.current={kind:'slot',id:p.id}}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();drop(i)}}><Button type="text" onClick={()=>{setSelected(p.id);setLibraryId('')}}>{i+1}. {p.title||value.requirements.find(r=>r.id===p.requirementId)?.heading||'Sabit alan'}{p.enabled?'':' · Gizli'}</Button><Space><Button size="small" aria-label={`Alan ${i+1} yukarı`} icon={<ArrowUpOutlined/>} disabled={disabled||i===0} onClick={()=>onChange({...value,layout:moveItem(value.layout,i,i-1)})}/><Button size="small" aria-label={`Alan ${i+1} aşağı`} icon={<ArrowDownOutlined/>} disabled={disabled||i===value.layout.length-1} onClick={()=>onChange({...value,layout:moveItem(value.layout,i,i+1)})}/></Space></div>)}
      <div className="template-drop-end" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();drop(value.layout.length)}}>En sona bırakın</div>
    </aside>
    <main className="template-canvas">{error&&<Alert type="warning" title={error}/>}<iframe ref={frame} title="Canlı şablon tasarımı" sandbox="allow-same-origin" srcDoc={html} onLoad={bindFrame}/></main>
    <aside className="template-panel template-properties">
      {libraryComponent?<><Typography.Title level={5}>Bileşeni düzenle</Typography.Title><label>Ad<Input disabled={disabled} value={libraryComponent.name} onChange={e=>onChange({...value,components:value.components.map(c=>c.id===libraryId?{...c,name:e.target.value}:c)})}/></label><label>AI kullanım açıklaması<Input.TextArea disabled={disabled} value={libraryComponent.description} onChange={e=>onChange({...value,components:value.components.map(c=>c.id===libraryId?{...c,description:e.target.value}:c)})}/></label>
        {libraryComponent.nodes.map(n=><Card key={n.id} size="small"><label>Parça türü<Select disabled={disabled} value={n.type} options={nodeOptions} onChange={type=>editNode(n.id,{type})}/></label><label>Bilgi alanı<Input disabled={disabled} value={n.field} onChange={e=>editNode(n.id,{field:e.target.value})}/></label><label>Görünür etiket<Input disabled={disabled} value={n.label} onChange={e=>editNode(n.id,{label:e.target.value})}/></label><label>Sabit metin (isteğe bağlı)<Input.TextArea disabled={disabled} value={n.text} onChange={e=>editNode(n.id,{text:e.target.value})}/></label><Button danger disabled={disabled||libraryComponent.nodes.length===1} onClick={()=>onChange({...value,components:value.components.map(c=>c.id===libraryId?{...c,nodes:c.nodes.filter(x=>x.id!==n.id)}:c)})}>Parçayı kaldır</Button></Card>)}
        <Button disabled={disabled||libraryComponent.nodes.length>=12} onClick={()=>onChange({...value,components:value.components.map(c=>c.id===libraryId?{...c,nodes:[...c.nodes,{id:newId(),type:'paragraph',field:`field_${c.nodes.length+1}`,label:'',text:''}]}:c)})}>Parça ekle</Button><Button danger disabled={disabled||value.components.length===1||value.layout.some(p=>p.componentId===libraryId)} onClick={()=>{onChange({...value,components:value.components.filter(c=>c.id!==libraryId)});setLibraryId('')}}>Bileşeni kitaplıktan kaldır</Button><Button onClick={()=>setLibraryId('')}>Alan ayarlarına dön</Button>
      </>:current?<><Typography.Title level={5}>Seçili alan</Typography.Title>
        <label>İçerik bağlantısı<Select disabled={disabled||onlyPlacement} value={current.requirementId??'static'} options={[{value:'static',label:'Sabit metin'},...value.requirements.map(r=>({value:r.id,label:r.heading}))]} onChange={id=>patch({requirementId:id==='static'?null:id,componentId:id==='static'&&current.componentId==='auto'?value.components[0]!.id:current.componentId})}/></label>
        <label>Görünüm<Select disabled={disabled} value={current.componentId} options={[...(current.requirementId?[{value:'auto',label:'AI uygun düzeni seçsin'}]:[]),...value.components.map(c=>({value:c.id,label:c.name}))]} onChange={componentId=>patch({componentId})}/></label>
        <label>Başlık değişikliği<Input disabled={disabled} value={current.title} placeholder="İçerik bölümünün başlığı kullanılır" onChange={e=>patch({title:e.target.value})}/></label>
        {!current.requirementId&&<label>Sabit metin<Input.TextArea disabled={disabled} rows={4} value={current.staticText} onChange={e=>patch({staticText:e.target.value})}/></label>}
        <label>Sütun<Select disabled={disabled} value={current.columns} options={[{value:1,label:'Tek sütun'},{value:2,label:'İki sütun'}]} onChange={columns=>patch({columns})}/></label>
        <label>Vurgu<Select disabled={disabled} value={current.tone} options={[{value:'plain',label:'Sade'},{value:'info',label:'Bilgi'},{value:'warning',label:'Uyarı'}]} onChange={tone=>patch({tone})}/></label>
        <label>Görünür<Switch disabled={disabled||onlyPlacement} checked={current.enabled} onChange={enabled=>patch({enabled})}/></label>
        {onlyPlacement&&<Typography.Text type="secondary">Bu, içerik bölümünün tek alanı. Bölümü gizlemek için İçerik sekmesinden kapatın.</Typography.Text>}
        <Space wrap><Button icon={<CopyOutlined/>} disabled={disabled} onClick={()=>{const clone={...current,id:newId()};onChange({...value,layout:[...value.layout,clone]});setSelected(clone.id)}}>Çoğalt</Button><Button aria-label="Kaldır" danger icon={<DeleteOutlined/>} disabled={disabled||onlyPlacement||value.layout.length===1} onClick={()=>{onChange({...value,layout:value.layout.filter(p=>p.id!==selected)});setSelected('')}}>Kaldır</Button>{component&&<Button onClick={()=>setLibraryId(component.id)}>Bileşeni düzenle</Button>}</Space>
      </>:<Typography.Text>Sayfadan bir alan seçin.</Typography.Text>}
      <Typography.Title level={5}>Sayfa görünümü</Typography.Title>
      <label>Vurgu rengi<input type="color" aria-label="Vurgu rengi" disabled={disabled} value={value.theme.accent} onChange={e=>onChange({...value,theme:{...value.theme,accent:e.target.value}})}/></label>
      <label>Arka plan<input type="color" aria-label="Arka plan" disabled={disabled} value={value.theme.background} onChange={e=>onChange({...value,theme:{...value.theme,background:e.target.value}})}/></label>
      <label>Yazı boyutu<InputNumber disabled={disabled} min={10} max={22} value={value.theme.fontSize} onChange={v=>v&&onChange({...value,theme:{...value.theme,fontSize:v}})}/></label>
      <label>Boşluk<InputNumber disabled={disabled} min={4} max={40} value={value.theme.spacing} onChange={v=>v&&onChange({...value,theme:{...value.theme,spacing:v}})}/></label>
      <label>Üst başlık<Input disabled={disabled} value={value.shell.heading} onChange={e=>onChange({...value,shell:{...value.shell,heading:e.target.value}})}/></label>
      {(['showLogo','showHeader','showFooter'] as const).map((key,i)=><label key={key}>{['Logo','Üst bilgi','Alt bilgi'][i]}<Switch disabled={disabled} checked={value.shell[key]} onChange={v=>onChange({...value,shell:{...value.shell,[key]:v}})}/></label>)}
      <label>Alt bilgi metni<Input.TextArea disabled={disabled} value={value.shell.footer} placeholder="Boş bırakılırsa mevcut kurumsal alt bilgi kullanılır" onChange={e=>onChange({...value,shell:{...value.shell,footer:e.target.value}})}/></label>
    </aside>
  </div>
}
