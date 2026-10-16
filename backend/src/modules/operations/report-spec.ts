import { DateTime } from 'luxon'
import { ReportSpecSchema, type ReportSpec } from '../topic-analysis/domain/report-spec-schemas'
import { applyAutomationTemplate } from '../topic-analysis/application/apply-automation-template'
import { TemplateReportSchema } from '../workspace/template-definition'

/** One report contract for automated runs, document operations and chat. */
export function operationReportSpec(data:Record<string,any>,id:string,date=new Date()):ReportSpec {
  if(data.reportSpec)return ReportSpecSchema.parse(data.reportSpec)
  const content=data.reportContent??data
  const sources=Array.isArray(data.sourceContext)?data.sourceContext:[]
  const first=sources.find((s:any)=>s.url)??sources[0]
  const source={label:first?.title??'Kullanıcı belgesi',url:first?.url??''}
  const title=String(content.title??data.title)
  const generated=TemplateReportSchema.safeParse(data.templateReport)
  const spec=ReportSpecSchema.parse({schemaVersion:1,templateFamily:'bulten-v2',card:'K5',topicId:id,
    reportId:DateTime.fromJSDate(date).setZone('Europe/Istanbul').toFormat('ddMMyy')+'-01',documentTitle:title,title,
    issueNumber:'Kaynak analizi',displayDate:DateTime.fromJSDate(date).setZone('Europe/Istanbul').toFormat('dd.MM.yyyy'),
    typeLabel:'Kaynak analizi',summary:content.summary||title,note:content.detailedAnalysis??null,
    affectedParties:(data.affectedParties??[]).slice(0,3).map((a:any)=>typeof a==='string'?a:`${a.name}: ${a.impact}`),
    dates:(data.effectiveDates??[]).slice(0,3).map((d:any)=>`${d.date}: ${d.description}`),source,supportingSource:source,
    sourceOrigin:{name:source.label,authority:'SUPPORTING',publicationDateKnown:Boolean(first?.publishedOn)},blocks:['B1','B2','B3','B4','B7','B9','B10'],
    customization:{templateId:data.templateId??null,...(generated.success?{templateReport:generated.data}:{}),sources:sources.slice(0,30).map((s:any,i:number)=>({id:`source-${i}`,label:s.title,url:s.url??'',content:`${s.title}${s.publishedOn?` · ${s.publishedOn}`:''}`,kind:s.url?'URL':'TEXT'}))}})
  if(generated.success)return spec
  return applyAutomationTemplate(spec,{templateId:data.templateId??null,template:data.templateSnapshot})
}
export function readReportSpec(raw:unknown,date?:Date):ReportSpec {
  const parsed=ReportSpecSchema.safeParse(raw)
  if(parsed.success)return parsed.data
  const data=raw as Record<string,any>
  if(data?.reportSpec)return ReportSpecSchema.parse(data.reportSpec)
  if(data?.reportContent&&data?.analysisTaskId)return operationReportSpec(data,data.analysisTaskId,date)
  return ReportSpecSchema.parse(raw)
}
