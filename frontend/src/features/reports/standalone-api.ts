import { apiFetch } from '../../lib/apiFetch'
export interface StandaloneReport { id:string; title:string; latestVersion:number; operationTaskId:string; createdAt:string }
export interface StandaloneRevision { operationRequestId?:string|null; version:number; operationTaskId:string; createdAt:string }
export interface StandaloneReportDetail extends StandaloneReport { revisions:StandaloneRevision[] }
export interface StandaloneReportContent { reportId:string; version:number; html:string; title?:string; reportContent?:{title:string;summary:string;detailedAnalysis:string} }
async function request<T>(path:string,init?:RequestInit):Promise<T> { const response=await apiFetch(`/api/v1/${path}`,init); const body=await response.json(); if(!response.ok) throw new Error(body.message ?? 'Rapor alınamadı.'); return body as T }
export const listStandaloneReports = () => request<{reports:StandaloneReport[]}>('standalone-reports')
export const getStandaloneReport = (id:string) => request<StandaloneReportDetail>(`standalone-reports/${encodeURIComponent(id)}`)
export const getStandaloneRevision = (id:string,version:number) => request<StandaloneReportContent>(`standalone-reports/${encodeURIComponent(id)}/revisions/${version}`)
export const publishStandaloneDraft = (taskId:string,expectedVersion=0) => request<{reportId:string;version:number;operationTaskId:string}>(`operation-tasks/${encodeURIComponent(taskId)}/publish`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion})})
export interface DraftPublicationContext { reportId?:string|null; expectedVersion:number; isPublished:boolean; version?:number|null }
export const getDraftPublicationContext=(taskId:string)=>request<DraftPublicationContext>(`operation-tasks/${encodeURIComponent(taskId)}/publication`)
