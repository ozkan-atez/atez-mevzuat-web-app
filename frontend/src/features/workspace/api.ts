import type { TemplateDefinition } from './template-types'
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
export interface WorkspaceTemplate { definition?: TemplateDefinition | null; revision?: number; id: string; name: string; description: string | null; html: string; sections: TemplateSection[]; isActive: boolean }
export interface WorkspaceAutomation {
  datePolicy?: string
  id: string; name: string; hour: number; minute: number; times: string[]; weekdays: number[]; timezone: string; isActive: boolean
  sourceIds: string[]; groupIds: string[]; templateId: string | null
  lastRunId: string | null; lastRunAt: string | null; lastError: string | null
}
export interface BuiltInSchedule { key: string; hour: number; minute: number; label: string; description: string; timezone: string; readOnly: boolean }
export interface WorkspaceUser { id: string; name: string | null; email: string; role: string; isActive: boolean }
export interface UsageUser { id: string | null; name: string | null; email: string | null }
export interface UsageMetrics { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; callCount: number; noModelCount: number; unmeasuredCount: number }
export interface ConversationUsage extends UsageMetrics {
  conversationId: string; conversationType: 'GENERAL' | 'REPORT' | 'AUTOMATION' | 'OPERATION' | 'TEMPLATE' | 'RESEARCH'; title: string; target: string | null;
  firstAt: string; lastAt: string; messageCount: number; models: string[] | null; users: UsageUser[];
}
export interface UsageSummary { rows: ConversationUsage[]; summary: UsageMetrics & { conversationCount: number; automationTokens?: number | null; chatTokens?: number | null; otherTokens?: number | null }; users: UsageUser[]; total: number; page: number; pageSize: number; from: string; to: string; teamAccess: boolean }
export interface UsageDetail {
  id: string; messageId: string; actorUserId: string | null; userName: string | null; userEmail: string | null;
  model: string | null; provider: string | null; mode: string; status: string;
  startedAt: string; completedAt: string | null; inputTokens: number | null; outputTokens: number | null;
  totalTokens: number | null; cachedTokens: number | null; reasoningTokens: number | null;
}
export interface UsageDetails { rows: UsageDetail[]; total: number; page: number; pageSize: number }
export interface UsageFilters { recordedOnly?: string; from?: string; to?: string; userId?: string; type?: string; query?: string; page?: number; conversationId?: string }
const usageParams = (filters: UsageFilters) => new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()
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
export const listTemplates = () => workspaceRequest<{ templates: WorkspaceTemplate[]; components: TemplateSection[]; defaultHtml?: string; defaultSections?: TemplateSection[]; defaultDefinition?: TemplateDefinition }>('templates')
export interface AutomationRun {
  id: string; automationId: string | null; workspaceConfig?: { automationName?: string } | null; scheduleSlot?: string | null; trigger: string
  targetDate: string; status: string; createdAt: string; startedAt: string | null; completedAt: string | null; errorSummary: string | null
  totalItems: number; completedItems: number; failedItems: number
  topicReports?: Array<{ id: string; title: string; topicId: string | null; latestVersion: number }>
  sourceRuns?: Array<{ id: string; status: string; errorSummary: string | null; source: { name: string }; _count: { documents: number } }>
}
export const listAutomations = () => workspaceRequest<{ automations: WorkspaceAutomation[] }>('automations')

export const listUsers = () => workspaceRequest<{ users: WorkspaceUser[] }>('users')
export const getUsage = (filters: UsageFilters = {}) => workspaceRequest<UsageSummary>(`usage?${usageParams(filters)}`)
export const getUsageDetails = (filters: UsageFilters) => workspaceRequest<UsageDetails>(`usage/details?${usageParams(filters)}`)
export const listAcademyAttempts = () => workspaceRequest<{ attempts: AcademyAttempt[] }>('academy/attempts')

export interface BackgroundStatus {
  broker?: string; connected: boolean; total?:number; page?:number; types?:string[]; counts?:Record<string,number>; checkedAt?:string
  queues: Array<{ name: string; waiting: number; consumers: number; retrying: number; failed: number }>
  jobs: Array<{ id: string; queue: string; status: string; attempts: number; lastError: string | null; updatedAt: string; leaseUntil: string }>
}
export const getBackgroundStatus = async (filters:{page?:number;status?:string;queue?:string}={}) => {
  const query=new URLSearchParams(Object.entries(filters).filter(([,value])=>value!==undefined && value!=='').map(([key,value])=>[key,String(value)]))
  try { return await workspaceRequest<BackgroundStatus>(`background-jobs${query.size?'?'+query:''}`) }
  catch (error) {
    if (error instanceof WorkspaceRequestError && error.status === 404) throw new Error('Arka plan izleme servisi bu sunucuda henüz etkin değil.')
    throw error
  }
}
