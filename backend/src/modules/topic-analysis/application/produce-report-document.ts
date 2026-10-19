import { studioRequest } from '../../workspace/studio-bridge'
import type { AiModelClient } from '../../ai/application/ai-model-client'
import { reportFromTemplate } from '../../workspace/template-report'
import type { TemplateReport } from '../../workspace/template-definition'
import { ReportSpecSchema, type ReportSpec } from '../domain/report-spec-schemas'
import { applyAutomationTemplate } from './apply-automation-template'
import { renderReportHtml } from './render-report-html'
import { validateReportHtml } from './validate-report-html'

/** Automation and chat share template application, rendering and publication validation. */
export async function produceReportDocument(input:{base:ReportSpec;workspaceConfig:unknown;evidence:unknown;sources:TemplateReport['sources'];aiModel?:AiModelClient|undefined;model?:string|undefined}) {
  const snapshot=input.workspaceConfig as {template?:unknown;templateId?:string}|null
  const studioSnapshot=(snapshot?.template as {studioSnapshot?:unknown}|null)?.studioSnapshot
  if(studioSnapshot){
    if(!process.env.COMPONENT_STUDIO_URL)throw new Error('Şablon stüdyosu bağlantısı yapılandırılmamış.')
    const studioReport=await studioRequest<{html:string;templateId:string;revision:number;sections:unknown[]}>(process.env.COMPONENT_STUDIO_URL,'/integration/render',{snapshot:studioSnapshot,base:input.base,sources:input.sources,evidence:input.evidence})
    const spec=ReportSpecSchema.parse({...input.base,customization:{...input.base.customization,templateId:snapshot?.templateId??null,studioReport}})
    return {spec,html:studioReport.html,generated:null}
  }
  const generated=await reportFromTemplate(snapshot?.template,input.evidence,input.sources,input.aiModel,input.model)
  const spec=generated?ReportSpecSchema.parse({...input.base,customization:{...input.base.customization,templateId:snapshot?.templateId??null,templateReport:generated.report}}):applyAutomationTemplate(input.base,input.workspaceConfig)
  const html=await renderValidatedReport(spec)
  return {spec,html,generated}
}
export async function renderValidatedReport(spec:ReportSpec) {
  if(spec.customization?.studioReport && !spec.customization.customHtml)return renderReportHtml(spec)
  const html=await renderReportHtml(spec)
  validateReportHtml(html,{card:spec.card,topicId:spec.topicId,basename:spec.card==='K6'?'00-degisiklik-yok.html':'01-report.html',
    structuredTemplate:Boolean(spec.customization?.templateReport),
    customized:Boolean(spec.customization && (spec.customization.customHtml || spec.customization.sections.length || Object.keys(spec.customization.headings).length || spec.customization.order.length)),
    sourceUrlRequired:Boolean(spec.source?.url),allowUnverifiedSource:'sourceOrigin' in spec && spec.sourceOrigin?.authority==='SUPPORTING'})
  return html
}
