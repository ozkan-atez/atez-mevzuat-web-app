import { useEffect, useRef } from 'react'

interface Props {
  html: string
  zoom: number
  editable: boolean
  onEditField: (path: string, value: string) => void
}

/**
 * Renders the published bulletin untouched and layers editing on top from the
 * parent document.
 *
 * `allow-same-origin` without `allow-scripts` is the whole trick: the parent gets
 * full DOM access to wire up editing, while the document itself stays inert —
 * inline scripts and event attributes do not run. That keeps the template as the
 * single source of truth, so the preview is byte-identical to what is published.
 */
export function EditableReportPreview({ html, zoom, editable, onEditField }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const onEditRef = useRef(onEditField)
  onEditRef.current = onEditField

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const attach = () => {
      const doc = frame.contentDocument
      if (!doc) return

      doc.getElementById('atez-edit-style')?.remove()
      if (!editable) {
        for (const node of doc.querySelectorAll<HTMLElement>('[data-field]')) node.removeAttribute('contenteditable')
        return
      }

      // Injected into the preview only; the stored artefact never carries it.
      const style = doc.createElement('style')
      style.id = 'atez-edit-style'
      style.textContent = `
        [data-field] { outline: 1px dashed transparent; outline-offset: 2px; border-radius: 3px; cursor: text; transition: background-color .12s, outline-color .12s; }
        [data-field]:hover { outline-color: #94a3b8; background: rgba(148,163,184,.10); }
        [data-field]:focus { outline: 2px solid #2d5bff; background: rgba(45,91,255,.06); }
      `
      doc.head.appendChild(style)

      for (const node of doc.querySelectorAll<HTMLElement>('[data-field]')) {
        node.setAttribute('contenteditable', 'plaintext-only')
        node.spellcheck = false
      }
    }

    const handleBlur = (event: FocusEvent) => {
      const target = (event.target as HTMLElement | null)?.closest?.('[data-field]') as HTMLElement | null
      if (!target) return
      const path = target.dataset.field
      const next = (target.textContent ?? '').trim()
      if (!path || next === target.dataset.initial) return
      target.dataset.initial = next
      onEditRef.current(path, next)
    }

    const handleFocus = (event: FocusEvent) => {
      const target = (event.target as HTMLElement | null)?.closest?.('[data-field]') as HTMLElement | null
      if (target) target.dataset.initial = (target.textContent ?? '').trim()
    }

    const bind = () => {
      attach()
      const doc = frame.contentDocument
      if (!doc) return
      doc.addEventListener('focusin', handleFocus as EventListener)
      doc.addEventListener('focusout', handleBlur as EventListener)
    }

    bind()
    frame.addEventListener('load', bind)
    return () => {
      frame.removeEventListener('load', bind)
      const doc = frame.contentDocument
      doc?.removeEventListener('focusin', handleFocus as EventListener)
      doc?.removeEventListener('focusout', handleBlur as EventListener)
    }
  }, [editable, html])

  return (
    <div className="overflow-auto bg-slate-100 p-4">
      <div style={{ width: `${zoom}%` }} className="mx-auto transition-[width] duration-150">
        <iframe
          ref={frameRef}
          title="Bülten Önizleme"
          srcDoc={html}
          sandbox="allow-same-origin"
          className="h-[calc(100vh-300px)] min-h-[620px] w-full rounded-xl bg-white shadow-sm"
        />
      </div>
    </div>
  )
}
