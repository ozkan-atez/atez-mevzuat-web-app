import { normalizeGtip, validTariffDate, type TariffLookup } from '../tariff/tariff-lookup'

/** Only source-visible codes and an unambiguous, source-visible effective date drive lookups. */
export async function reportTariffEvidence(input: {
  documents: Array<{id:string;text:string}>
  effectiveDates: Array<{date:string}>
}, lookup?: TariffLookup, signal?: AbortSignal) {
  const sourceText=input.documents.map(d=>d.text).join('\n')
  const codes=[...new Set([...sourceText.matchAll(/\b(\d{4}(?:\.\d{2}){4})\b|(?:GT[İI]P|commodityCode)[\s"':=]*(\d{12})\b/gi)].map(match=>normalizeGtip(match[1]??match[2]!)))]
  const warnings:string[]=[]
  const documents:Array<{id:string;title:string;text:string;url:null;publishedOn:null;role:string}>=[]
  if(!codes.length)return {documents,warnings}
  if(!lookup)return {documents,warnings:['Tariff bağlantısı kullanılamadığı için önceki ve güncel değerler doğrulanamadı.']}
  const dates=[...new Set(input.effectiveDates.map(d=>d.date))].filter(date=>{
    if(!validTariffDate(date))return false
    const [year,month,day]=date.split('-')
    return sourceText.includes(date)||sourceText.includes(`${day}.${month}.${year}`)||sourceText.includes(`${day}/${month}/${year}`)
  })
  if(dates.length!==1)return {documents,warnings:['Tariff karşılaştırması için kaynakta tek ve açık bir yürürlük tarihi belirlenemedi.']}
  if(codes.length>10)return {documents,warnings:['Tariff karşılaştırması 10 GTİP sınırını aşıyor; kapsam daraltılmalı.']}
  const date=dates[0]!
  const previousDate=new Date(Date.parse(`${date}T00:00:00Z`)-86400000).toISOString().slice(0,10)
  for(const code of codes){
    signal?.throwIfAborted()
    try {
      const result=await lookup.lookup({code,date,previousDate,compare:true})
      signal?.throwIfAborted()
      // Authenticated API endpoints are provenance, not public report hyperlinks.
      const {source: _privateEndpoint,...record}=result
      documents.push({id:`tariff:${code}:${date}`,title:`Tariff ${code}: ${previousDate} / ${date}`,text:JSON.stringify({...record,source:'Tariff',classification:'SUPPORTING_NON_AUTHORITATIVE'}),url:null,publishedOn:null,role:'TARIFF'})
      warnings.push(...result.notes)
    }catch(error){
      if(signal?.aborted)throw error
      warnings.push(`${code} için Tariff önceki/güncel karşılaştırması alınamadı.`)
    }
  }
  return {documents,warnings}
}
