export type ReportEditSource = 'USER' | 'AI'

export interface ReportFieldEditRecord {
  id: string
  sequence: number
  path: string
  previousValue: unknown
  nextValue: unknown
  actorId?: string | null
  actorName?: string | null
  requestedBy?: string | null
  baseVersion?: number | null
  source: ReportEditSource
  prompt: string | null
  chatMessageId: string | null
  /** Structural changes staged by an analysis revision cannot be undone field by field. */
  revertible: boolean
  revertsEditId: string | null
  revertedByEditId: string | null
  createdAt: string
}

export interface ReportDraftSummary {
  id: string
  status: 'OPEN' | 'PUBLISHED' | 'DISCARDED'
  updatedAt: string
  edits: ReportFieldEditRecord[]
}

export interface ReportDraftView {
  /** A previously accepted correction is still being processed by the worker. */
  isProcessing?: boolean
  /** Null while the report still matches its published revision. */
  draft: ReportDraftSummary | null
  baseVersion: number
  publishedVersion: number
  /** The report gained a revision while this draft was open. */
  isStale: boolean
  spec: Record<string, unknown>
  html: string
}

export interface PublishedRevision {
  reportId: string
  revisionId: string
  version: number
  card: string
  basename: string
}

export interface ReportCustomization {
  headings?: Record<string, string>
  order?: string[]
  sections?: Array<{ id: string; title: string; html: string }>
  sources?: Array<{ id: string; label: string; url: string; content: string; kind: 'URL' | 'TEXT' | 'FILE'; fileName?: string; documentVersionId?: string }>
  templateId?: string | null
  customHtml?: string | null
}
export type ReportSourceInput = Omit<NonNullable<ReportCustomization['sources']>[number], 'id'>
