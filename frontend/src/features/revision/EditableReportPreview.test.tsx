import { StrictMode } from 'react'
import { cleanup, fireEvent, render } from '../../test/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditableReportPreview } from './EditableReportPreview'

describe('EditableReportPreview', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('does not attach editing before the iframe document head is ready', () => {
    const incompleteDocument = {
      head: null,
      getElementById: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
      createElement: vi.fn(() => document.createElement('style')),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Document

    vi.spyOn(HTMLIFrameElement.prototype, 'contentDocument', 'get').mockReturnValue(incompleteDocument)

    expect(() => render(
      <StrictMode>
        <EditableReportPreview
          html={'<!doctype html><html><body><h1 data-field="title">Başlık</h1></body></html>'}
          zoom={100}
          editable
          onEditField={vi.fn()}
        />
      </StrictMode>,
    )).not.toThrow()
  })

  it('preserves rich HTML when editing a customized report', () => {
    const frameDocument = document.implementation.createHTMLDocument('Report')
    frameDocument.body.innerHTML = '<div data-field="customization.customHtml"><h2>Başlık</h2><p>Metin</p></div>'
    vi.spyOn(HTMLIFrameElement.prototype, 'contentDocument', 'get').mockReturnValue(frameDocument)
    const save = vi.fn()
    render(<EditableReportPreview html="<html></html>" zoom={100} editable onEditField={save} />)
    const field = frameDocument.querySelector<HTMLElement>('[data-field]')!
    expect(field.getAttribute('contenteditable')).toBe('true')
    field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    field.innerHTML = '<h2>Yeni başlık</h2><p><strong>Yeni</strong> metin</p>'
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    expect(save).toHaveBeenCalledWith('customization.customHtml', '<h2>Yeni başlık</h2><p><strong>Yeni</strong> metin</p>')
  })

  it('scales the document content and reapplies the selected zoom after loading', () => {
    const frameDocument = document.implementation.createHTMLDocument('Report')
    vi.spyOn(HTMLIFrameElement.prototype, 'contentDocument', 'get').mockReturnValue(frameDocument)
    const html = '<html><body>Rapor</body></html>'
    const save = vi.fn()
    const { getByTitle, rerender } = render(<EditableReportPreview html={html} zoom={80} editable={false} onEditField={save} />)
    const frame = getByTitle('Bülten Önizleme')
    expect(frameDocument.documentElement.style.zoom).toBe('0.8')
    expect(frame).toHaveAttribute('srcdoc', html)
    rerender(<EditableReportPreview html={html} zoom={65} editable={false} onEditField={save} />)
    expect(frameDocument.documentElement.style.zoom).toBe('0.65')
    frameDocument.documentElement.style.zoom = ''
    fireEvent.load(frame)
    expect(frameDocument.documentElement.style.zoom).toBe('0.65')
    expect(save).not.toHaveBeenCalled()
  })

})
