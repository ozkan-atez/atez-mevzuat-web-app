import { cleanup, fireEvent, render, screen } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VisualTemplateEditor, createVisualTemplatePreview, renderVisualSections } from './VisualTemplateEditor'
const summary = { id: 'summary', heading: 'Özet', html: '<section><h2>{{heading}}</h2>{{content}}</section>', enabled: true }
const impact = { id: 'impact', heading: 'Etkiler', html: '<section><h2>{{heading}}</h2><p>Etkilenen firmalar</p></section>', enabled: true }
afterEach(cleanup)
describe('VisualTemplateEditor', () => {
  it('preserves dynamic report content when only the rendered heading is edited', () => {
    const change = vi.fn()
    render(<VisualTemplateEditor html="<main>{{sections}}</main>" title="Bülten" sections={[summary]} components={[summary]} onChange={change} />)
    const frame = screen.getByTitle('Görsel şablon düzenleyici') as HTMLIFrameElement
    expect(frame).toHaveAttribute('sandbox', 'allow-same-origin')
    const doc = frame.contentDocument!
    doc.open(); doc.write(frame.getAttribute('srcdoc')!); doc.close(); fireEvent.load(frame)
    const heading = doc.querySelector<HTMLElement>('[data-vte-heading]')!
    fireEvent.focusOut(heading)
    expect(change).not.toHaveBeenCalled()
    heading.textContent = 'Yönetici özeti'
    fireEvent.focusOut(heading)
    expect(change).toHaveBeenCalledWith([{ ...summary, heading: 'Yönetici özeti' }])
  })
  it('allows only marked text content to change in corporate templates', () => {
    const change = vi.fn()
    const fixed = { ...summary, html: '<section class="block"><h2>Kurumsal başlık</h2><p data-template-content="summary">Özet metni</p></section>' }
    render(<VisualTemplateEditor contentOnly html='<header><img alt="ATEZ" src="logo.png"></header><main>{{sections}}</main><footer>Sabit alt bilgi</footer>' title="Bülten" sections={[fixed]} components={[fixed]} onChange={change} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {name:'Boş bölüm ekle'})).not.toBeInTheDocument()
    const frame=screen.getByTitle('Görsel şablon düzenleyici') as HTMLIFrameElement
    const doc=frame.contentDocument!
    doc.open();doc.write(frame.getAttribute('srcdoc')!);doc.close();fireEvent.load(frame)
    expect(doc.querySelector('[data-vte-body]')).toHaveAttribute('contenteditable','false')
    expect(doc.querySelector('header')).not.toHaveAttribute('contenteditable')
    const text=doc.querySelector<HTMLElement>('[data-template-content]')!
    expect(text).toHaveAttribute('contenteditable','plaintext-only')
    doc.querySelector('h2')!.textContent='İzin verilmeyen başlık'
    text.textContent='Yeni içerik';fireEvent.focusOut(text)
    expect(change).toHaveBeenLastCalledWith([{...fixed,html:'<section class="block"><h2>Kurumsal başlık</h2><p data-template-content="summary">Yeni içerik</p></section>'}])
  })
  it('reorders sections accessibly and keeps the first semantic component ID when adding duplicates', async () => {
    const change = vi.fn()
    render(<VisualTemplateEditor html="<main>{{sections}}</main>" title="Bülten" sections={[summary, impact]} components={[summary]} onChange={change} />)
    await userEvent.click(screen.getByRole('button', { name: 'Etkiler yukarı taşı' }))
    expect(change).toHaveBeenLastCalledWith([impact, summary])
    await userEvent.click(screen.getByRole('button', { name: 'Özet ekle' }))
    const added = change.mock.calls.at(-1)![0]
    expect(added[0].id).toBe('summary')
    expect(added[2].id).toMatch(/^summary-/)
    expect(added[2].id).not.toBe(added[0].id)
  })
  it('moves a rendered block to its drop position and inserts palette components there', () => {
    const change = vi.fn()
    render(<VisualTemplateEditor html="<main>{{sections}}</main>" title="Bülten" sections={[summary, impact]} components={[summary]} onChange={change} />)
    const frame = screen.getByTitle('Görsel şablon düzenleyici') as HTMLIFrameElement
    const doc = frame.contentDocument!
    doc.open(); doc.write(frame.getAttribute('srcdoc')!); doc.close(); fireEvent.load(frame)
    fireEvent.dragStart(doc.querySelector('[data-vte-section="summary"]')!)
    fireEvent.drop(doc.querySelector('[data-vte-drop="2"]')!)
    expect(change).toHaveBeenLastCalledWith([impact, summary])
    const palette = screen.getByRole('button', { name: 'Özet ekle' }).parentElement!
    fireEvent.dragStart(palette, { dataTransfer: { setData: vi.fn() } })
    fireEvent.drop(doc.querySelector('[data-vte-drop="0"]')!)
    const inserted = change.mock.calls.at(-1)![0]
    expect(inserted[0].id).toMatch(/^summary-/)
    expect(inserted[1].id).toBe('summary')
  })
  it('renders inert HTML and excludes hidden sections and editing markers from published fragments', () => {
    const preview = createVisualTemplatePreview('<html><head><script>alert(1)</script></head><body>{{sections}}</body></html>', 'Bülten', [summary])
    expect(preview).not.toContain('<script')
    expect(preview).toContain('data-vte-body')
    const published = renderVisualSections([summary, { ...impact, enabled: false }])
    expect(published).toContain('<h2>Özet</h2>')
    expect(published).not.toContain('data-vte-')
    expect(published).not.toContain('Etkiler')
  })
})
