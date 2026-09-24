import { StrictMode } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditableReportPreview } from './EditableReportPreview'

describe('EditableReportPreview', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    window.localStorage.clear()
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
          draftStorageKey="test-report"
          onEditField={vi.fn().mockResolvedValue(undefined)}
        />
      </StrictMode>,
    )).not.toThrow()
  })

  it('keeps text typed before blur when the report is closed and reopened', () => {
    const onEditField = vi.fn(() => new Promise<void>(() => undefined))
    const html = '<!doctype html><html><head></head><body><p data-field="emptyDayText">Eski metin</p></body></html>'
    const mount = () => {
      const view = render(<EditableReportPreview html={html} zoom={100} editable draftStorageKey="test-report" onEditField={onEditField} />)
      const frame = view.getByTitle('Bülten Önizleme') as HTMLIFrameElement
      const doc = frame.contentDocument!
      doc.open()
      doc.write(html)
      doc.close()
      fireEvent.load(frame)
      return { view, field: doc.querySelector<HTMLElement>('[data-field="emptyDayText"]')! }
    }

    const first = mount()
    first.field.textContent = 'Kaybolmaması gereken metin'
    fireEvent.input(first.field)
    expect(window.localStorage.getItem('test-report')).toContain('Kaybolmaması gereken metin')
    first.view.unmount()

    const reopened = mount()
    expect(reopened.field.textContent).toBe('Kaybolmaması gereken metin')
    expect(onEditField).toHaveBeenCalledWith('emptyDayText', 'Kaybolmaması gereken metin')
  })
})
