export interface CustomerGroup {
  id: string
  name: string
  description: string | null
  emails: string[]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface DeliverySource {
  kind: 'GAZETTE' | 'PREVIOUS' | 'OFFICIAL' | 'SUPPORTING'
  label: string
  url: string
}

export interface DispatchRecord {
  id: string
  reportVersion: number
  recipients: string[]
  subject: string
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SIMULATED'
  errorMessage: string | null
  sentAt: string | null
  createdAt: string
}

export interface DeliveryContext {
  topicId: string
  reportVersion: number
  targetDate: string
  sources: DeliverySource[]
  draft: {
    subject: string
    bodyText: string
    attachmentName: string
  }
  sender:
    | { configured: true; address: string | null; name: string | null }
    | { configured: false; note: string }
  groups: CustomerGroup[]
  dispatches: DispatchRecord[]
}

export interface DispatchResult {
  dispatchId: string
  status: 'SENT' | 'SIMULATED' | 'FAILED'
  recipients?: string[]
  note?: string
  message?: string
}
