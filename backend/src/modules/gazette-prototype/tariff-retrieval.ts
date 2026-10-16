import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clearTariffToken, getTariffAccessToken, type TariffCredentials } from '../managed-sources/tariff-auth'
import { validTariffDate } from '../tariff/tariff-lookup'
import { tariffFields, type ResearchNeed } from './tariff-catalog'
import { createTariffSnapshot } from './tariff-snapshot'

export type FieldId = keyof typeof tariffFields
export type JsonRow = Record<string, any>
export const TARIFF_ENDPOINT = 'https://tariff.singlewindow.io/api/v2-0/tariff-query/tariff-measures-by-commodity'
export interface RetrievalRequest {
  gtip: string; queryDate: string; fields: FieldId[]; measureKind: ResearchNeed['measureKind']; origins: string[]
  legalReferences?: string[]
  expected?: Array<{currency:string|null;unit:string|null;grossWeight?:boolean}>
}
export interface FieldResult {
  status: 'FOUND' | 'MISSING' | 'AMBIGUOUS'; values: Array<{path:string; value:unknown}>
}
export interface RetrievalResult {
  request: RetrievalRequest; status: 'FOUND' | 'PARTIAL' | 'NOT_FOUND' | 'AMBIGUOUS' | 'ERROR'
  fields: Partial<Record<FieldId, FieldResult>>; unresolvedFields: FieldId[]; issues: string[]
  source: {role:'SUPPORTING_TARIFF'; url:string; fetchedAt:string; snapshotFile:string; sha256:string} | null
  selectedMeasureIds: Array<string | number>; legalSources: string[]
}
export const rows = (value: unknown): JsonRow[] => Array.isArray(value) ? value.filter(v=>v && typeof v==='object') : []
const meaningful = (v:unknown):boolean => v!==null && v!==undefined && v!=='' && (!Array.isArray(v) || v.some(meaningful))
const day = (v:unknown) => typeof v==='string' && validTariffDate(v.slice(0,10)) ? v.slice(0,10) : null
function active(row:JsonRow,date:string,start:string,end:string) {
  const from=day(row[start]),to=day(row[end])
  return !!from && from<=date && (row[end]==null || (!!to && to>=date))
}
// Only observed provider codes are mapped. Unknown kinds fail closed instead of guessing by title.
const kinds: Partial<Record<ResearchNeed['measureKind'],string[]>> = {
  SURVEILLANCE_VALUE_THRESHOLD:['TRC057'], CUSTOMS_DUTY:['103','106','142'],
  ADDITIONAL_CUSTOMS_DUTY:['TR059'], ADDITIONAL_FINANCIAL_OBLIGATION:['TR392'], VAT:['TR040'],
}
function leaves(value:unknown,parts:string[],path:string):Array<{path:string;value:unknown}> {
  if(!parts.length)return meaningful(value)?[{path,value}]:[]
  const [part,...rest]=parts
  if(part!.endsWith('[]'))return rows((value as JsonRow)?.[part!.slice(0,-2)]).flatMap((v,i)=>leaves(v,rest,`${path}.${part!.slice(0,-2)}[${i}]`))
  return leaves((value as JsonRow)?.[part!],rest,`${path}.${part}`)
}

/** Selection is independent of network/model calls and never treats a group code as an ISO country. */
export function selectTariffFields(raw:unknown,request:RetrievalRequest):Omit<RetrievalResult,'source'> {
  const payload=raw as JsonRow
  if(!payload || !Array.isArray(payload.measures)||!Array.isArray(payload.commodities))throw new Error('Geçersiz Tariff yanıtı')
  const code=request.gtip.replace(/[.\s]/g,'')
  if(!/^\d{12}$/.test(code)||!validTariffDate(request.queryDate))throw new Error('Tam 12 haneli GTİP ve geçerli tarih gerekli; eksik kod sıfırla tamamlanmaz.')
  const commodities=rows(payload.commodities).filter(c=>c.commodity_code===code && c.declarable===true && active(c,request.queryDate,'commodity_start_date','commodity_end_date'))
  const issues:string[]=[]
  const candidates=rows(payload.measures).filter(m=>kinds[request.measureKind]?.includes(m.measureType?.measure_type_code)
    && active(m,request.queryDate,'effective_start_date','effective_end_date') && m.is_import===true
    && !m.isSuspended && !m.was_deleted && !m.deleted_at)
  const scope=(m:JsonRow)=>rows(Array.isArray(m.areaDetails)?m.areaDetails:[m.areaDetails]).map(a=>a.geographical_area_code)
  // Without an explicit scope, accept only a sole universal record. Country/group overlaps require research.
  const selected=candidates.filter(m=>request.origins.length
    ? request.origins.every(origin=>scope(m).includes(origin)) : candidates.length===1 && scope(m).includes('1011'))
  const ambiguous=selected.length>1 || (selected.length===0 && candidates.length>0)
  if(!kinds[request.measureKind])issues.push('Önlem türü için doğrulanmış sağlayıcı kodu yok.')
  if(ambiguous)issues.push('Ülke/grup veya birden fazla önlem kaydı kesin eşleştirilemedi.')
  if(commodities.length!==1)issues.push('Seçilen tarihte tekil ürün kimliği doğrulanamadı.')
  const fields:RetrievalResult['fields']={}
  let measure=selected.length===1 && commodities.length===1?selected[0]:undefined
  if(measure && request.legalReferences?.length) {
    const labels=rows(measure.legalActViews).map(a=>String(a.regulation_code??'')).join(' ')
    const references:string[]=labels.match(/\b\d{4}\/\d+\b/g)??[]
    if(!request.legalReferences.some(ref=>references.includes(ref))){issues.push('İlgili temel mevzuat numarası sağlayıcı kaynağında eşleştirilemedi.');measure=undefined}
  }
  if(measure && request.expected?.length) {
    const currency=(v:string)=>({'ABD Doları':'USD','ABD doları':'USD','Dolar':'USD','Avro':'EUR','Euro':'EUR','Türk Lirası':'TRY'}[v]??v)
    const unit=(v:string)=>/^(ton|brüt ton)$/i.test(v)?'KGM':/^(kg|kilogram|brüt kg)$/i.test(v)?'KGM':/^(adet)$/i.test(v)?'PCE':v
    const components=rows(measure.dutyExpr)
    const compatible=request.expected.every(e=>components.some(c=>(!e.currency||c.currencyCode===currency(e.currency))&&(!e.unit||String(c.uom??'').split(' ')[0]===unit(e.unit))&&(!e.grossWeight||c.uom==='KGM G')))
    if(!compatible){issues.push('Birim/para birimi veya brüt ağırlık bağlamı eşleşmedi; değer kullanılmadı.');measure=undefined}
  }
  for(const field of request.fields) {
    const commodityField=['commodity_identity','product_description','product_hierarchy','commodity_validity'].includes(field)
    if(field==='raw_provider_payload') {fields[field]={status:'FOUND',values:[{path:'$',value:raw}]};continue}
    const allowed=commodityField?commodities.length===1:!!measure
    let values:Array<{path:string;value:unknown}>=[]
    if(allowed) {
      for(const path of tariffFields[field].paths) {
        if(path.startsWith('measures')) {
          const index=payload.measures.indexOf(measure)
          values.push(...leaves(measure,path.replace(/^measures\[\]\.?/,'').split('.').filter(Boolean),`$.measures[${index}]`))
        } else if(path==='commodities') {
          const cs=field==='product_hierarchy'?rows(payload.commodities).filter(c=>code.startsWith(c.commodity_code)&&active(c,request.queryDate,'commodity_start_date','commodity_end_date')):commodities
          values.push(...cs.map(c=>({path:`$.commodities[${payload.commodities.indexOf(c)}]`,value:c})))
        } else for(const c of commodities)values.push(...leaves(c,path.replace(/^commodities\[\]\.?/,'').split('.'),`$.commodities[${payload.commodities.indexOf(c)}]`))
      }
      // A generic condition container does not establish that a requested document/exemption exists.
      if(field==='required_documents' && !rows(measure?.conditions).some(c=>meaningful(c.document_code)))values=[]
      if(field==='exemptions_and_tolerances' && !rows(measure?.conditions).some(c=>[c.out_of_scope_reference,c.tolerance_quantity,c.surv_exclusion_values].some(meaningful)))values=[]
    }
    fields[field]={status:values.length?'FOUND':ambiguous&&!commodityField?'AMBIGUOUS':'MISSING',values}
  }
  const unresolvedFields=request.fields.filter(f=>fields[f]?.status!=='FOUND')
  return {request,fields,unresolvedFields,issues,status:!unresolvedFields.length?'FOUND':ambiguous?'AMBIGUOUS':Object.values(fields).some(f=>f?.status==='FOUND')?'PARTIAL':'NOT_FOUND',
    selectedMeasureIds:measure?[measure.id]:[],legalSources:measure?[...new Set(rows(measure.legalActViews).map(a=>a.regulation_url).filter((u):u is string=>typeof u==='string'&&/^https?:\/\//.test(u)))]:[]}
}
export interface TariffRetriever { retrieve(request:RetrievalRequest):Promise<RetrievalResult> }
export class AuthenticatedTariffRetriever implements TariffRetriever {
  private cache=new Map<string,Promise<{raw:unknown;source:NonNullable<RetrievalResult['source']>}>>()
  constructor(private credentials:TariffCredentials,private directory:string,private fetcher:typeof fetch=fetch){}
  async retrieve(request:RetrievalRequest):Promise<RetrievalResult> {
    try {
      const code=request.gtip.replace(/[.\s]/g,'')
      if(!/^\d{12}$/.test(code)||!validTariffDate(request.queryDate))throw new Error('Geçersiz GTİP/tarih')
      const key=`${code}-${request.queryDate}`
      let pending=this.cache.get(key)
      if(!pending){pending=this.download(code,request.queryDate);this.cache.set(key,pending);pending.catch(()=>this.cache.delete(key))}
      const {raw,source}=await pending
      return {...selectTariffFields(raw,request),source}
    }catch(error){return {request,status:'ERROR',fields:{},unresolvedFields:request.fields,issues:[error instanceof Error?error.message:'Tariff sorgusu başarısız'],source:null,selectedMeasureIds:[],legalSources:[]}}
  }
  private async download(gtip:string,queryDate:string) {
    const url=`${TARIFF_ENDPOINT}?${new URLSearchParams({commodityCode:gtip,countryCode:'TR',queryType:'import',queryDate})}`
    for(let attempt=0;attempt<2;attempt++) {
      const token=await getTariffAccessToken(this.credentials,this.fetcher)
      const response=await this.fetcher(url,{headers:{Accept:'application/json',Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)})
      if(response.status===401&&attempt===0){clearTariffToken();continue}
      if(!response.ok)throw new Error(`Tariff HTTP ${response.status}`)
      const chunks:Uint8Array[]=[];let size=0
      if(!response.body)throw new Error('Tariff yanıtı boş')
      for await(const chunk of response.body){size+=chunk.length;if(size>8_000_000)throw new Error('Tariff yanıt boyutu sınırı');chunks.push(chunk)}
      const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const snapshot=createTariffSnapshot(raw,{gtip,queryDate,url})
      await mkdir(this.directory,{recursive:true})
      const snapshotFile=join(this.directory,`${gtip}-${queryDate}-${snapshot.sha256.slice(0,12)}.json`)
      await writeFile(snapshotFile,JSON.stringify(snapshot,null,2))
      return {raw,source:{role:'SUPPORTING_TARIFF' as const,url,fetchedAt:snapshot.fetchedAt,snapshotFile,sha256:snapshot.sha256}}
    }
    throw new Error('Tariff oturumu yenilenemedi')
  }
}
