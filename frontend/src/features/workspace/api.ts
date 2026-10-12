import { apiFetch } from '../../lib/apiFetch'
export interface WorkspaceSource {
  id: string
  key: string
  name: string
  description: string | null
  baseUrl: string
  authorityType: string
  isActive: boolean
  scanSupported: boolean
  lastScanned: string | null
  endpoints?: Array<{ id: string; title: string; url: string; status: string; adapter: string | null }>
}

export interface TemplateSection { id: string; heading: string; html: string; enabled: boolean }
export interface WorkspaceTemplate { id: string; name: string; description: string | null; html: string; sections: TemplateSection[]; isActive: boolean }
export interface WorkspaceAutomation {
  datePolicy?: string
  id: string; name: string; hour: number; minute: number; times: string[]; weekdays: number[]; timezone: string; isActive: boolean
  sourceIds: string[]; groupIds: string[]; templateId: string | null
  lastRunId: string | null; lastRunAt: string | null; lastError: string | null
}
export interface BuiltInSchedule { key: string; hour: number; minute: number; label: string; description: string; timezone: string; readOnly: boolean }
export interface WorkspaceUser { id: string; name: string | null; email: string; role: string; isActive: boolean }
export interface UsageSummary { runs: number; reports: number; documents: number; groups: number; dispatches: number; sessions: number; inputTokens: number; outputTokens: number; storedBytes: string | number }
export interface AcademyAttempt { id?: string; type: 'daily' | 'weekly'; date: string; correct: number; total: number; points: number }

export class WorkspaceRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'WorkspaceRequestError'
  }
}

export async function workspaceRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch(`/api/v1/${path}`, { ...options, headers: { ...(options.body != null ? { 'Content-Type': 'application/json' } : {}), ...options.headers } })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string }
    throw new WorkspaceRequestError(response.status, body.message ?? 'İşlem tamamlanamadı.')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const listSources = () => workspaceRequest<{ sources: WorkspaceSource[] }>('sources')
export const listTemplates = () => workspaceRequest<{ templates: WorkspaceTemplate[]; components: TemplateSection[]; defaultHtml?: string; defaultSections?: TemplateSection[] }>('templates')
export const listAutomations = () => workspaceRequest<{ automations: WorkspaceAutomation[]; builtInSchedules: BuiltInSchedule[] }>('automations')
export const listUsers = () => workspaceRequest<{ users: WorkspaceUser[] }>('users')
export const getUsage = () => workspaceRequest<UsageSummary>('usage')
export const listAcademyAttempts = () => workspaceRequest<{ attempts: AcademyAttempt[] }>('academy/attempts')

export interface BackgroundStatus {
  broker: string; connected: boolean
  queues: Array<{ name: string; waiting: number; consumers: number; retrying: number; failed: number }>
  jobs: Array<{ id: string; queue: string; status: string; attempts: number; lastError: string | null; updatedAt: string; leaseUntil: string }>
}
export const getBackgroundStatus = async () => {
  try { return await workspaceRequest<BackgroundStatus>('background-jobs') }
  catch (error) {
    if (error instanceof WorkspaceRequestError && error.status === 404) throw new Error('Arka plan izleme servisi bu sunucuda henüz etkin değil.')
    throw error
  }
}
