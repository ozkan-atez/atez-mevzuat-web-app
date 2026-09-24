import { useEffect, useRef } from 'react'

interface Props {
  html: string
  zoom: number
  editable: boolean
  draftStorageKey: string
  onEditField: (path: string, value: string) => Promise<void>
}

export function clearLocalReportEdits(key: string) {
  try { window.localStorage.removeItem(key) } catch { /* Storage may be unavailable. */ }
}

export function readLocalReportEdits(key: string): Record<string, string> {
  try {
    const value = window.localStorage.getItem(key)
    if (!value) return {}
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([path, text]) => path.length > 0 && typeof text === 'string')) as Record<string, string>
  } catch { return {} }
}

function rememberLocalReportEdit(key: string, path: string, value: string) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...readLocalReportEdits(key), [path]: value }))
  } catch { /* The server save still runs when the editor loses focus. */ }
}

function forgetLocalReportEdit(key: string, path: string, value: string) {
  const edits = readLocalReportEdits(key)
  if (edits[path] !== value) return
  delete edits[path]
  try {
    if (Object.keys(edits).length) window.localStorage.setItem(key, JSON.stringify(edits))
    else window.localStorage.removeItem(key)
  } catch { /* Ignore an unavailable store after the server accepted the edit. */ }
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
export function EditableReportPreview({ html, zoom, editable, draftStorageKey, onEditField }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const onEditRef = useRef(onEditField)
  onEditRef.current = onEditField

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const submitted = new Map<string, string>()

    const persist = (path: string, value: string) => {
      if (submitted.get(path) === value) return
      submitted.set(path, value)
      void onEditRef.current(path, value).then(() => forgetLocalReportEdit(draftStorageKey, path, value)).catch(() => {
        submitted.delete(path)
      })
    }

    const attach = () => {
      const doc = frame.contentDocument
      if (!doc?.head) return null

      doc.getElementById('atez-edit-style')?.remove()
      if (!editable) {
        for (const node of doc.querySelectorAll<HTMLElement>('[data-field]')) node.removeAttribute('contenteditable')
        return doc
      }

      // Injected into the preview only; the stored artefact never carries it.
      const style = doc.createElement('style')
      style.id = 'atez-edit-style'
      style.textContent = `
        [data-field] { outline: 1px dashed transparent; outline-offset: 2px; border-radius: 3px; cursor: text; transition: background-color .12s, outline-color .12s; }
        [data-field]:hover { outline-color: #94a3b8; background: rgba(148,163,184,.10); }
        [data-field]:focus { outline: 2px dashed #94a3b8; background: rgba(148,163,184,.10); }
      `
      doc.head.appendChild(style)

      for (const node of doc.querySelectorAll<HTMLElement>('[data-field]')) {
        node.setAttribute('contenteditable', 'plaintext-only')
        node.spellcheck = false
        const path = node.dataset.field
        if (!path) continue
        const local = readLocalReportEdits(draftStorageKey)[path]
        if (local === undefined) continue
        if (local === (node.textContent ?? '').trim()) forgetLocalReportEdit(draftStorageKey, path, local)
        else {
          node.textContent = local
          persist(path, local)
        }
      }
      return doc
    }

    const handleInput = (event: Event) => {
      const target = (event.target as HTMLElement | null)?.closest?.('[data-field]') as HTMLElement | null
      const path = target?.dataset.field
      if (path) rememberLocalReportEdit(draftStorageKey, path, (target.textContent ?? '').trim())
    }

    const handleBlur = (event: FocusEvent) => {
      const target = (event.target as HTMLElement | null)?.closest?.('[data-field]') as HTMLElement | null
      if (!target) return
      const path = target.dataset.field
      const next = (target.textContent ?? '').trim()
      if (!path || next === target.dataset.initial) return
      target.dataset.initial = next
      persist(path, next)
    }

    const handleFocus = (event: FocusEvent) => {
      const target = (event.target as HTMLElement | null)?.closest?.('[data-field]') as HTMLElement | null
      if (target) target.dataset.initial = (target.textContent ?? '').trim()
    }

    const bind = () => {
      const doc = attach()
      if (!doc) return
      doc.addEventListener('focusin', handleFocus as EventListener)
      doc.addEventListener('focusout', handleBlur as EventListener)
      doc.addEventListener('input', handleInput as EventListener)
    }

    bind()
    frame.addEventListener('load', bind)
    return () => {
      frame.removeEventListener('load', bind)
      const doc = frame.contentDocument
      if (doc && editable) {
        for (const node of doc.querySelectorAll<HTMLElement>('[data-field]')) {
          const path = node.dataset.field
          const value = (node.textContent ?? '').trim()
          if (path && value !== node.dataset.initial && readLocalReportEdits(draftStorageKey)[path] === value) persist(path, value)
        }
      }
      doc?.removeEventListener('focusin', handleFocus as EventListener)
      doc?.removeEventListener('focusout', handleBlur as EventListener)
      doc?.removeEventListener('input', handleInput as EventListener)
    }
  }, [editable, html, draftStorageKey])

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
