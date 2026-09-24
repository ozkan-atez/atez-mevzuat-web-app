import { ZoomIn, ZoomOut } from 'lucide-react'
import { EditableReportPreview } from './EditableReportPreview'
import type { ReactNode } from 'react'

interface Props {
  html: string
  zoom: number
  editable: boolean
  draftStorageKey: string
  onEditField: (path: string, value: string) => Promise<void>
  onZoomOut: () => void
  onZoomIn: () => void
  zoomOutDisabled: boolean
  zoomInDisabled: boolean
  actions?: ReactNode
  error?: string | null
  notice?: ReactNode
  previewKey?: number
}

/** The report-review surface shared by topic reports and run-level reports. */
export function ReportPreviewPanel({
  html, zoom, editable, draftStorageKey, onEditField, onZoomOut, onZoomIn,
  zoomOutDisabled, zoomInDisabled, actions, error, notice, previewKey,
}: Props) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-bold text-slate-900">Bülten Önizleme</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 p-1">
            <button type="button" onClick={onZoomOut} aria-label="Uzaklaştır" disabled={zoomOutDisabled} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ZoomOut className="h-4 w-4" /></button>
            <span aria-live="polite" className="min-w-12 text-center text-xs font-semibold text-slate-600">%{zoom}</span>
            <button type="button" onClick={onZoomIn} aria-label="Yakınlaştır" disabled={zoomInDisabled} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ZoomIn className="h-4 w-4" /></button>
          </div>
          {actions}
        </div>
      </div>
      {error && <p role="alert" className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs font-medium text-amber-800">{error}</p>}
      {notice}
      <div data-testid="report-preview">
        <EditableReportPreview key={previewKey} html={html} zoom={zoom} editable={editable} draftStorageKey={draftStorageKey} onEditField={onEditField} />
      </div>
    </section>
  )
}
