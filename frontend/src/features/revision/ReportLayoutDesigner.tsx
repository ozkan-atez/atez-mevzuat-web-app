import { useMemo, useState } from 'react'
import { Alert, Button, Modal } from 'antd'
import { VisualTemplateEditor, renderVisualSections } from '../workspace/VisualTemplateEditor'
import type { TemplateSection } from '../workspace/api'
import type { ReportCustomization, ReportDraftView } from './types'



/** Retain the actual report shell while exposing its rendered content as blocks. */
export function reportVisualDocument(view: ReportDraftView, customization: ReportCustomization) {
  const doc = new DOMParser().parseFromString(view.html, 'text/html')
  const card = doc.querySelector('article.card') ?? doc.querySelector('article') ?? doc.body
  const content = card.querySelector('[data-field="customization.customHtml"]') ?? card
  doc.querySelectorAll('[data-field]').forEach(node => node.removeAttribute('data-field'))
  const source = card.querySelector(':scope > .source')?.outerHTML ?? ''
  const target = content.querySelector('main') ?? content.querySelector('article') ?? content
  const sections: TemplateSection[] = []
  let intro = ''
  const flush = () => {
    if (intro.trim()) sections.push({ id: `intro-${sections.length}`, heading: 'Rapor bilgileri', html: intro, enabled: true })
    intro = ''
  }
  for (const node of Array.from(target.children)) {
    if (node.classList.contains('source')) continue
    if (node.classList.contains('rule')) { if (sections.length) sections[sections.length - 1]!.html += node.outerHTML; else intro += node.outerHTML; continue }
    const heading = node.querySelector('h2,h3')
    // The saved evidence bibliography is rendered separately by the server.
    if (customization.sources?.length && heading?.textContent?.trim() === (customization.headings?.sources ?? 'Kaynakça') && !node.querySelector('[data-field]')) continue
    if (heading) {
      flush()
      const title = heading.textContent ?? 'Bölüm'
      const clone = node.cloneNode(true) as HTMLElement
      clone.querySelector('h2,h3')!.textContent = '{{heading}}'
      sections.push({ id: `report-${sections.length}`, heading: title, html: clone.outerHTML, enabled: true })
    } else intro += node.outerHTML
  }
  flush()
  if (!sections.length) sections.push({ id: 'body', heading: 'Rapor içeriği', html: target.innerHTML || '<p>İçeriği buradan düzenleyin.</p>', enabled: true })
  target.innerHTML = '{{sections}}'
  const contentTemplate = content.innerHTML
  if (content === card) card.innerHTML += source
  return { html: '<!DOCTYPE html>' + doc.documentElement.outerHTML, sections, contentTemplate }
}

export function ReportLayoutDesigner({ view, customization, components, disabled, onSave }: {
  view: ReportDraftView; customization: ReportCustomization; components: TemplateSection[]; disabled: boolean
  onSave: (value: ReportCustomization) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const initial = useMemo(() => reportVisualDocument(view, customization), [view.html, customization.sources, customization.headings?.sources])
  const [sections, setSections] = useState<TemplateSection[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true); setError(null)
    try {
      const blocks = renderVisualSections(sections)
      const customHtml = initial.contentTemplate.replaceAll('{{sections}}', blocks)
      await onSave({ ...customization, customHtml })
      setOpen(false)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Düzen kaydedilemedi.') }
    finally { setSaving(false) }
  }
  return <>
    <Button disabled={disabled} onClick={() => { setSections(initial.sections); setError(null); setOpen(true) }}>Sayfayı görsel olarak düzenle</Button>
    <Modal className="atez-visual-editor-modal" title="Rapor sayfasını düzenle" width={1400} open={open} onCancel={() => setOpen(false)} onOk={() => void save()} okText="Düzeni taslağa uygula" cancelText="Vazgeç" confirmLoading={saving} destroyOnHidden>
      {error && <Alert type="error" title={error} />}
      <VisualTemplateEditor html={initial.html} title={String(view.spec.title ?? 'Mevzuat raporu')} sections={sections} components={components} onChange={setSections} disabled={saving || disabled} />
    </Modal>
  </>
}
