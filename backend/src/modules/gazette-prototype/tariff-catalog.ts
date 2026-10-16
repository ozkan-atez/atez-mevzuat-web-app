import { z } from 'zod'

// Observed on the authenticated tariff-measures-by-commodity endpoint, 2026-10-13.
// A capability is not a promise that every commodity/date has a populated value.
export const tariffFields = {
  commodity_identity:{label:'GTİP, sonek, beyan edilebilirlik ve ürün kimliği',paths:['commodities']},
  product_description:{label:'Ürün adı ve biçimlendirilmiş açıklaması',paths:['commodities[].description','commodities[].formatted_description']},
  product_hierarchy:{label:'Üst ürün grubu, parent_id ve tarife ağacındaki konum',paths:['commodities']},
  commodity_validity:{label:'Ürün kodunun başlangıç/bitiş ve beyan tarihleri',paths:['commodities']},
  measure_identity:{label:'Önlem kimliği, türü, kategorisi ve vergi kodu',paths:['measures[].id','measures[].measureType']},
  measure_value:{label:'Ham ve biçimlendirilmiş oran, tutar veya eşik',paths:['measures[].base_duty','measures[].base_duty_formatted']},
  duty_components:{label:'Oran/tutar, para birimi, miktar ve ölçü birimi bileşenleri',paths:['measures[].dutyExpr']},
  minimum_duty:{label:'Asgari yükümlülük bileşenleri',paths:['measures[].minDutyExpr']},
  maximum_duty:{label:'Azami yükümlülük bileşenleri',paths:['measures[].maxDutyExpr']},
  measure_validity:{label:'Önlemin yürürlük başlangıcı ve bitişi',paths:['measures[].effective_start_date','measures[].effective_end_date']},
  geographical_scope:{label:'Ülke/ülke grubu, kapsam, çeviriler ve geçerlilik',paths:['measures[].areaDetails','measures[].origin','measures[].origin_relation']},
  trade_direction:{label:'İthalat/ihracat/transit ve rejim kapsamı',paths:['measures[].is_import','measures[].is_export','measures[].is_transit','measures[].regime_group_codes','measures[].measureType.regime_group_codes']},
  conditions:{label:'Koşullar, şart kodları, eylemler ve çevirileri',paths:['measures[].conditions']},
  required_documents:{label:'Belge kodları, belge açıklamaları ve geçerlilikleri',paths:['measures[].conditions']},
  exemptions_and_tolerances:{label:'Kapsam dışı referanslar, gözetim istisnaları ve toleranslar',paths:['measures[].conditions']},
  footnotes:{label:'Dipnotlar, açıklamalar, dil ve geçerlilik bilgileri',paths:['measures[].footnoteViews']},
  legal_basis:{label:'Mevzuat başlığı/kimliği, yayım tarihi, RG sayısı/sayfası, URL ve geçerlilik',paths:['measures[].legalActViews']},
  suspension_and_status:{label:'Askıya alma, silinme ve önlem durumları',paths:['measures[].isSuspended','measures[].was_deleted','measures[].deleted_at']},
  quota_reference:{label:'Kontenjan order_number; miktar/bakiye garantisi değildir',paths:['measures[].order_number']},
  provider_metadata:{label:'Sağlayıcı kayıt/revizyon zamanları ve kaynak kimlikleri',paths:['measures[].datasource_code','measures[].owner_assigned_id','measures[].revision_date','measures[].created_at','measures[].updated_at','measures[].source_checksum']},
  raw_provider_payload:{label:'Tüm özgün yanıt; yeni/bilinmeyen alanlar dahil kayıpsız saklama',paths:['$']},
} as const
export const tariffFieldIds=Object.keys(tariffFields) as [keyof typeof tariffFields,...(keyof typeof tariffFields)[]]
export const researchNeedSchema=z.object({
 id:z.string().min(1),fields:z.array(z.enum(tariffFieldIds)).min(1),purpose:z.enum(['PREVIOUS_VALUE','PRODUCT_CONTEXT','PREVIOUS_LEGAL_TEXT']),
 measureKind:z.enum(['CUSTOMS_DUTY','ADDITIONAL_CUSTOMS_DUTY','ADDITIONAL_FINANCIAL_OBLIGATION','SURVEILLANCE_VALUE_THRESHOLD','VAT','QUOTA','OTHER']),
 gtips:z.array(z.string()),origins:z.array(z.string()),effectiveRuleId:z.string().nullable(),provision:z.string(),searchTerms:z.array(z.string()),reason:z.string().min(1),
}).strict()
export type ResearchNeed=z.infer<typeof researchNeedSchema>
export const tariffResearchPrompt=`
Önceki veri araştırması için researchNeeds üret. Bu alanlar sorgu PLANI; bulunmuş eski değer veya kaynak değildir.
Tariff alan kataloğu (yalnız gereken alan kimliklerini fields içine seç):
${Object.entries(tariffFields).map(([id,f])=>`${id}: ${f.label}`).join('\n')}
Her ihtiyaçta GTİPleri, önlem türünü, menşe/kapsamı, ilgili maddeyi, gerekçeyi ve varsa yürürlük kuralı kimliğini belirt. Yürürlük kuralı tanımlanmayan ilk filtre aşamasında effectiveRuleId=null kullan; ayrıntılı çıkarımda effectiveRules kimliğine bağla. IN/OUT kararını Tariff'te veri bulunabilirliğine göre verme. OUT için researchNeeds boş olabilir.
Gözetim kıymeti vergi değildir. Önceki tutar için measure_value,duty_components,measure_validity,geographical_scope,legal_basis ve gerekli conditions/footnotes alanlarını iste. Ürün adı yoksa product_description ve product_hierarchy iste. Önceki hüküm metni için PREVIOUS_LEGAL_TEXT seç; Tariff tam mevzuat arşivi garantisi vermez, Resmî Gazete araştırması gerekir. Kontenjan miktarı/bakiyesi, tam önceki metin ve bütün geçmiş değişiklikler katalog tarafından garanti edilmez.
Kod, önceki sorgu tarihini yeni hükmün YÜRÜRLÜĞÜNDEN bir gün önce hesaplar; yayın tarihiyle karıştırma. 11 Temmuz yürürlükse önceki tarih 10 Temmuzdur; 11 Temmuz yayın ve 10 Ağustos yürürlükse önceki tarih 9 Ağustostur. Kaynakta bilinmeyen yürürlük, menşe veya önceki değerleri uydurma.
Tariff bulunamaz/eksik/çelişkiliyse RG araması için temel mevzuat numarası, başlık ve ilgili madde/ek üzerinden searchTerms üret. Temel mevzuatın ilk yayımı önceki geçerli sürüm değildir. Adayın tarihinin eski olması yeterli değil; aynı hükme etkisi ve karşılaştırma tarihinde yürürlükte olması doğrulanmalı. Kaynak başlığına bakarak içerik okumadan doğru önceki belgeyi seçme.
`

export function providerFieldInventory(payload:unknown){
 const found=new Map<string,Set<string>>()
 const walk=(value:unknown,path:string)=>{
  const type=value===null?'null':Array.isArray(value)?'array':typeof value
  const types=found.get(path)??new Set<string>();types.add(type);found.set(path,types)
  if(Array.isArray(value))value.forEach(v=>walk(v,`${path}[]`))
  else if(value&&typeof value==='object')Object.entries(value).forEach(([k,v])=>walk(v,path?`${path}.${k}`:k))
 };walk(payload,'$')
 return [...found].sort(([a],[b])=>a.localeCompare(b)).map(([path,types])=>({path,types:[...types].sort()}))
}
