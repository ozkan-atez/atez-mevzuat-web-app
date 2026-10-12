import { describe,it,expect,vi } from 'vitest'
import { normalizeTemplateSections } from '../../src/modules/workspace/report-template-catalog'
import { semanticDefaultSections, templateInstructions } from '../../src/modules/workspace/template-sections'
import { renderSemanticContent } from '../../src/modules/workspace/render-semantic-section'
import { applyAutomationTemplate } from '../../src/modules/topic-analysis/application/apply-automation-template'
import { ReportSpecSchema } from '../../src/modules/topic-analysis/domain/report-spec-schemas'
import { sourceAccessWhere, sourceCredentialWorkspace } from '../../src/modules/managed-sources/source-access'
import { runWithActorContext, type ActorContext } from '../../src/platform/actor-context'
import { dispatchSourceSetups, executeSourceSetup } from '../../src/modules/managed-sources/source-setup'
const actor={userId:'alice',identityId:'identity',workspaceId:'team-a',role:'ADMIN',permissions:['config.manage'],issuer:'test',subject:'alice'} satisfies ActorContext
const spec=ReportSpecSchema.parse({schemaVersion:1,templateFamily:'bulten-v2',reportId:'121026-01',topicId:'11111111-1111-4111-8111-111111111111',card:'K1',documentTitle:'Test',issueNumber:'33381',displayDate:'12 Ekim 2026',typeLabel:'Düzenleme',title:'Başlık',summary:'Özet',affectedParties:[],dates:[],note:null,source:{label:'Kaynak',url:'https://example.com'},blocks:['B1','B10']})
describe('semantic template contract',()=>{
 it('preserves stable IDs, custom headings, duplicate titles and instructions while replacing untrusted markup',()=>{
   const sections=[{...semanticDefaultSections[0]!,id:'first',heading:'Özel başlık',description:'İthalat etkisini açıkla',instruction:'Yalnız kaynak kanıtını kullan',html:'<script>alert(1)</script>'},{...semanticDefaultSections[1]!,id:'second',heading:'Özel başlık'}]
   const normalized=normalizeTemplateSections(sections)
   expect(normalized.map(s=>s.id)).toEqual(['first','second']);expect(normalized[0]).toMatchObject({heading:'Özel başlık',description:'İthalat etkisini açıkla',instruction:'Yalnız kaynak kanıtını kullan',order:0})
   expect(normalized[0]!.html).not.toContain('script')
   expect(templateInstructions({template:{sections:normalized}})).toContain('İthalat etkisini açıkla')
 })
 it('blocks required missing evidence but renders optional missing evidence explicitly',()=>{
   const section={...semanticDefaultSections[3]!,required:true}
   expect(()=>applyAutomationTemplate(spec,{template:{sections:[section]}})).toThrow('zorunlu bölüm')
   const result=applyAutomationTemplate(spec,{template:{sections:[{...section,required:false}]}})
   expect(result.customization?.customHtml).toContain('yeterli kaynak kanıtı bulunamadı')
   expect(result.customization?.customHtml).toContain('GTİP karşılaştırması')
 })
 it('renders only application-owned components and escapes model text',()=>{
   expect(renderSemanticContent({componentType:'list'},'- <script>\n- İkinci')).toContain('&lt;script&gt;')
   expect(renderSemanticContent({componentType:'table'},'Kod | Önceki | Yeni\n12 | 1 | 2')).toContain('<th>Önceki</th>')
   expect(renderSemanticContent({componentType:'table'},'Kanıt eksik','MISSING')).not.toContain('<table>')
 })
})
describe('source setup isolation and dispatch',()=>{
 it('keeps tenant credentials and custom sources scoped while allowing the shared built-in catalog',()=>runWithActorContext(actor,()=>{
   expect(sourceCredentialWorkspace()).toBe('team-a')
   expect(sourceAccessWhere()).toEqual({OR:[{workspaceId:'team-a'},{workspaceId:null,key:{in:expect.arrayContaining(['resmi-gazete'])}}]})
 }))
 it('dispatches durable setup once with the same queue id and marks dispatch only after send',async()=>{
   const prisma={sourceSetupJob:{findMany:vi.fn().mockResolvedValue([{id:'job'}]),update:vi.fn()}} as any
   const queue={send:vi.fn().mockResolvedValue('sent')}
   await dispatchSourceSetups(prisma,queue)
   expect(queue.send).toHaveBeenCalledWith('atez-source-setup',{jobId:'job'},{singletonKey:'source-setup:job'})
   expect(prisma.sourceSetupJob.update).toHaveBeenCalledWith({where:{id:'job'},data:{dispatchedAt:expect.any(Date)}})
   queue.send.mockRejectedValueOnce(new Error('offline'));prisma.sourceSetupJob.update.mockClear()
   await expect(dispatchSourceSetups(prisma,queue)).rejects.toThrow('offline');expect(prisma.sourceSetupJob.update).not.toHaveBeenCalled()
 })
 it('never invokes AI or external reading for a superseded or completed setup',async()=>{
   const update=vi.fn(),model={generateStructured:vi.fn()}
   const prisma={sourceSetupJob:{findUniqueOrThrow:vi.fn().mockResolvedValue({id:'job',status:'QUEUED',revision:1,source:{setupRevision:2}}),update}} as any
   await executeSourceSetup(prisma,'job',model,'test')
   expect(update).toHaveBeenCalledWith({where:{id:'job'},data:{status:'SUPERSEDED'}});expect(model.generateStructured).not.toHaveBeenCalled()
 })
})

describe('template source mapping snapshots',()=>{
 it('rejects unavailable required sources and excludes unselected optional sources',async()=>{
  const {snapshotTemplateBindings}=await import('../../src/modules/workspace/template-bindings')
  const source={name:'Kaynak',key:'s',kind:'WEB',isActive:true,setupStatus:'READY',collectionDocuments:[]}
  const findMany=vi.fn().mockResolvedValue([{id:'binding',sourceId:'s',sectionId:'summary',required:false,source}])
  const prisma={sourceTemplateBinding:{findMany}} as any
  expect(await snapshotTemplateBindings(prisma,'template',[{id:'summary'}],['other'])).toEqual([])
  findMany.mockResolvedValueOnce([{id:'binding',sourceId:'s',sectionId:'summary',required:true,source}])
  await expect(snapshotTemplateBindings(prisma,'template',[{id:'summary'}],['other'])).rejects.toThrow('zorunlu kaynağı')
  findMany.mockResolvedValueOnce([{id:'binding',sourceId:'s',sectionId:'removed',required:false,source}])
  await expect(snapshotTemplateBindings(prisma,'template',[{id:'summary'}],['s'])).rejects.toThrow('bölümü değişti')
 })
})
