export type ReportEditSource = 'USER' | 'AI'

export interface ReportFieldEditRecord {
  id: string
  sequence: number
  path: string
  previousValue: unknown
  nextValue: unknown
  source: ReportEditSource
  prompt: string | null
  chatMessageId: string | null
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
