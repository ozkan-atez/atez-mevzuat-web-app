import { useEffect, useRef } from 'react'
import { Button, Empty, Input, Space, Switch, Tag, Typography } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { TemplateSection } from './api'
import './visual-template-editor.css'
export interface VisualTemplateEditorProps {
  html: string
  title: string
  sections: TemplateSection[]
  components: TemplateSection[]
  onChange: (sections: TemplateSection[]) => void
  disabled?: boolean
  contentOnly?: boolean
}
const SAMPLE_CONTENT = 'Rapor oluşturulduğunda bu alana güncel mevzuat içeriği yerleşir. Sabit içerik eklemek için metni düzenleyebilirsiniz.'
function escaped(text: string): string { return text.replace(/[&<>"']/g, (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]!)) }
function cleanMarkup(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,iframe,object,embed,link,style').forEach((node) => node.remove())
  doc.querySelectorAll('*').forEach((node) => { for (const attribute of [...node.attributes]) if (/^on/i.test(attribute.name) || (['href', 'src'].includes(attribute.name) && /^\s*(javascript|data:text\/html):/i.test(attribute.value))) node.removeAttribute(attribute.name) })
  return doc.body.innerHTML
}
/** Publishable fragments contain no editor markers or toolbar markup. */
export function renderVisualSections(sections: TemplateSection[]): string {
  return sections.filter((section) => section.enabled).map((section) => cleanMarkup(section.html.replaceAll('{{heading}}', escaped(section.heading)).replaceAll('{{content}}', `<p>${SAMPLE_CONTENT}</p>`))).join('\n')
}
export function createVisualTemplatePreview(html: string, title: string, sections: TemplateSection[], disabled = false, contentOnly = false): string {
  const sectionHtml = sections.map((section, index) => {
    let rendered = section.html.replaceAll('{{heading}}', `<span data-vte-heading="${escaped(section.id)}" data-vte-token="heading">${escaped(section.heading)}</span>`).replaceAll('{{content}}', `<div data-vte-dynamic="content">${SAMPLE_CONTENT}</div>`)
    const doc = new DOMParser().parseFromString(cleanMarkup(rendered), 'text/html')
    if (!contentOnly && !doc.querySelector('[data-vte-heading]')) doc.querySelector('h1,h2,h3,h4,h5,h6')?.setAttribute('data-vte-heading', section.id)
    if (!contentOnly) doc.querySelectorAll('[data-vte-heading]').forEach(node => node.setAttribute('contenteditable', disabled ? 'false' : 'plaintext-only'))
    if (contentOnly) {
      doc.querySelectorAll('[data-vte-heading]').forEach(node => node.removeAttribute('data-vte-heading'))
      const editable = doc.querySelectorAll('[data-template-content]').length ? doc.querySelectorAll('[data-template-content]') : doc.querySelectorAll('p,li,td')
      editable.forEach(node => { if (node.closest('.source')) return; node.setAttribute('contenteditable', disabled ? 'false' : 'plaintext-only'); node.setAttribute('data-vte-content', 'true') })
    }
    rendered = doc.body.innerHTML
    return `<div data-vte-drop="${index}" class="vte-drop">Buraya bırakın</div><section data-vte-section="${escaped(section.id)}" class="vte-section ${section.enabled ? '' : 'vte-hidden'}" draggable="${!disabled}"><div class="vte-label" contenteditable="false">${index + 1}. ${escaped(section.heading)}${section.enabled ? '' : ' · Gizli'}</div><div data-vte-body="${escaped(section.id)}" contenteditable="${!disabled && !contentOnly}" spellcheck="false">${rendered}</div></section>`
  }).join('') + `<div data-vte-drop="${sections.length}" class="vte-drop">Buraya bırakın</div>`
  let rendered = html.replaceAll('{{title}}', escaped(title || 'Rapor başlığı')).replaceAll('{{reportId}}', 'Önizleme').replaceAll('{{issueNumber}}', 'Yayın numarası').replaceAll('{{date}}', new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }))
  rendered = rendered.includes('{{sections}}') ? rendered.replaceAll('{{sections}}', sectionHtml) : rendered + sectionHtml
  const doc = new DOMParser().parseFromString(rendered, 'text/html')
  doc.querySelectorAll('script,iframe,object,embed').forEach((node) => node.remove())
  doc.querySelectorAll('*').forEach((node) => { for (const attribute of [...node.attributes]) if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name) })
  const style = doc.createElement('style')
  style.textContent = `${contentOnly ? '' : 'body{margin:0;padding:28px;color:#20202a;background:#fff;font:14px/1.65 Arial,sans-serif}h1,h2,h3{line-height:1.3}'}.vte-section{position:relative;border:1px dashed #b6a7d0;padding:12px 14px;margin:10px 0;border-radius:8px}.vte-section:focus-within{border-color:#7c3aed;box-shadow:0 0 0 2px #7c3aed18}.vte-label{font:10px/1.5 Arial;color:#796b90;margin-bottom:8px}.vte-hidden{opacity:.4;background:#f3f0f7}.vte-drop{height:12px;text-align:center;font-size:10px;color:transparent;border-radius:5px}.vte-drop.vte-over{height:28px;color:#7c3aed;background:#ede9fe;border:1px dashed #7c3aed}[contenteditable=true]:focus{outline:none}[data-vte-heading]:hover{outline:1px dashed #7c3aed}[data-vte-dynamic]{color:#8b8793}table{max-width:100%}img{max-width:100%}`
  doc.head.appendChild(style)
  return '<!doctype html>' + doc.documentElement.outerHTML
}
export function VisualTemplateEditor({ html, title, sections, components, onChange, disabled = false, contentOnly = false }: VisualTemplateEditorProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const current = useRef({ sections, components, onChange, disabled, contentOnly })
  current.current = { sections, components, onChange, disabled, contentOnly }
  const dragging = useRef<{ kind: 'section' | 'component'; id: string } | null>(null)
  const insert = (component: TemplateSection, position: number) => {
    const latest = current.current
    if (latest.disabled) return
    const id = latest.sections.some((section) => section.id === component.id) ? `${component.id}-${crypto.randomUUID()}` : component.id
    const next = [...latest.sections]; next.splice(position, 0, { ...component, id, enabled: true }); latest.onChange(next)
  }
  const move = (id: string, position: number) => {
    const latest = current.current
    if (latest.disabled) return
    const from = latest.sections.findIndex((section) => section.id === id)
    if (from < 0) return
    const next = [...latest.sections]; const [section] = next.splice(from, 1); next.splice(position > from ? position - 1 : position, 0, section!); latest.onChange(next)
  }
  useEffect(() => {
    const iframe = frame.current
    if (!iframe) return
    let boundDoc: Document | null = null
    const onBlur = (event: FocusEvent) => {
      if (current.current.disabled) return
      const target = event.target as HTMLElement | null
      const body = target?.closest<HTMLElement>('[data-vte-body]')
      if (!body) return
      const id = body.dataset.vteBody
      const section = current.current.sections.find((item) => item.id === id)
      if (!section) return
      const cloned = body.cloneNode(true) as HTMLElement
      const heading = cloned.querySelector<HTMLElement>('[data-vte-heading]')
      const nextHeading = heading?.textContent?.trim() || section.heading
      if (heading?.dataset.vteToken === 'heading') heading.replaceWith(cloned.ownerDocument.createTextNode('{{heading}}'))
      else heading?.removeAttribute('data-vte-heading')
      for (const dynamic of cloned.querySelectorAll<HTMLElement>('[data-vte-dynamic]')) {
        if (dynamic.textContent === SAMPLE_CONTENT) dynamic.replaceWith(cloned.ownerDocument.createTextNode('{{content}}'))
        else dynamic.replaceWith(...Array.from(dynamic.childNodes))
      }
      cloned.querySelectorAll('*').forEach(node => { for (const attr of [...node.attributes]) if (attr.name.startsWith('data-vte-') || ['contenteditable','spellcheck','draggable'].includes(attr.name)) node.removeAttribute(attr.name) })
      let nextHtml = cleanMarkup(cloned.innerHTML)
      if (current.current.contentOnly) {
        const canonical = new DOMParser().parseFromString(section.html, 'text/html')
        const selector = canonical.querySelector('[data-template-content]') ? '[data-template-content]' : 'p,li,td'
        const edited = cloned.querySelectorAll(selector)
        canonical.querySelectorAll(selector).forEach((node,index) => { if (edited[index]) node.textContent = edited[index]!.textContent })
        nextHtml = cleanMarkup(canonical.body.innerHTML)
      }
      if (nextHtml !== cleanMarkup(section.html) || nextHeading !== section.heading) current.current.onChange(current.current.sections.map((item) => item.id === id ? { ...item, heading: current.current.contentOnly ? section.heading : nextHeading, html: nextHtml } : item))
    }
    const onDragStart = (event: DragEvent) => {
      if (current.current.disabled) return event.preventDefault()
      const section = (event.target as HTMLElement)?.closest<HTMLElement>('[data-vte-section]')
      if (!section) return
      dragging.current = { kind: 'section', id: section.dataset.vteSection! }; event.dataTransfer?.setData('text/plain', JSON.stringify(dragging.current))
    }
    const onDragOver = (event: DragEvent) => { const zone = (event.target as HTMLElement)?.closest<HTMLElement>('[data-vte-drop]'); if (zone && !current.current.disabled) { event.preventDefault(); zone.classList.add('vte-over') } }
    const onDragLeave = (event: DragEvent) => (event.target as HTMLElement)?.closest('[data-vte-drop]')?.classList.remove('vte-over')
    const onDrop = (event: DragEvent) => {
      const zone = (event.target as HTMLElement)?.closest<HTMLElement>('[data-vte-drop]')
      if (!zone || current.current.disabled) return
      event.preventDefault(); zone.classList.remove('vte-over')
      const item = dragging.current; const position = Number(zone.dataset.vteDrop)
      if (!item) return
      if (item.kind === 'section') move(item.id, position)
      else { const component = current.current.components.find((entry) => entry.id === item.id); if (component) insert(component, position) }
      dragging.current = null
    }
    const attach = () => { const doc = iframe.contentDocument; if (!doc || boundDoc === doc) return; boundDoc = doc; doc.addEventListener('focusout', onBlur); doc.addEventListener('dragstart', onDragStart); doc.addEventListener('dragover', onDragOver); doc.addEventListener('dragleave', onDragLeave); doc.addEventListener('drop', onDrop) }
    attach(); iframe.addEventListener('load', attach)
    return () => { iframe.removeEventListener('load', attach); boundDoc?.removeEventListener('focusout', onBlur); boundDoc?.removeEventListener('dragstart', onDragStart); boundDoc?.removeEventListener('dragover', onDragOver); boundDoc?.removeEventListener('dragleave', onDragLeave); boundDoc?.removeEventListener('drop', onDrop) }
  }, [html, title, sections, disabled])
  return <div className="atez-visual-template-editor">
    <aside className="atez-visual-template-tools"><Typography.Text strong>Bileşen kitaplığı</Typography.Text><Typography.Paragraph type="secondary">Sayfaya sürükleyin veya Ekle düğmesini kullanın. {contentOnly ? 'ATEZ logosu ve kurumsal alanlar sabittir. Yalnızca işaretli içerikleri düzenleyin.' : 'Başlığı ve metni sayfa üzerinde düzenleyin.'}</Typography.Paragraph>
      {components.map((component) => <div className="atez-visual-palette-item" key={component.id} draggable={!disabled} onDragStart={(event) => { dragging.current = { kind: 'component', id: component.id }; event.dataTransfer.setData('text/plain', JSON.stringify(dragging.current)) }}><Typography.Text>{component.heading}</Typography.Text><Button size="small" aria-label={`${component.heading} ekle`} disabled={disabled} icon={<PlusOutlined />} onClick={() => insert(component, sections.length)}>Ekle</Button></div>)}
      {!contentOnly && <Button block icon={<PlusOutlined />} disabled={disabled} onClick={() => insert({ id: crypto.randomUUID(), heading: 'Yeni bölüm', html: '<section><h2>{{heading}}</h2><p>İçeriği burada düzenleyin.</p></section>', enabled: true }, sections.length)}>Boş bölüm ekle</Button>}
      <Typography.Text strong style={{ marginTop: 20 }}>Sayfa bölümleri</Typography.Text>
      {sections.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Kitaplıktan bölüm ekleyin." />}
      {sections.map((section, index) => <div className="atez-visual-section-item" key={section.id}><Typography.Text>{index + 1}. {section.heading}</Typography.Text>{!contentOnly && <Input size="small" aria-label={`Bölüm ${index + 1} başlığını düzenle`} value={section.heading} disabled={disabled} onChange={event => {
        const heading = event.target.value
        let html = section.html
        if (!html.includes('{{heading}}')) { const doc = new DOMParser().parseFromString(html, 'text/html'); const node = doc.querySelector('h1,h2,h3,h4,h5,h6'); if (node) { node.textContent = heading; html = doc.body.innerHTML } }
        onChange(sections.map(entry => entry.id === section.id ? { ...entry, heading, html } : entry))
      }} />}{contentOnly && <Tag>İçerik düzenlenebilir · Tasarım sabit</Tag>}{!section.enabled && <Tag>Gizli</Tag>}<Space wrap><Switch aria-label={`${section.heading} görünürlüğü`} disabled={disabled} checked={section.enabled} onChange={(enabled) => onChange(sections.map((entry) => entry.id === section.id ? { ...entry, enabled } : entry))} /><Button size="small" aria-label={`${section.heading} yukarı taşı`} icon={<ArrowUpOutlined />} disabled={disabled || index === 0} onClick={() => move(section.id, index - 1)} /><Button size="small" aria-label={`${section.heading} aşağı taşı`} icon={<ArrowDownOutlined />} disabled={disabled || index === sections.length - 1} onClick={() => move(section.id, index + 2)} /><Button size="small" danger aria-label={`${section.heading} kaldır`} icon={<DeleteOutlined />} disabled={disabled} onClick={() => onChange(sections.filter((entry) => entry.id !== section.id))} /></Space></div>)}
    </aside>
    <iframe ref={frame} title="Görsel şablon düzenleyici" sandbox="allow-same-origin" srcDoc={createVisualTemplatePreview(html, title, sections, disabled, contentOnly)} className="atez-visual-template-page" />
  </div>
}
