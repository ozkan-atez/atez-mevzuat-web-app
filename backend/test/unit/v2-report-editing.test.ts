import { expect, it } from 'vitest'
import { renderReportHtml } from '../../src/modules/topic-analysis/application/render-report-html'
import { validateReportHtml } from '../../src/modules/topic-analysis/application/validate-report-html'
import { ReportSpecSchema } from '../../src/modules/topic-analysis/domain/report-spec-schemas'
import { applyReportPatch } from '../../src/modules/topic-analysis/domain/report-patch'
it('preserves the studio shell and renders safe inline edits for publication',async()=>{
 const spec=ReportSpecSchema.parse({schemaVersion:1,templateFamily:'bulten-v2',card:'K1',topicId:'00000000-0000-4000-8000-000000000001',reportId:'061026-01',documentTitle:'Test',issueNumber:'1',displayDate:'06.10.2026',typeLabel:'Tebliğ',title:'Test',summary:'Özet',affectedParties:[],dates:[],note:null,source:{label:'RG',url:''},blocks:['B1'],customization:{studioReport:{html:'<!doctype html><html><head><style>.card{color:black}</style></head><body><header>ATEZ</header><article class="card"><h2>Test</h2><p>Özet</p></article><footer>Kaynaklar</footer></body></html>',templateId:'test',revision:1,sections:[]}}})
 const preview=await renderReportHtml(spec)
 expect(preview).toContain('data-field="customization.customHtml"')
 const edited=applyReportPatch(spec,{edits:[{path:'customization.customHtml',value:'<h2>Düzeltilmiş rapor</h2><p>Yeni metin</p><script>alert(1)</script>'}]}).spec
 const html=await renderReportHtml(edited)
 expect(html).toContain('Düzeltilmiş rapor');expect(html).toContain('<header>ATEZ</header>');expect(html).not.toContain('<script')
 expect(()=>validateReportHtml(html,{structuredTemplate:true,card:'K1',topicId:spec.topicId,basename:'01-report.html'})).not.toThrow()
 expect(spec.customization?.studioReport?.html).toContain('Özet')
})
