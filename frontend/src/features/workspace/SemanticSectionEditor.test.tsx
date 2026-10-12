import {cleanup,fireEvent,render,screen} from '../../test/test-utils'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {SemanticSectionEditor} from './SemanticSectionEditor'
import type {TemplateSection} from './api'
afterEach(cleanup)
const sections:TemplateSection[]=[{id:'stable-1',heading:'Yönetici özeti',html:'',enabled:true,description:'Önemli değişiklikleri özetle',schemaVersion:2},{id:'stable-2',heading:'GTİP karşılaştırması',html:'',enabled:true,description:'Önceki ve yeni değerleri karşılaştır',schemaVersion:2}]
describe('SemanticSectionEditor',()=>{
 it('keeps section identity and instructions on rename and reorder',()=>{
   const change=vi.fn();render(<SemanticSectionEditor sections={sections} onChange={change} disabled={false}/>)
   fireEvent.change(screen.getByLabelText('Bölüm 1 adı'),{target:{value:'Karar özeti'}})
   expect(change).toHaveBeenLastCalledWith([expect.objectContaining({id:'stable-1',heading:'Karar özeti',description:'Önemli değişiklikleri özetle'}),sections[1]])
   fireEvent.click(screen.getByLabelText('GTİP karşılaştırması yukarı taşı'))
   expect(change).toHaveBeenLastCalledWith([expect.objectContaining({id:'stable-2',order:0}),expect.objectContaining({id:'stable-1',order:1})])
 })
 it('preserves the form while AI is busy',()=>{
   render(<SemanticSectionEditor sections={sections} onChange={vi.fn()} disabled/>)
   expect(screen.getByLabelText('Bölüm 1 adı')).toHaveValue('Yönetici özeti')
   expect(screen.getByLabelText('Yönetici özeti açıklaması')).toBeDisabled()
   expect(screen.getByRole('button',{name:/Bölüm ekle/})).toBeDisabled()
 })
})
