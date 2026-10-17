import { Skeleton } from 'antd'

/** Sandbox'lı önizleme: script çalışmaz; HTML v2 API'de escape edilir ve CSP taşır. */
export function StudioPreview({ html, title, height = 260, compact = false }: { html?: string | null; title: string; height?: number; compact?: boolean }) {
  return (
    <div className={compact ? 'studio-preview compact' : 'studio-preview'} style={{ height }}>
      {html ? <iframe title={title} sandbox="" srcDoc={html} loading="lazy" tabIndex={compact ? -1 : 0} /> : <Skeleton active paragraph={{ rows: 4 }} className="studio-preview-skeleton" />}
    </div>
  )
}
