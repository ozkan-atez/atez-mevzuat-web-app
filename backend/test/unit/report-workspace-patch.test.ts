import {describe,it,expect} from 'vitest'
import {patchWorkspaceSpec} from '../../src/modules/report-workspace/report-workspace.service'
describe('standalone report patches',()=>{
 const spec={title:'Başlık',html:'<html><body><h1 data-template-content="title">Başlık</h1><p data-template-content="summary">Özet</p><p data-template-content="note">Analiz</p><footer>Kaynak kanıtı</footer></body></html>',reportContent:{title:'Başlık',summary:'Özet',detailedAnalysis:'Analiz'},sourceContext:[{title:'Kişisel belge'}]}
 it('changes selected fields using escaped text while preserving provenance and untouched content',()=>{const result=patchWorkspaceSpec(spec,{edits:[{path:'reportContent.summary',value:'<script>Yeni</script>'}]});expect(result.applied).toHaveLength(1);expect(result.spec).toMatchObject({sourceContext:spec.sourceContext,reportContent:{...spec.reportContent,summary:'<script>Yeni</script>'}});expect((result.spec as typeof spec).html).toContain('&lt;script&gt;Yeni&lt;/script&gt;');expect((result.spec as typeof spec).html).toContain('Kaynak kanıtı');expect(spec.reportContent.summary).toBe('Özet')})
 it('rejects changes to immutable source and markup fields',()=>{for(const path of ['html','sourceContext','reportContent.source'])expect(()=>patchWorkspaceSpec(spec,{edits:[{path,value:'other'}]})).toThrow()})
})
