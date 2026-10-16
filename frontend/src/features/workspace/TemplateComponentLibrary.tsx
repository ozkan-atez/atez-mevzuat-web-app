import { useEffect,useRef,useState } from 'react'
import { Alert,Button,Card,Input,Modal,Spin,Tag,Typography } from 'antd'
import { ArrowUpOutlined,CheckOutlined,ExpandOutlined,RobotOutlined } from '@ant-design/icons'
import { workspaceRequest } from './api'
import type { TemplateAiResult,TemplateComponent,TemplateDefinition } from './template-types'

type ChatMessage={id:string;role:'user'|'assistant';text:string;component?:TemplateComponent;base?:string;added?:boolean;error?:boolean}
function useComponentPreviews(definition:TemplateDefinition,ids:string[]) {
  const [state,setState]=useState<{key:string;html:Record<string,string>;error:string}>({key:'',html:{},error:''})
  const [retry,setRetry]=useState(0)
  // Description edits do not change component appearance or trigger preview requests.
  const key=JSON.stringify({components:definition.components,theme:definition.theme,shell:definition.shell,ids})
  useEffect(()=>{
    let live=true
    const previewDefinition={...definition,brief:undefined}
    void workspaceRequest<{components:Record<string,string>}>('templates/preview',{method:'POST',body:JSON.stringify({definition:previewDefinition,componentIds:ids})}).then(result=>{
      if(!result.components||ids.some(id=>typeof result.components[id]!=='string'||!result.components[id]))throw new Error('Bileşen önizlemesi alınamadı.')
      if(live)setState({key,html:result.components,error:''})
    }).catch(e=>{if(live)setState({key,html:{},error:(e as Error).message})})
    return ()=>{live=false}
    // The serialized key covers every value used to draw the isolated components.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key,retry])
  return {html:state.key===key?state.html:{},error:state.key===key?state.error:'',loading:state.key!==key,retry:()=>{setState({key:'',html:{},error:''});setRetry(n=>n+1)}}
}
function ComponentFrame({html,name,compact=false}:{html?:string;name:string;compact?:boolean}) {
  return <div className={compact?'component-html-preview compact':'component-html-preview'}>{html?<iframe loading="lazy" tabIndex={compact?-1:0} title={`${name} HTML önizlemesi`} sandbox="" srcDoc={html}/>:<div className="component-preview-loading"><Spin size="small"/><span>Önizleme hazırlanıyor</span></div>}</div>
}
function SuggestedComponent({component,definition,onInspect}:{component:TemplateComponent;definition:TemplateDefinition;onInspect:(name:string,html:string)=>void}) {
  const preview=useComponentPreviews({...definition,components:[...definition.components.filter(c=>c.id!==component.id),component]},[component.id])
  return <div className="component-chat-proposal"><div className="component-proposal-heading"><strong>{component.name}</strong><Tag>Öneri</Tag></div>{preview.error?<Alert type="warning" title="Önizleme yüklenemedi" description={preview.error} action={<Button size="small" onClick={preview.retry}>Yeniden dene</Button>}/>:<ComponentFrame html={preview.html[component.id]} name={component.name}/>}
    <Typography.Paragraph type="secondary">{component.description}</Typography.Paragraph><Button size="small" icon={<ExpandOutlined aria-hidden="true"/>} disabled={!preview.html[component.id]} onClick={()=>onInspect(component.name,preview.html[component.id]!)}>Büyük önizleme</Button>
  </div>
}
export function TemplateComponentLibrary({definition,disabled,onChange}:{definition:TemplateDefinition;disabled:boolean;onChange:(definition:TemplateDefinition)=>void}) {
  const previews=useComponentPreviews(definition,definition.components.map(c=>c.id))
  const [selected,setSelected]=useState<{name:string;html:string}|null>(null)
  const [messages,setMessages]=useState<ChatMessage[]>([]),[instruction,setInstruction]=useState(''),[busy,setBusy]=useState(false)
  const mounted=useRef(true),inFlight=useRef(false),latest=useRef(definition),chatEnd=useRef<HTMLDivElement>(null),inputRef=useRef<React.ComponentRef<typeof Input.TextArea>>(null)
  latest.current=definition
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false}},[])
  useEffect(()=>{chatEnd.current?.scrollIntoView?.({behavior:'smooth',block:'nearest'})},[messages.length,busy])
  const inspect=(name:string,html:string)=>setSelected({name,html})
  const send=async()=>{
    const text=instruction.trim()
    if(!text||inFlight.current||disabled||!definition.brief?.trim()||definition.components.length>=40)return
    const base=JSON.stringify(definition)
    const conversation=messages.filter(m=>!m.error).slice(-12).map(m=>({role:m.role,content:(m.component?JSON.stringify(m.component):m.text).slice(0,12000)}))
    inFlight.current=true;setBusy(true);setInstruction('')
    setMessages(m=>[...m,{id:crypto.randomUUID(),role:'user',text}])
    try {
      const result=await workspaceRequest<TemplateAiResult>('templates/ai',{method:'POST',body:JSON.stringify({requestKey:crypto.randomUUID(),mode:'COMPONENT',definition,instruction:text,conversation})})
      if(!mounted.current)return
      const component=result.definition?.components.find(c=>c.id===result.componentId)
      if(!component)throw new Error('AI kullanılabilir bir bileşen döndürmedi. Yeniden deneyin.')
      setMessages(m=>[...m,{id:crypto.randomUUID(),role:'assistant',text:'Bileşen öneriniz hazır. Önizleyebilir veya bir mesajla geliştirebilirsiniz.',component,base}])
    } catch(e) {
      if(mounted.current){setMessages(m=>[...m,{id:crypto.randomUUID(),role:'assistant',text:(e as Error).message,error:true}]);setInstruction(value=>value||text)}
    } finally {inFlight.current=false;if(mounted.current)setBusy(false)}
  }
  const add=(m:ChatMessage)=>{
    if(disabled||!m.component||m.added||m.base!==JSON.stringify(latest.current)||latest.current.components.some(c=>c.id===m.component!.id)||latest.current.components.length>=40)return
    latest.current={...latest.current,components:[...latest.current.components,m.component]}
    onChange(latest.current)
    setMessages(rows=>rows.map(row=>row.id===m.id?{...row,added:true}:row))
  }
  return <div className="component-workspace">
    <Card className="component-pool" title={<span>Bileşen havuzu <Tag>{definition.components.length}</Tag></span>} extra={<Button icon={<RobotOutlined aria-hidden="true"/>} onClick={()=>inputRef.current?.focus()}>AI ile ekle</Button>}>
      <Typography.Paragraph type="secondary">AI, analize uygun parçaları bu havuzdan seçer. Kartlar örnek içerikle gerçek rapor görünümünü gösterir.</Typography.Paragraph>
      {previews.error&&<Alert type="warning" title="Önizlemeler yüklenemedi" description={previews.error} action={<Button onClick={previews.retry}>Yeniden dene</Button>}/>}
      <div className="component-preview-grid">{definition.components.map(c=><article className="component-preview-card" key={c.id}>
        <button className="component-preview-button" aria-label={`${c.name} önizlemesini aç`} disabled={!previews.html[c.id]} onClick={()=>inspect(c.name,previews.html[c.id]!)}>
          {previews.error?<div className="component-preview-loading">Önizleme kullanılamıyor</div>:<ComponentFrame html={previews.html[c.id]} name={c.name} compact/>}<span className="component-preview-expand"><ExpandOutlined aria-hidden="true"/> İncele</span>
        </button><div className="component-preview-caption"><strong>{c.name}</strong><Typography.Paragraph ellipsis={{rows:2,expandable:true,symbol:'Devamı'}} type="secondary">{c.description}</Typography.Paragraph></div>
      </article>)}</div>
    </Card>
    <Card className="component-chat" title={<span><RobotOutlined aria-hidden="true"/> Bileşen asistanı</span>} extra={<Tag>AI</Tag>}>
      <div className="component-chat-messages" role="log" aria-label="Bileşen sohbeti" aria-live="polite">
        {!messages.length&&<div className="component-chat-welcome"><div className="component-assistant-icon"><RobotOutlined aria-hidden="true"/></div><Typography.Title level={5}>Birlikte yeni bir parça tasarlayalım</Typography.Title><Typography.Paragraph type="secondary">Ne görmek istediğinizi yazın. Öneriyi burada önizleyin, mesajla geliştirin ve hazır olduğunda havuza ekleyin.</Typography.Paragraph><Button className="component-chat-starter" onClick={()=>{setInstruction('Oran değişikliği olduğunda önceki ve yeni oranı yan yana gösteren bir karşılaştırma kartı oluştur.');inputRef.current?.focus()}}>Önceki ve yeni oranları karşılaştır</Button></div>}
        {messages.map(m=><div key={m.id} className={`component-chat-message ${m.role}`}><div className="component-chat-speaker">{m.role==='user'?'Siz':'Bileşen asistanı'}</div>{m.error?<Alert type="error" title={m.text}/>:<p>{m.text}</p>}{m.component&&<>
          <SuggestedComponent component={m.component} definition={definition} onInspect={inspect}/>
          {m.added?<Tag color="success" icon={<CheckOutlined aria-hidden="true"/>}>Havuza eklendi · Şablonu kaydedin</Tag>:<><Button type="primary" disabled={disabled||m.base!==JSON.stringify(definition)||definition.components.length>=40} onClick={()=>add(m)}>Havuza ekle</Button>{m.base!==JSON.stringify(definition)&&<Typography.Paragraph className="component-stale-note" type="secondary">Şablon değişti. Güncel haliyle yeniden öneri istemek için mesaj gönderin.</Typography.Paragraph>}</>}
        </>}</div>)}
        {busy&&<div className="component-chat-thinking" role="status"><Spin size="small"/> Bileşen hazırlanıyor…</div>}<div ref={chatEnd}/>
      </div>
      <div className="component-chat-composer"><Input.TextArea ref={inputRef} aria-label="AI düzenleme isteği" autoSize={{minRows:3,maxRows:6}} value={instruction} maxLength={6000} disabled={disabled} onChange={e=>setInstruction(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();void send()}}} placeholder="Bir bileşen tarif edin veya son öneriyi geliştirin…"/>
        <div className="component-chat-send"><Typography.Text type="secondary">Öneriler siz ekleyene kadar havuza alınmaz.</Typography.Text><Button type="primary" icon={<ArrowUpOutlined aria-hidden="true"/>} loading={busy} disabled={!instruction.trim()||disabled||!definition.brief?.trim()||definition.components.length>=40} onClick={()=>void send()}>Gönder</Button></div>
        {definition.components.length>=40&&<Typography.Text type="secondary">Havuz en fazla 40 bileşen içerebilir.</Typography.Text>}
      </div>
    </Card>
    <Modal title={selected?.name ?? 'Bileşen önizlemesi'} open={!!selected} onCancel={()=>setSelected(null)} footer={<Button onClick={()=>setSelected(null)}>Kapat</Button>} width={900}><Typography.Paragraph type="secondary">Örnek içerik · Gerçek raporda bu alanlar analizden doldurulur.</Typography.Paragraph>{selected&&<div className="component-large-preview"><ComponentFrame name={selected.name} html={selected.html}/></div>}</Modal>
  </div>
}
