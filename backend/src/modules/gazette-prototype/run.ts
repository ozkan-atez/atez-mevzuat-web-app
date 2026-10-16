import { type Analyst, type Bundle, type Collector, type Decision, type Entry, type GazetteRequest, type Index, type TitleDecision } from './contracts'

export async function runGazette(request:GazetteRequest, collector:Collector, analyst:Analyst, save:(name:string,value:unknown)=>Promise<void>, progress:(text:string)=>void) {
  const result={schemaVersion:'0.1',prototype:true,date:request.date,startedAt:new Date().toISOString(),completedAt:null as string|null,status:'RUNNING',
    evidenceAudit:{status:'PENDING',note:'İşlem tamamlanması hukuki doğruluk onayı değildir. Görsel alıntılar ve iddia/kanıt kapsamı bağımsız denetim gerektirir.'},
    indices:[] as Index[],supplements:{status:'UNKNOWN',checkedAt:null as string|null,scope:'Hedef günün sayfasındaki mükerrer bağlantıları; kontrol anından sonra yayımlananları kapsamaz.'},
    pages:[] as Bundle[],regulations:[] as Array<{entry:Entry;analysis:Decision|null;error:string|null}>,
    announcements:[] as Array<{entry:Entry;titleDecision:TitleDecision|null;analysis:Decision|null;error:string|null}>,errors:[] as string[],
    counts:{topLevelLinks:0,regulations:0,announcementItems:0,IN:0,OUT:0,REVIEW:0}}
  const checkpoint=()=>save('result.json',result)
  await checkpoint()
  try {
    const main=await collector.index(request.date);result.indices.push(main)
    if(request.expectedMainLinks!==undefined&&main.entries.length!==request.expectedMainLinks)result.errors.push(`Ana fihrist bağlantı sayısı: beklenen ${request.expectedMainLinks}, bulunan ${main.entries.length}`)
    const pending=[...main.supplementUrls],seen=new Set([main.url])
    while(pending.length){
      const url=pending.shift()!;if(seen.has(url))continue;seen.add(url)
      if(seen.size>10){result.errors.push('Mükerrer keşif sınırına ulaşıldı.');break}
      const index=await collector.index(request.date,url);result.indices.push(index);pending.push(...index.supplementUrls)
    }
    result.supplements={...result.supplements,status:result.indices.length>1?'FOUND':'NONE_OBSERVED',checkedAt:new Date().toISOString()}
    const entries=[...new Map(result.indices.flatMap(i=>i.entries).map(e=>[e.url,e])).values()]
    result.counts.topLevelLinks=entries.length
    const announcementEntries:Entry[]=[]
    for(const entry of entries) {
      progress(`Okunuyor: ${entry.title}`)
      const bundle=await collector.collect(entry,entry.kind==='REGULATION')
      result.pages.push(bundle);await save(`${entry.id}.bundle.json`,bundle)
      if(entry.kind==='REGULATION'){
        let analysis:Decision|null=null,error:string|null=null
        try {analysis=await analyst.analyze(bundle)}catch(e){error=e instanceof Error?e.message:'Analiz başarısız'}
        result.regulations.push({entry,analysis,error})
      }else{
        if(bundle.errors.length)result.errors.push(...bundle.errors)
        const children=await collector.announcementEntries(entry,bundle)
        announcementEntries.push(...(children.length?children:[entry]))
      }
      await checkpoint()
    }
    const unique=[...new Map(announcementEntries.map(e=>[e.id,e])).values()]
    progress(`${unique.length} ilan başlığı değerlendiriliyor.`)
    let titles:TitleDecision[]=[]
    try {if(unique.length)titles=await analyst.titles(unique)}catch(e){result.errors.push(e instanceof Error?e.message:'Başlık analizi başarısız')}
    for(const entry of unique){
      const titleDecision=titles.find(t=>t.id===entry.id)??null
      let analysis:Decision|null=null,error:string|null=null
      // A top-level content page without individual notices (e.g. daily exchange-rate images)
      // must be read even when it is not a legislative amendment.
      if(titleDecision?.decision!=='OUT'||entries.some(e=>e.id===entry.id)){
        progress(`İlan içeriği inceleniyor: ${entry.title}`)
        const bundle=await collector.collect(entry)
        await save(`${entry.id}.bundle.json`,bundle)
        try {analysis=await analyst.analyze(bundle)}catch(e){error=e instanceof Error?e.message:'Analiz başarısız'}
      }
      result.announcements.push({entry,titleDecision,analysis,error});await checkpoint()
    }
    for(const item of result.regulations)result.counts[item.analysis?.decision??'REVIEW']++
    for(const item of result.announcements)result.counts[item.analysis?.decision??(item.titleDecision?.decision==='OUT'?'OUT':'REVIEW')]++
    result.counts.regulations=result.regulations.length;result.counts.announcementItems=result.announcements.length
    result.status=result.errors.length||result.counts.REVIEW?'NEEDS_REVIEW':'COMPLETED'
  }catch(e){result.errors.push(e instanceof Error?e.message:'Çalışma başarısız');result.status='BLOCKED'}
  result.completedAt=new Date().toISOString();await checkpoint();await save('summary.json',summarizeResult(result));return result
}

export function summarizeResult(result:Awaited<ReturnType<typeof runGazette>>) {
  return {
    schemaVersion:result.schemaVersion,date:result.date,issueNumbers:[...new Set(result.indices.map(i=>i.issueNumber))],
    status:result.status,counts:result.counts,supplements:result.supplements,evidenceAudit:result.evidenceAudit,
    regulations:result.regulations.map(({entry,analysis,error})=>({title:entry.title,url:entry.url,decision:analysis?.decision??'REVIEW',summary:analysis?.summary??null,reason:analysis?.reason??error,readable:analysis?.readable??false,evidenceVerification:analysis?.evidenceVerification??'FAILED'})),
    announcements:result.announcements.map(({entry,titleDecision,analysis,error})=>({title:entry.title,url:entry.url,parentUrl:entry.parentUrl,titleDecision:titleDecision?.decision??'REVIEW',decision:analysis?.decision??(titleDecision?.decision==='OUT'?'OUT':'REVIEW'),detailRead:Boolean(analysis),reason:analysis?.reason??error??titleDecision?.reason,evidenceVerification:analysis?.evidenceVerification??'TITLE_ONLY'})),
    errors:result.errors,completedAt:result.completedAt,
  }
}
