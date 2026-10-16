import type { ResearchPlan, OfficialResearcher, OfficialResearchResult } from './official-research'
import type { FieldId, TariffRetriever, RetrievalResult } from './tariff-retrieval'

/** Preserves successful fields and groups only identical missing-field sets for official research. */
export async function executeResearch(plan:ResearchPlan,tariff:TariffRetriever,official:OfficialResearcher) {
  const tariffResults:RetrievalResult[]=[]
  const officialResults:Array<{fields:FieldId[];gtips:string[];result:OfficialResearchResult}>=[]
  if(plan.executionStatus!=='PLANNED')return {id:plan.id,status:'REVIEW',reason:plan.executionStatus,tariffResults,officialResults}
  const pending=new Map<string,{fields:FieldId[];gtips:string[]}>()
  if(plan.tariff) {
    for(const gtip of plan.tariff.gtips) {
      const result=await tariff.retrieve({gtip:gtip.normalized!,queryDate:plan.tariff.queryDate!,fields:plan.tariff.requestedFields as FieldId[],measureKind:plan.tariff.measureKind,origins:plan.tariff.origins,
        legalReferences:plan.provenance.baseInstrument.flatMap(i=>i&&typeof i==='object'&&'number' in i&&typeof i.number==='string'&&/^\d{4}\/\d+$/.test(i.number)?[i.number]:[]),
        expected:plan.tariff.comparisonContext.flatMap(t=>t.measureRequirements.map(r=>({currency:r.currency,unit:r.unit,grossWeight:t.footnotes.some(f=>/brüt/i.test(f))})))})
      tariffResults.push(result)
      if(result.unresolvedFields.length){const fields=[...result.unresolvedFields].sort(),key=fields.join('|');const group=pending.get(key)??{fields,gtips:[]};group.gtips.push(gtip.normalized!);pending.set(key,group)}
    }
  } else pending.set('legal',{fields:plan.need.fields,gtips:plan.need.gtips})
  for(const group of pending.values()) {
    try{officialResults.push({...group,result:await official.research(plan,group.fields,group.gtips)})}
    catch(error){officialResults.push({...group,result:{status:'REVIEW',search:{candidates:[],complete:false,errors:[],requestFiles:[]},analysis:null,sources:[],issues:[error instanceof Error?error.message:'Resmî Gazete araştırması başarısız']}})}
  }
  const status=officialResults.some(r=>r.result.status==='REVIEW')?'REVIEW':officialResults.some(r=>r.result.status==='NOT_FOUND')?'NOT_FOUND':'FOUND'
  return {id:plan.id,status,tariffResults,officialResults,
    provenance:{currentAmendmentUrl:plan.provenance.currentAmendmentUrl,baseInstrument:plan.provenance.baseInstrument},evidenceResolved:status==='FOUND'}
}
