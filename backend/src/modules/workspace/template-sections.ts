import { z } from 'zod'
export const sectionSchema = z.object({
  id:z.string().min(1).max(80),heading:z.string().min(1).max(300),html:z.string().max(100000),enabled:z.boolean(),
  description:z.string().max(2000).default(''),instruction:z.string().max(5000).default(''),
  order:z.number().int().min(0).default(0),componentType:z.enum(['paragraph','list','table','sources','legacy']).default('legacy'),
  required:z.boolean().default(false),schemaVersion:z.number().int().min(1).max(2).default(1),
})
export type TemplateSection=z.infer<typeof sectionSchema>
export const semanticMarkup='<section class="block"><h2>{{heading}}</h2>{{content}}</section>'
export const semanticDefaultSections:TemplateSection[] = [
  ['summary','Yönetici özeti','Önemli değişiklikleri ve karar gerektiren noktaları kısa biçimde özetle.','paragraph'],
  ['sources','Kaynak ve yürürlük','Düzenlemenin dayanağını, yayın tarihini ve yürürlüğe giriş koşullarını belirt.','sources'],
  ['impact','Etki analizi','Etkilenen süreçleri, ekipleri, maliyetleri ve uyum konularını açıkla.','list'],
  ['gtip','GTİP karşılaştırması','Kaynaklarda bulunan GTİP kodlarını ve önceki ile yeni değerleri karşılaştır; dayanağı göster.','table'],
  ['actions','Önerilen aksiyonlar','Bulgulara dayalı uygulanabilir adımları listele; kaynakta olmayan sorumlu veya tarihi kesin bilgi gibi yazma.','list'],
].map(([id,heading,description,componentType],order)=>sectionSchema.parse({id,heading,description,componentType,order,instruction:'',enabled:true,required:false,schemaVersion:2,html:semanticMarkup}))
export function templateInstructions(snapshot:unknown):string {
  const parsed=z.object({template:z.object({sections:z.array(sectionSchema)}).nullable().optional(),sourceBindings:z.array(z.unknown()).optional()}).safeParse(snapshot)
  if(!parsed.success||!parsed.data.template)return ''
  const sections=parsed.data.template.sections.filter(s=>s.enabled&&s.schemaVersion===2)
  if(!sections.length)return ''
  return '\nRapor bölümü gereksinimleri (kaynak kanıtı değildir): '+JSON.stringify(sections.map(({id,heading,description,instruction,required,componentType})=>({id,heading,description,instruction,required,componentType})))+'\nBu bölümlerin her biri için templateSections içinde aynı id ile kanıta dayalı içerik üret. Liste bileşenlerinde her öğeyi ayrı satırda yaz. Tablo bileşenlerinde yalnız kanıt varsa başlık ve veri satırlarını | ile ayrılmış metin olarak yaz. Kanıt yeterli değilse evidenceStatus=MISSING ve açık eksiklik notu yaz. Özellikle GTİP, önceki değer, tarih veya sorumlu uydurma.\nKaynak-bölüm eşlemeleri: '+JSON.stringify(parsed.data.sourceBindings??[])
}
