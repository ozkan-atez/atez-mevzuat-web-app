import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { cleanup,fireEvent,render,screen,waitFor } from '../../test/test-utils'
import { TemplatesPage } from './TemplatesPage'
import type { TemplateDefinition } from './template-types'
const mocks=vi.hoisted(()=>({list:vi.fn(),request:vi.fn()}))
vi.mock('./api',async()=>({...await vi.importActual('./api'),listTemplates:mocks.list,workspaceRequest:mocks.request}))
const definition:TemplateDefinition={schemaVersion:2,requirements:[{id:'summary',heading:'Yönetici özeti',instruction:'Kararları kaynaklardan özetle.',required:true,enabled:true,scope:'REPORT',length:'SHORT',condition:'',missing:'NOTE'}],components:[{id:'text',name:'Metin',description:'Paragraf',nodes:[{id:'body',type:'paragraph',field:'body',label:'',text:''}]}],layout:[{id:'slot-summary',requirementId:'summary',componentId:'auto',enabled:true,title:'',staticText:'',columns:1,tone:'plain'}],theme:{accent:'#58358c',background:'#ffffff',fontSize:14,spacing:16},shell:{heading:'ATEZ',footer:'',showHeader:true,showLogo:true,showFooter:true}}
const template={id:'t1',name:'Yönetim',description:'',definition,sections:[{id:'summary',heading:'Eski özet',html:'<p>İçerik</p>',enabled:true}],html:'{{sections}}',isActive:true,revision:3}
beforeEach(()=>{vi.clearAllMocks();mocks.list.mockResolvedValue({templates:[template],components:[],defaultHtml:'{{sections}}',defaultSections:template.sections,defaultDefinition:definition});mocks.request.mockImplementation(async(path:string)=>path==='templates/preview'?{html:'<p>Önizleme</p>',components:{text:'<p>Metin</p>','rate-card':'<p>Oran</p>'}}:{...template,revision:4})})
afterEach(cleanup)
describe('template studio',()=>{
 it('edits requirements, undoes changes and saves with a revision precondition',async()=>{
  render(<TemplatesPage/>);fireEvent.click(await screen.findByRole('button',{name:'Şablonu düzenle'}))
  fireEvent.change(screen.getByLabelText('Şablon açıklaması'),{target:{value:'Yeni gereksinim'}})
  fireEvent.click(screen.getByRole('button',{name:'Geri al'}));expect(screen.getByLabelText('Şablon açıklaması')).toHaveValue('Yönetici özeti: Kararları kaynaklardan özetle.')
  fireEvent.click(screen.getByRole('button',{name:'İleri al'}));expect(screen.getByLabelText('Şablon açıklaması')).toHaveValue('Yeni gereksinim')
  fireEvent.click(screen.getByRole('button',{name:'Şablonu kaydet'}));await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith('templates/t1',expect.objectContaining({method:'PATCH'})))
  const call=mocks.request.mock.calls.find(c=>c[0]==='templates/t1')!;expect(JSON.parse(call[1].body)).toMatchObject({expectedRevision:3,description:'Yeni gereksinim',definition:{brief:'Yeni gereksinim'}})
 })
 it('keeps manual edits when an AI response arrives late',async()=>{
  let resolve!:(value:unknown)=>void
  mocks.request.mockImplementation((path:string)=>path==='templates/ai'?new Promise(r=>{resolve=r}):Promise.resolve({components:{text:'<p>Metin</p>'}}))
  render(<TemplatesPage/>);fireEvent.click(await screen.findByRole('button',{name:'Şablonu düzenle'}))
  fireEvent.change(screen.getByLabelText('AI düzenleme isteği'),{target:{value:'Rengi değiştir'}});fireEvent.click(screen.getByRole('button',{name:'Gönder'}))
  fireEvent.change(screen.getByLabelText('Şablon açıklaması'),{target:{value:'Beklerken yaptığım düzenleme'}})
  resolve({definition,componentId:'text'})
  expect(await screen.findByRole('button',{name:'Havuza ekle'})).toBeDisabled();expect(screen.getByLabelText('Şablon açıklaması')).toHaveValue('Beklerken yaptığım düzenleme')
 })
 it('keeps the editor usable after AI failure',async()=>{
  mocks.request.mockImplementation(async(path:string)=>{if(path==='templates/ai')throw new Error('Sağlayıcı yanıt vermedi');return {components:{text:'<p>Metin</p>'}}})
  render(<TemplatesPage/>);fireEvent.click(await screen.findByRole('button',{name:'Şablonu düzenle'}))
  fireEvent.change(screen.getByLabelText('AI düzenleme isteği'),{target:{value:'Yeni kart'}});fireEvent.click(screen.getByRole('button',{name:'Gönder'}))
  expect(await screen.findByText('Sağlayıcı yanıt vermedi')).toBeInTheDocument();expect(screen.getByLabelText('Şablon açıklaması')).toBeEnabled();expect(screen.getByRole('button',{name:'Şablonu kaydet'})).toBeEnabled()
 })
 it('adds an AI component to the pool without forcing it into the layout',async()=>{
  const component={...definition.components[0],id:'rate-card',name:'Oran kartı',description:'Oran değişikliği varsa kullan.'}
  mocks.request.mockImplementation(async(path:string)=>path==='templates/ai'?{definition:{...definition,brief:'Yönetici özeti: Kararları kaynaklardan özetle.',components:[...definition.components,component]},componentId:'rate-card'}:path==='templates/preview'?{components:{text:'<p>Metin</p>','rate-card':'<p>Oran</p>'}}:{...template,revision:4})
  render(<TemplatesPage/>);fireEvent.click(await screen.findByRole('button',{name:'Şablonu düzenle'}))
  expect(screen.queryByRole('tab')).toBeNull();expect(screen.queryByRole('button',{name:'Metin ekle'})).toBeNull()
  fireEvent.change(screen.getByLabelText('AI düzenleme isteği'),{target:{value:'Oran kartı oluştur'}});fireEvent.click(screen.getByRole('button',{name:'Gönder'}))
  fireEvent.click(await screen.findByRole('button',{name:'Havuza ekle'}));fireEvent.click(screen.getByRole('button',{name:'Şablonu kaydet'}))
  await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith('templates/t1',expect.anything()))
  const saved=JSON.parse(mocks.request.mock.calls.find(c=>c[0]==='templates/t1')![1].body)
  expect(saved.definition.components).toHaveLength(2);expect(saved.definition.layout).toEqual(definition.layout)
  expect(JSON.parse(mocks.request.mock.calls.find(c=>c[0]==='templates/ai')![1].body).mode).toBe('COMPONENT')
 })
 it('shows isolated HTML previews and includes prior suggestions in follow-up messages',async()=>{
  const component={...definition.components[0]!,id:'rate-card',name:'Oran kartı',description:'Oran değişince kullan.'}
  mocks.request.mockImplementation(async(path:string)=>path==='templates/ai'?{definition:{...definition,components:[...definition.components,component]},componentId:'rate-card'}:{components:{text:'<p>Metin</p>','rate-card':'<table><tr><td>Örnek oran</td></tr></table>'}})
  render(<TemplatesPage/>);fireEvent.click(await screen.findByRole('button',{name:'Şablonu düzenle'}))
  await waitFor(()=>expect(screen.getByRole('button',{name:'Metin önizlemesini aç'})).toBeEnabled())
  fireEvent.click(screen.getByRole('button',{name:'Metin önizlemesini aç'}));expect(await screen.findByRole('dialog')).toHaveTextContent('Metin');fireEvent.click(screen.getByRole('button',{name:'Kapat'}))
  fireEvent.change(screen.getByLabelText('AI düzenleme isteği'),{target:{value:'Oran kartı oluştur'}});fireEvent.click(screen.getByRole('button',{name:'Gönder'}))
  await screen.findByRole('button',{name:'Havuza ekle'})
  fireEvent.change(screen.getByLabelText('AI düzenleme isteği'),{target:{value:'Son öneriye kısa bir açıklama ekle'}});fireEvent.click(screen.getByRole('button',{name:'Gönder'}))
  await waitFor(()=>expect(mocks.request.mock.calls.filter(c=>c[0]==='templates/ai')).toHaveLength(2))
  const body=JSON.parse(mocks.request.mock.calls.filter(c=>c[0]==='templates/ai')[1]![1].body)
  expect(body.conversation).toEqual([{role:'user',content:'Oran kartı oluştur'},{role:'assistant',content:JSON.stringify(component)}])
  expect(body.instruction).toBe('Son öneriye kısa bir açıklama ekle')
  expect(screen.getAllByTitle('Metin HTML önizlemesi')[0]).toHaveAttribute('sandbox','')
 })

 it('recovers failed previews and keeps them stable while the brief is edited',async()=>{
  let attempts=0
  mocks.request.mockImplementation(async(path:string)=>{if(path==='templates/preview'&&attempts++===0)throw new Error('Geçici bağlantı sorunu');return {components:{text:'<p>Metin</p>'}}})
  render(<TemplatesPage/>);fireEvent.click(await screen.findByRole('button',{name:'Şablonu düzenle'}))
  expect(await screen.findByText('Önizlemeler yüklenemedi')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Yeniden dene'}))
  await waitFor(()=>expect(screen.getByRole('button',{name:'Metin önizlemesini aç'})).toBeEnabled())
  fireEvent.change(screen.getByLabelText('Şablon açıklaması'),{target:{value:''}})
  expect(screen.getByRole('button',{name:'Metin önizlemesini aç'})).toBeEnabled()
  expect(mocks.request.mock.calls.filter(c=>c[0]==='templates/preview')).toHaveLength(2)
 })

})
