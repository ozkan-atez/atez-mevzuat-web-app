import { z } from 'zod'

const id = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(80)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const RequirementSchema = z.object({
  id, heading: z.string().trim().min(1).max(300), instruction: z.string().trim().min(1).max(6000),
  required: z.boolean(), enabled: z.boolean(), scope: z.enum(['REPORT','DOCUMENT']),
  length: z.enum(['SHORT','MEDIUM','DETAILED']), condition: z.string().max(1000),
  missing: z.enum(['NOTE','OMIT','BLOCK']),
}).strict()
export const ComponentNodeSchema = z.object({
  id, type: z.enum(['paragraph','list','table','comparison','timeline','notice','divider','heading']),
  field: id, label: z.string().max(300), text: z.string().max(4000),
}).strict()
export const ComponentSchema = z.object({
  id, name: z.string().trim().min(1).max(200), description: z.string().max(2000),
  nodes: z.array(ComponentNodeSchema).min(1).max(12),
}).strict()
export const PlacementSchema = z.object({
  id, requirementId: id.nullable(), componentId: id, enabled: z.boolean(),
  title: z.string().max(300), staticText: z.string().max(8000),
  columns: z.union([z.literal(1),z.literal(2)]), tone: z.enum(['plain','info','warning']),
}).strict()
export const TemplateDefinitionSchema = z.object({
  brief: z.string().trim().min(1).max(2000).optional(),
  schemaVersion: z.literal(2), requirements: z.array(RequirementSchema).min(1).max(30),
  components: z.array(ComponentSchema).min(1).max(40), layout: z.array(PlacementSchema).min(1).max(60),
  theme: z.object({accent:color,background:color,fontSize:z.number().int().min(10).max(22),spacing:z.number().int().min(4).max(40)}).strict(),
  shell: z.object({heading:z.string().max(300),footer:z.string().max(8000),showLogo:z.boolean(),showHeader:z.boolean(),showFooter:z.boolean()}).strict(),
}).strict().superRefine((value, ctx) => {
  for (const key of ['requirements','components','layout'] as const) {
    if (new Set(value[key].map(x=>x.id)).size !== value[key].length) ctx.addIssue({code:'custom',path:[key],message:'Kimlikler benzersiz olmalıdır.'})
  }
  for (const component of value.components) if (new Set(component.nodes.map(n=>n.id)).size !== component.nodes.length) ctx.addIssue({code:'custom',path:['components'],message:'Bileşen parçası kimlikleri benzersiz olmalıdır.'})
  for (const item of value.layout) {
    if (item.requirementId && !value.requirements.some(r=>r.id===item.requirementId)) ctx.addIssue({code:'custom',path:['layout'],message:'Bağlı içerik bölümü bulunamadı.'})
    if (item.componentId!=='auto' && !value.components.some(c=>c.id===item.componentId)) ctx.addIssue({code:'custom',path:['layout'],message:'Bileşen bulunamadı.'})
    if (!item.requirementId && item.componentId==='auto') ctx.addIssue({code:'custom',path:['layout'],message:'Sabit içerik için bir bileşen seçin.'})
  }
  for (const r of value.requirements.filter(r=>r.enabled)) {
    if (!value.layout.some(p=>p.enabled && p.requirementId===r.id)) ctx.addIssue({code:'custom',path:['layout'],message:`${r.heading} için görünür bir tasarım alanı gerekli.`})
    if (r.required && r.missing==='OMIT') ctx.addIssue({code:'custom',path:['requirements'],message:'Zorunlu bölüm atlanamaz.'})
  }
})
export type TemplateDefinition = z.infer<typeof TemplateDefinitionSchema>
export const ContentFieldSchema = z.object({key:id,text:z.string().max(20000),items:z.array(z.string().max(4000)).max(100),columns:z.array(z.string().max(300)).max(12),rows:z.array(z.array(z.string().max(4000)).max(12)).max(500)}).strict().superRefine((f,c)=>{if(f.rows.some(r=>r.length!==f.columns.length))c.addIssue({code:'custom',message:'Tablo satır ve sütunları eşleşmiyor.'})})
export const TemplateContentSchema = z.object({sections:z.array(z.object({
  requirementId:id, componentId:id, status:z.enum(['READY','MISSING','NOT_APPLICABLE']),
  explanation:z.string().max(4000), evidenceIds:z.array(z.string().min(1).max(300)).max(100),
  fields:z.array(ContentFieldSchema).max(30),
}).strict()).max(30)}).strict()
export type TemplateContent = z.infer<typeof TemplateContentSchema>
export const TemplateReportSchema = z.object({definition:TemplateDefinitionSchema,content:TemplateContentSchema,revision:z.number().int().positive().nullable(),sources:z.array(z.object({id:z.string(),label:z.string(),url:z.string().nullable(),excerpt:z.string()})).max(200)}).strict()
export type TemplateReport = z.infer<typeof TemplateReportSchema>

export function defaultTemplateDefinition():TemplateDefinition {
  const instructions = [
    ['summary','Yönetici özeti','Önemli değişiklikleri ve karar gerektiren noktaları kısa biçimde özetle.'],
    ['sources','Kaynak ve yürürlük','Kaynakları, yayımlanma ve yürürlük tarihlerini, varsa geçiş hükümlerini belirt.'],
    ['impact','Etki analizi','Etkilenen tarafları, iş süreçlerini, maliyet ve uyum etkilerini açıkla. Kaynak bilgisi ile yorumu ayır.'],
    ['comparison','GTİP karşılaştırması','Kanıtlarda bulunan GTİP kodlarının önceki ve yeni durumunu karşılaştır; dayanağı göster. Bilgi yoksa uydurma.'],
    ['actions','Önerilen aksiyonlar','Bulgulara dayalı uygulanabilir adımlar öner. Kaynakta bulunmayan sorumlu ve tarihleri kesin bilgi gibi sunma.'],
  ]
  const components:TemplateDefinition['components'] = [
    ['text','Metin','paragraph'],['list','Madde listesi','list'],['table','Tablo','table'],['compare','Karşılaştırma','comparison'],['timeline','Zaman çizelgesi','timeline'],['notice','Bilgi kutusu','notice'],
  ].map(([id,name,type])=>({id:id!,name:name!,description:`${name} görünümü`,nodes:[{id:'body',type:type as 'paragraph',field:'body',label:'',text:''}]}))
  return {schemaVersion:2,requirements:instructions.map(([id,heading,instruction])=>({id:id!,heading:heading!,instruction:instruction!,required:id!=='comparison',enabled:true,scope:id==='summary'?'REPORT':'DOCUMENT',length:id==='summary'?'SHORT':'MEDIUM',condition:'',missing:'NOTE'})),components,layout:instructions.map(([id])=>({id:`slot-${id}`,requirementId:id!,componentId:'auto',enabled:true,title:'',staticText:'',columns:1,tone:'plain'})),theme:{accent:'#58358c',background:'#ffffff',fontSize:14,spacing:16},shell:{heading:'ATEZ Mevzuat Radarı Günlük Raporu',footer:'',showLogo:true,showHeader:true,showFooter:true}}
}
