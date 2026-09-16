import { StrictMode } from 'react'
import { cleanup, render } from '@testing-library/react'
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
})
