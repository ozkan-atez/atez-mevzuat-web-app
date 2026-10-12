import { snapshotTemplateBindings } from '../workspace/template-bindings'
import { templateAccessWhere, sourceAccessWhere } from '../managed-sources/source-access'
import { getActorContext, privateActorScope, resourceOwnership, documentAccessWhere } from '../../platform/actor-context'
import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { normalizeGtip, validTariffDate } from '../tariff/tariff-lookup'
import { builtinProfile } from '../managed-sources/source-profile'
import { sourceArtifactIsComplete } from './source-artifacts'

export const operationKinds = ['DISCOVER', 'CAPTURE', 'EXTRACT', 'FILTER', 'PREVIOUS_SOURCES', 'TARIFF_LOOKUP', 'ANALYZE', 'BUILD_REPORT', 'REVISE_ANALYSIS', 'REVISE_REPORT'] as const
export const OperationInputSchema = z.object({
  operation: z.enum(operationKinds), mode: z.enum(['REUSE_ONLY', 'FILL_MISSING', 'FORCE']).default('REUSE_ONLY'),
  documentVersionIds: z.array(z.string().min(1)).max(10).default([]), documentRoles:z.record(z.string(),z.enum(['PRIMARY','ATTACHMENT','PREVIOUS','TARIFF','SUPPORTING'])).optional(), evidenceTaskIds:z.array(z.string().min(1)).max(10).optional(), instruction: z.string().trim().max(8000).optional(), reportEdits: z.object({title:z.string().trim().min(1).max(300).optional(),summary:z.string().trim().min(1).max(8000).optional(),detailedAnalysis:z.string().trim().min(1).max(30000).optional(),note:z.string().trim().min(1).max(30000).optional()}).strict().optional(),
  analysisTaskId: z.string().min(1).optional(), reportTaskId: z.string().min(1).optional(), templateId: z.string().min(1).optional(), templateRevision:z.number().int().min(1).optional(),
  url: z.url().max(2000).optional(), datePolicy: z.enum(['PUBLISHED_DATE', 'NEW_OR_CHANGED']).optional(), profileVersion: z.number().int().positive().optional(),
  automationId:z.string().min(1).optional(), sourceRunId:z.string().min(1).optional(), sourceId: z.string().min(1).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  code: z.string().max(30).optional(), previousDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), origin: z.string().max(100).optional(),
}).strict()
export type OperationInput = z.infer<typeof OperationInputSchema>
export const OperationTaskParametersSchema=OperationInputSchema.extend({executionSnapshot:z.record(z.string(),z.unknown()).optional()})
export type OperationParameters=z.infer<typeof OperationTaskParametersSchema>
export interface ArtifactOutput { kind: string; referenceId?: string; objectKey?: string; data?: unknown }
export type OperationExecutor = (parameters: OperationParameters, context: { taskId: string; actorScope: string; signal: AbortSignal }) => Promise<ArtifactOutput[]>
export type OperationExecutors = Partial<Record<OperationInput['operation'], OperationExecutor>>
export interface PlannedTask { operation:OperationInput['operation']; inputSignature:string; parameters:OperationParameters; dependencyIds:string[]; status:string; reused:boolean; cachedTaskId?:string; existingArtifacts?:ArtifactOutput[]; signatureDependencies?:string[] }
export interface OperationPlan {operation:OperationInput['operation'];mode:OperationInput['mode'];tasks:PlannedTask[];missing:Array<{operation:string;documentVersionId?:string;reason:string}>;canStart:boolean}
export class OperationError extends Error {
  constructor(message: string, public readonly statusCode = 422, public readonly category = 'INVALID_INPUT') { super(message) }
}
export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export const operationHash = (value: unknown) => createHash('sha256').update(stableSerialize(value)).digest('hex')
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
const included = { tasks: { include: { artifacts: true }, orderBy: { createdAt: 'asc' as const } } }

/** Business state and transactional outbox are independent of RabbitMQ delivery receipts. */
export class OperationService {
  private readonly defaultScope: string
  get scope():string {return getActorContext()?privateActorScope():this.defaultScope}
  readonly executors: OperationExecutors
  constructor(readonly prisma: PrismaClient, options: { scope?: string; executors?: OperationExecutors; versions?: Record<string, string> } = {}) {
    this.defaultScope = options.scope ?? 'local-workspace'; this.executors = options.executors ?? {}; this.versions = options.versions ?? {}
  }
  private readonly versions: Record<string, string>
  async plan(raw: unknown): Promise<OperationPlan> {
    const input = OperationInputSchema.parse(raw)
    const executionSnapshot: Record<string,unknown> = {capturedAt:new Date().toISOString()}
    if(input.operation==='REVISE_ANALYSIS' && input.analysisTaskId) {
      const original=await this.prisma.operationTask.findFirst({where:{id:input.analysisTaskId,actorScope:this.scope,status:'SUCCEEDED'},include:{artifacts:true}})
      if(!original?.artifacts.some(a=>a.kind==='ANALYSIS'))throw new OperationError('Analiz bulunamadı.',404)
      const prior=OperationTaskParametersSchema.parse(original.parameters)
      input.documentVersionIds=[...new Set([...prior.documentVersionIds,...input.documentVersionIds])]
      input.documentRoles={...prior.documentRoles,...input.documentRoles}
    }
    if(input.evidenceTaskIds?.length) {
      const evidenceTasks=await this.prisma.operationTask.findMany({where:{id:{in:input.evidenceTaskIds},actorScope:this.scope,status:'SUCCEEDED'},include:{artifacts:true}})
      if(evidenceTasks.length !== new Set(input.evidenceTaskIds).size)throw new OperationError('Tamamlanmış kanıt işlemi bulunamadı.',404)
      for(const task of evidenceTasks) {
        if(!['PREVIOUS_SOURCES','TARIFF_LOOKUP','CAPTURE'].includes(task.operation))throw new OperationError('Bu işlem türü belge kanıtı sağlamaz.')
        const capture=task.operation==='CAPTURE'?task.artifacts.find(a=>a.kind==='CAPTURE' && a.data && typeof a.data==='object' && !Array.isArray(a.data) && a.data.status==='COMPLETED'):null
        const captureIds=capture?.data && typeof capture.data==='object' && !Array.isArray(capture.data) && Array.isArray(capture.data.documentVersionIds)?capture.data.documentVersionIds:null
        const refs=task.artifacts.filter(a=>a.kind==='DOCUMENT_VERSION' && a.referenceId && (!captureIds || captureIds.includes(a.referenceId))).map(a=>a.referenceId!)
        if(!refs.length && task.operation!=='PREVIOUS_SOURCES')throw new OperationError('Seçilen işlem doğrulanmış belge sürümü içermiyor.')
        input.documentRoles ??= {}
        for(const id of refs) {
          if(!input.documentVersionIds.includes(id))input.documentVersionIds.push(id)
          const artifact=task.artifacts.find(a=>a.kind==='DOCUMENT_VERSION' && a.referenceId===id)
          const role=artifact?.data && typeof artifact.data==='object' && !Array.isArray(artifact.data) ? artifact.data.role : null
          input.documentRoles[id] ??= task.operation==='PREVIOUS_SOURCES'?(role==='ATTACHMENT'?'ATTACHMENT':'PREVIOUS'):task.operation==='TARIFF_LOOKUP'?'TARIFF':'SUPPORTING'
        }
      }
      executionSnapshot.evidenceTasks=evidenceTasks.map(t=>({id:t.id,operation:t.operation,inputSignature:t.inputSignature,artifactIds:t.artifacts.map(a=>a.id)}))
    }
    if(input.documentVersionIds.length>10)throw new OperationError('Bir işlem en fazla 10 belge sürümü kullanabilir.')
    const suppliedRoles=input.documentRoles ?? {}
    if(Object.keys(suppliedRoles).some(id=>!input.documentVersionIds.includes(id)))throw new OperationError('Belge rolü yalnızca seçilen sürümlere verilebilir.')
    if(input.documentVersionIds.length) {
      const primary=input.documentVersionIds.find(id=>suppliedRoles[id]==='PRIMARY') ?? input.documentVersionIds.find(id=>!suppliedRoles[id]) ?? input.documentVersionIds[0]
      input.documentRoles=Object.fromEntries(input.documentVersionIds.map(id=>[id,id===primary && !Object.values(suppliedRoles).includes('PRIMARY') ? 'PRIMARY' : suppliedRoles[id] ?? (id===primary?'PRIMARY':'SUPPORTING')])) as OperationInput['documentRoles']
      if(Object.values(input.documentRoles!).filter(role=>role==='PRIMARY').length!==1)throw new OperationError('Analiz paketinde tek bir ana belge seçin.')
    }
    if (new Set(input.documentVersionIds).size !== input.documentVersionIds.length) throw new OperationError('Belge sürümleri tekrarlanamaz.')
    if(input.operation === 'EXTRACT' && input.documentVersionIds.length > 1) {
      const parts = await Promise.all(input.documentVersionIds.map(id=>this.plan({...input,documentVersionIds:[id],documentRoles:{[id]:'PRIMARY'},evidenceTaskIds:undefined})))
      return {operation:input.operation,mode:input.mode,tasks:parts.flatMap(p=>p.tasks),missing:parts.flatMap(p=>p.missing),canStart:parts.every(p=>p.canStart)}
    }
    if (input.date && (Number.isNaN(Date.parse(`${input.date}T00:00:00Z`)) || new Date(`${input.date}T00:00:00Z`).toISOString().slice(0,10) !== input.date)) throw new OperationError('Geçersiz tarih.')
    const versions = await this.prisma.documentVersion.findMany({ where: { id: { in: input.documentVersionIds }, document: documentAccessWhere(this.scope) }, include: { document: true } })
    if (versions.length !== input.documentVersionIds.length) throw new OperationError('Belge bulunamadı.', 404)
    if(versions.some(v=>input.documentRoles?.[v.id]==='TARIFF' && (!v.extractionMetadata || typeof v.extractionMetadata!=='object' || Array.isArray(v.extractionMetadata) || v.extractionMetadata.classification!=='SUPPORTING_NON_AUTHORITATIVE')))throw new OperationError('Tariff rolü için kayıtlı Tariff kanıtı seçin.')
    if (['EXTRACT', 'ANALYZE', 'FILTER', 'REVISE_ANALYSIS'].includes(input.operation) && !versions.length && !input.analysisTaskId) throw new OperationError('En az bir belge sürümü seçin.')
    const missing: Array<{ operation: string; documentVersionId?: string; reason: string }> = []
    const tasks: Array<{ operation: OperationInput['operation']; inputSignature: string; parameters: OperationParameters; dependencyIds: string[]; status: string; reused: boolean; cachedTaskId?: string; existingArtifacts?: ArtifactOutput[]; signatureDependencies?: string[] }> = []
    let semantic: Record<string, unknown> = { ...input, mode: undefined, sourceRunId:undefined, automationId:undefined, documentVersionIds: [...input.documentVersionIds].sort(), versions: this.versions, documentSnapshots: versions.map(v=>({id:v.id,contentHash:v.contentHash,extractionContract:this.versions.EXTRACT})).sort((a,b)=>a.id.localeCompare(b.id)) }
    if (input.templateId) {
      const template = await this.prisma.reportTemplate.findFirst({ where: { id: input.templateId,...templateAccessWhere() } })
      if (!template || !template.isActive) throw new OperationError('Şablon bulunamadı.', 404)
      if(input.templateRevision!==undefined && input.templateRevision!==template.revision)throw new OperationError('Şablon sürümü değişti.',409,'TEMPLATE_CHANGED')
      input.templateRevision = template.revision
      const sourceBindings=await snapshotTemplateBindings(this.prisma,template.id,template.sections,input.sourceId?[input.sourceId]:undefined)
      executionSnapshot.sourceBindings=sourceBindings
      executionSnapshot.template={id:template.id,revision:template.revision,html:template.html,sections:template.sections,sourceBindings}
      semantic = { ...semantic, templateRevision: template.revision, templateSnapshot: { html: template.html, sections: template.sections, sourceBindings } }
    }
    if(input.sourceId) {
      const source = await this.prisma.source.findFirst({where:{id:input.sourceId,isActive:true,...sourceAccessWhere()}})
      if(!source) throw new OperationError('Etkin kaynak bulunamadı.',404)
      const profile = await this.prisma.sourceProfile.findFirst({where:{sourceId:source.id,status:'VERIFIED'},orderBy:{version:'desc'}})
      const builtin=!profile?builtinProfile(source.key):null
      const frozenProfile=profile?{id:profile.id,version:profile.version,config:profile.config}:builtin?{id:null,version:1,config:builtin}:null
      executionSnapshot.source={id:source.id,key:source.key,baseUrl:source.baseUrl,authorityType:source.authorityType}
      executionSnapshot.profile=frozenProfile
      semantic = {...semantic,sourceSnapshot:{key:source.key,baseUrl:source.baseUrl,profile:frozenProfile}}
      if(frozenProfile) {
        if(input.profileVersion!==undefined && input.profileVersion!==frozenProfile.version)throw new OperationError('Kaynak profili değişti.',409,'PROFILE_CHANGED')
        input.profileVersion = frozenProfile.version
      }
    }
    if(input.automationId) {
      const automation=await this.prisma.workspaceAutomation.findUnique({where:{id:input.automationId}})
      if(!automation)throw new OperationError('Otomasyon bulunamadı.',404)
      if(input.sourceId && !automation.sourceIds.includes(input.sourceId))throw new OperationError('Kaynak bu otomasyonun kapsamına ait değil.')
      executionSnapshot.automation={id:automation.id,name:automation.name,scheduleVersion:automation.scheduleVersion,sourceIds:automation.sourceIds,groupIds:automation.groupIds,datePolicy:automation.datePolicy,templateId:automation.templateId,times:automation.times,weekdays:automation.weekdays,timezone:automation.timezone}
    }
    for (const id of [input.analysisTaskId, input.reportTaskId].filter((id): id is string => Boolean(id))) {
      const task = await this.prisma.operationTask.findFirst({ where: { id, actorScope: this.scope, status: 'SUCCEEDED' }, include: { artifacts: true } })
      if (!task) throw new OperationError('Tamamlanmış işlem bulunamadı.', 404)
      if(input.operation==='REVISE_ANALYSIS' && id===input.analysisTaskId) {
        const original=OperationTaskParametersSchema.parse(task.parameters)
        input.documentVersionIds=[...new Set([...original.documentVersionIds,...input.documentVersionIds])]
        if(input.documentVersionIds.length>10)throw new OperationError('Bir analiz en fazla 10 belge sürümü kullanabilir.')
      }
      if (id === input.analysisTaskId && !task.artifacts.some(a => a.kind === 'ANALYSIS')) throw new OperationError('İşlem bir analiz çıktısı içermiyor.')
      if (id === input.reportTaskId && !task.artifacts.some(a => a.kind === 'REPORT_DRAFT')) throw new OperationError('İşlem bir rapor taslağı içermiyor.')
      semantic = { ...semantic, [id]: task.artifacts.map(a => ({ id: a.id, kind: a.kind })) }
    }
    if(input.operation === 'REVISE_REPORT' && (!input.reportTaskId || !input.reportEdits || !Object.keys(input.reportEdits).length)) throw new OperationError('Rapor revizyonu için taslak ve içerik değişikliği gereklidir.')
    if (input.operation === 'BUILD_REPORT' && !input.analysisTaskId) throw new OperationError('Rapor için tamamlanmış analiz seçin.')
    if(input.operation === 'TARIFF_LOOKUP') {
      if(!input.code || !input.date) throw new OperationError('GTİP ve tarih gereklidir.')
      try{input.code=normalizeGtip(input.code)}catch{throw new OperationError('GTİP 6, 8, 10 veya 12 rakam olmalıdır.')}
      if(!validTariffDate(input.date) || (input.previousDate && !validTariffDate(input.previousDate)))throw new OperationError('Geçerli bir Tariff tarihi girin.')
      if(input.origin && !/^[A-Z]{2}$/.test(input.origin))throw new OperationError('Menşe iki büyük harfli ülke kodu olmalıdır.')
      semantic={...semantic,code:input.code}
    }
    if (['DISCOVER', 'CAPTURE', 'PREVIOUS_SOURCES'].includes(input.operation) && !input.sourceId && !versions.length) throw new OperationError('Kaynak veya belge seçin.')
    if(input.operation === 'DISCOVER' && (!input.sourceId || !input.date)) throw new OperationError('Keşif için kaynak ve hedef tarih gereklidir.')
    if(input.operation === 'CAPTURE' && (!input.sourceId || !input.url)) throw new OperationError('Belge almak için kaynak ve belge bağlantısı gereklidir.')
    const extractionTasks: string[] = []
    if (['ANALYZE','FILTER','PREVIOUS_SOURCES','REVISE_ANALYSIS'].includes(input.operation)) for (const version of versions) {
      if (version.extractionStatus === 'READY' && version.extractedText?.trim()) continue
      const reason = version.extractionStatus === 'OCR_REQUIRED' ? 'OCR_REQUIRED' : 'TEXT_MISSING'
      if (input.mode === 'REUSE_ONLY' || version.extractionStatus === 'OCR_REQUIRED') { missing.push({ operation: 'EXTRACT', documentVersionId: version.id, reason }); continue }
      if (!this.executors.EXTRACT) { missing.push({ operation: 'EXTRACT', documentVersionId: version.id, reason: 'EXECUTOR_UNAVAILABLE' }); continue }
      const parameters: OperationInput = { operation: 'EXTRACT', mode: 'FILL_MISSING', documentVersionIds: [version.id] }
      const inputSignature = operationHash({ scope: this.scope, parameters: { ...parameters, mode: undefined }, version: this.versions.EXTRACT })
      tasks.push({ operation: 'EXTRACT', inputSignature, parameters, dependencyIds: [], status: 'QUEUED', reused: false }); extractionTasks.push(inputSignature)
    }
    const inputSignature = operationHash({ scope: this.scope, semantic })
    const existingText = input.operation === 'EXTRACT' && input.mode !== 'FORCE' && versions.length === 1 && versions[0]!.extractionStatus === 'READY' && Boolean(versions[0]!.extractedText?.trim())
    let cached = input.mode === 'FORCE' ? null : await this.prisma.operationTask.findFirst({ where: { actorScope: this.scope, inputSignature, status: 'SUCCEEDED' }, include: { artifacts: true }, orderBy: { createdAt: 'desc' } })
    if(cached && !sourceArtifactIsComplete(input.operation,cached.artifacts)) cached = null
    if (!cached && !existingText && !this.executors[input.operation]) missing.push({ operation: input.operation, reason: 'EXECUTOR_UNAVAILABLE' })
    if (!cached && !existingText && input.mode === 'REUSE_ONLY') missing.push({ operation: input.operation, reason: 'RESULT_MISSING' })
    tasks.push({ operation: input.operation, inputSignature, parameters: {...input,executionSnapshot}, dependencyIds: [], signatureDependencies: extractionTasks, status: cached || existingText ? 'SUCCEEDED' : 'QUEUED', reused: Boolean(cached || existingText), ...(existingText ? {existingArtifacts:[{kind:'DOCUMENT_TEXT',referenceId:versions[0]!.id,data:{extractionStatus:'READY',extractorVersion:versions[0]!.extractorVersion}}]} : {}), ...(cached ? { cachedTaskId: cached.id } : {}) })
    return { operation: input.operation, mode: input.mode, tasks, missing, canStart: missing.length === 0 }
  }
  async start(raw: unknown, idempotencyKey: string) {
    if (!idempotencyKey || idempotencyKey.length > 200) throw new OperationError('Idempotency-Key gereklidir.', 400)
    const input = OperationInputSchema.parse(raw), payloadHash = operationHash(input)
    const existing = await this.prisma.operationRequest.findUnique({ where: { actorScope_idempotencyKey: { actorScope: this.scope, idempotencyKey } }, include: included })
    if (existing) { if (existing.payloadHash !== payloadHash) throw new OperationError('Aynı işlem anahtarı farklı girdilerle kullanıldı.', 409); return existing }
    const plan = await this.plan(input)
    if (!plan.canStart) throw new OperationError(`İşlem ön koşulları eksik: ${plan.missing.map(m => m.reason).join(', ')}`)
    try { return await this.prisma.$transaction(async tx => {
      const request = await tx.operationRequest.create({ data: { ...resourceOwnership(), actorScope: this.scope, idempotencyKey, payloadHash, operation: input.operation, mode: input.mode, sourceRunId:input.sourceRunId ?? null, parameters: json(input), status: plan.tasks.every(t => t.reused) ? 'SUCCEEDED' : 'QUEUED' } })
      const taskIds = new Map<string,string>()
      for (const planned of plan.tasks) {
        const dependencies = (planned.signatureDependencies ?? []).map(sig => taskIds.get(sig)!).filter(Boolean)
        const task = await tx.operationTask.create({ data: { ...resourceOwnership(), requestId: request.id, actorScope: this.scope, operation: planned.operation, inputSignature: planned.inputSignature, parameters: json(planned.parameters), dependencyIds: dependencies, status: planned.status, reused: planned.reused } })
        taskIds.set(planned.inputSignature, task.id)
        if (planned.cachedTaskId) {
          const artifacts = await tx.operationArtifact.findMany({ where: { taskId: planned.cachedTaskId } })
          for (const a of artifacts) {
            const data = a.kind === 'REPORT_DRAFT' && a.data && typeof a.data === 'object' && !Array.isArray(a.data) ? {...a.data,previousReportTaskId:planned.cachedTaskId,reusedFromTaskId:planned.cachedTaskId} : a.data
            await tx.operationArtifact.create({ data: { taskId: task.id, kind: a.kind, referenceId: a.referenceId, objectKey: a.objectKey, ...(data !== null ? { data: json(data) } : {}) } })
            if(a.kind === 'REPORT_DRAFT' && data) await tx.reportDraft.create({data:{...resourceOwnership(),operationTaskId:task.id,actorScope:this.scope,baseVersion:0,specJson:json(data)}})
          }
        } else if(planned.existingArtifacts) {
          for(const a of planned.existingArtifacts) await tx.operationArtifact.create({data:{taskId:task.id,kind:a.kind,referenceId:a.referenceId ?? null,...(a.data ? {data:json(a.data)}:{})}})
        } else await tx.operationOutbox.create({ data: { taskId: task.id } })
      }
      return tx.operationRequest.findUniqueOrThrow({ where: { id: request.id }, include: included })
    }) } catch(error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.operationRequest.findUnique({ where: { actorScope_idempotencyKey: { actorScope: this.scope, idempotencyKey } }, include: included })
        if (raced?.payloadHash === payloadHash) return raced
        throw new OperationError('İşlem anahtarı çakıştı.', 409)
      } throw error
    }
  }
  async get(id: string) {
    const request = await this.prisma.operationRequest.findFirst({ where: { id, actorScope: this.scope }, include: included })
    if (!request) throw new OperationError('İşlem bulunamadı.', 404)
    return request
  }
  async cancel(id: string) {
    await this.get(id)
    await this.prisma.$transaction(async tx => {
      await tx.operationRequest.update({ where: { id }, data: { cancelRequested: true } })
      await tx.operationTask.updateMany({ where: { requestId: id, status: { in: ['QUEUED','WAITING_INPUT','BLOCKED'] } }, data: { status: 'CANCELLED' } })
    }); await this.refreshRequest(id); return this.get(id)
  }
  async retry(id: string) {
    const task = await this.prisma.operationTask.findFirst({ where: { id, actorScope: this.scope }, include: { request: true } })
    if (!task) throw new OperationError('Görev bulunamadı.', 404)
    if (task.request.cancelRequested || !['FAILED','BLOCKED','PARTIAL'].includes(task.status)) throw new OperationError('Bu görev tekrar denenemez.', 409)
    await this.prisma.$transaction(async tx => {
      const changed = await tx.operationTask.updateMany({ where: { id, status: task.status }, data: { status: 'QUEUED', errorCategory: null, errorMessage: null } })
      if (!changed.count) throw new OperationError('Görev değişti.', 409)
      await tx.operationOutbox.create({ data: { taskId: id } })
      await tx.operationRequest.update({ where: { id: task.requestId }, data: { status: 'QUEUED' } })
    }); return this.get(task.requestId)
  }
  async refreshRequest(id: string) {
    const tasks = await this.prisma.operationTask.findMany({ where: { requestId: id } })
    const statuses = tasks.map(t => t.status)
    const status = statuses.every(s => s === 'SUCCEEDED') ? 'SUCCEEDED' : statuses.some(s => s === 'RUNNING') ? 'RUNNING' : statuses.some(s => s === 'QUEUED') ? 'QUEUED' : statuses.every(s => s === 'CANCELLED') ? 'CANCELLED' : statuses.includes('PARTIAL') || statuses.includes('SUCCEEDED') ? 'PARTIAL' : statuses.includes('FAILED') ? 'FAILED' : statuses.includes('BLOCKED') ? 'BLOCKED' : 'WAITING_INPUT'
    await this.prisma.operationRequest.update({ where: { id }, data: { status } })
  }
  async execute(taskId: string) {
    const owner = randomUUID(), now = new Date()
    const task = await this.prisma.operationTask.findUnique({ where: { id: taskId }, include: { request: true } })
    if (!task || ['SUCCEEDED','FAILED','CANCELLED','BLOCKED','PARTIAL'].includes(task.status)) return
    if (task.request.cancelRequested) { await this.prisma.operationTask.updateMany({ where: { id: taskId, status: 'QUEUED' }, data: { status: 'CANCELLED' } }); return }
    const dependencies = await this.prisma.operationTask.findMany({ where: { id: { in: task.dependencyIds } } })
    if (dependencies.some(d => ['FAILED','BLOCKED','CANCELLED','PARTIAL'].includes(d.status))) {
      await this.prisma.operationTask.updateMany({ where: { id: taskId, status: 'QUEUED' }, data: { status: 'BLOCKED', errorCategory: 'DEPENDENCY_FAILED', errorMessage: 'Ön koşul görevi tamamlanamadı.' } }); await this.refreshRequest(task.requestId); return
    }
    if (dependencies.length !== task.dependencyIds.length || dependencies.some(d => d.status !== 'SUCCEEDED')) throw new OperationError('Ön koşul görevi henüz tamamlanmadı.', 503, 'DEPENDENCY_PENDING')
    const claimed = await this.prisma.operationTask.updateMany({ where: { id: taskId, OR: [{ status: 'QUEUED' }, { status: 'RUNNING', leaseUntil: { lt: now } }] }, data: { status: 'RUNNING', leaseOwner: owner, leaseUntil: new Date(Date.now()+90_000), attemptNumber: { increment: 1 } } })
    if (!claimed.count) return
    const current = await this.prisma.operationTask.findUniqueOrThrow({ where: { id: taskId } }), fence = { id: taskId, status: 'RUNNING', leaseOwner: owner, attemptNumber: current.attemptNumber }
    const attempt = await this.prisma.operationAttempt.create({ data: { taskId, number: current.attemptNumber, leaseOwner: owner } })
    await this.refreshRequest(task.requestId)
    const controller = new AbortController()
    const heartbeat = setInterval(() => void (async () => {
      const request = await this.prisma.operationRequest.findUnique({ where: { id: task.requestId } })
      if (request?.cancelRequested) { controller.abort(); return }
      const updated = await this.prisma.operationTask.updateMany({ where: fence, data: { leaseUntil: new Date(Date.now()+90_000) } })
      if (!updated.count) controller.abort()
    })().catch(() => controller.abort()), 25_000)
    try {
      const parameters = OperationTaskParametersSchema.parse(current.parameters), executor = this.executors[parameters.operation]
      if (!executor) throw new OperationError('İşlem yürütücüsü mevcut değil.', 422, 'EXECUTOR_UNAVAILABLE')
      const artifacts = await executor(parameters, { taskId, actorScope: current.actorScope, signal: controller.signal })
      const partial = !sourceArtifactIsComplete(parameters.operation,artifacts)
      await this.prisma.$transaction(async tx => {
        const request = await tx.operationRequest.findUniqueOrThrow({ where: { id: task.requestId } })
        const cancelled = controller.signal.aborted || request.cancelRequested
        const updated = await tx.operationTask.updateMany({ where: fence, data: { status: cancelled ? 'CANCELLED' : partial ? 'PARTIAL' : 'SUCCEEDED', leaseUntil: null } })
        if (!updated.count) throw new OperationError('Görev sahipliği değişti.', 409, 'STALE_LEASE')
        if (!cancelled) for (const artifact of artifacts) {
          await tx.operationArtifact.create({ data: { taskId, kind: artifact.kind, referenceId: artifact.referenceId ?? null, objectKey: artifact.objectKey ?? null, ...(artifact.data !== undefined ? { data: json(artifact.data) } : {}) } })
          if(artifact.kind === 'REPORT_DRAFT' && artifact.data) {
            const draft = await tx.reportDraft.create({data:{...resourceOwnership(),operationTaskId:taskId,actorScope:current.actorScope,baseVersion:0,specJson:json(artifact.data)}})
            const edits = parameters.reportEdits
            if(edits) for(const [index,[path,value]] of Object.entries(edits).entries()) await tx.reportFieldEdit.create({data:{draftId:draft.id,sequence:index+1,path:`reportContent.${path}`,nextValue:json(value),source:'USER'}})
          }
        }
        await tx.operationAttempt.update({ where: { id: attempt.id }, data: { status: cancelled ? 'CANCELLED' : partial ? 'PARTIAL' : 'SUCCEEDED', completedAt: new Date() } })
      })
    } catch(error) {
      const category = error instanceof OperationError ? error.category : typeof error === 'object' && error && 'category' in error ? String(error.category) : 'EXECUTION_FAILED'
      const message = error instanceof OperationError ? error.message : ['AUTHENTICATION','PERMISSION'].includes(category) ? 'Yapay zekâ sağlayıcısına erişim izni bulunmuyor.' : category === 'EXECUTION_FAILED' ? 'İşlem tamamlanamadı; görev girdilerini ve servis bağlantısını kontrol edin.' : `İşlem sağlayıcı hatasıyla durdu (${category}).`
      const transient = ['PROVIDER_UNAVAILABLE','RATE_LIMITED','TIMEOUT','DEPENDENCY_PENDING'].includes(category) && current.attemptNumber < 3
      const cancelled = controller.signal.aborted
      await this.prisma.$transaction(async tx => {
        const updated = await tx.operationTask.updateMany({ where: fence, data: { status: cancelled ? 'CANCELLED' : transient ? 'QUEUED' : 'FAILED', errorCategory: category, errorMessage: message.slice(0,2000), leaseUntil: null } })
        if (updated.count) {
          await tx.operationAttempt.update({ where: { id: attempt.id }, data: { status: cancelled ? 'CANCELLED' : 'FAILED', errorMessage: message.slice(0,2000), completedAt: new Date() } })
          if (transient) await tx.operationOutbox.create({ data: { taskId, availableAt: new Date(Date.now()+30_000*current.attemptNumber) } })
        }
      })
    } finally { clearInterval(heartbeat); await this.refreshRequest(task.requestId) }
  }
}
