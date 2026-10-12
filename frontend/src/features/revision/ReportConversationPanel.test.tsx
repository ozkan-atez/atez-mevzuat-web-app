import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {cleanup,render,screen,waitFor} from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import {ReportConversationPanel} from './ReportConversationPanel'
import {workspaceRequest} from './workspace-api'
vi.mock('./workspace-api',async()=>{const actual=await vi.importActual<typeof import('./workspace-api')>('./workspace-api');return {...actual,workspaceRequest:vi.fn()}})
vi.mock('./EditableReportPreview',()=>({EditableReportPreview:()=> <div>Rapor önizlemesi</div>}))
const state={report:{id:'report',title:'Rapor',topicId:null},baseVersion:1,version:1,revision:'published:1',html:'',spec:{summary:'Önce'},draft:null}
const proposal={id:'message',role:'ASSISTANT',content:'Önerilen değişiklikler',createdAt:'2026-10-12T12:00:00Z',authorName:'Ali',authorId:'ali',status:'COMPLETED',appliedPaths:null,proposal:[{path:'summary',previousValue:'Önce',nextValue:'Sonra'},{path:'title',previousValue:'Başlık',nextValue:'Yeni başlık'}]}
beforeEach(()=>{vi.mocked(workspaceRequest).mockImplementation(async(_id,path,body)=>{if(!path)return state;if(path==='/conversations')return {conversations:[{id:'conversation',title:'Özet düzenlemesi',createdByName:'Ali'}],nextCursor:null};if(path==='/revisions')return {revisions:[]};if(path?.includes('/messages'))return body?proposal:{messages:[proposal],nextCursor:null};if(path==='/draft/apply')return {...state,revision:'draft:1',draft:{edits:[]}};return {}})} )
afterEach(()=>{cleanup();vi.clearAllMocks()})
describe('report team conversation panel',()=>{
 it('shows suggestions first and applies only the selected field with the viewed draft token',async()=>{
  const changed=vi.fn();render(<ReportConversationPanel reportId="report" onChanged={changed}/>)
  await screen.findByText('Önerilen değişiklikler')
  expect(vi.mocked(workspaceRequest).mock.calls.some(c=>c[1]==='/draft/apply')).toBe(false)
  await userEvent.click(screen.getByRole('checkbox',{name:'Kısa özet'}))
  await userEvent.click(screen.getByRole('button',{name:'Seçilenleri taslağa al'}))
  await waitFor(()=>expect(workspaceRequest).toHaveBeenCalledWith('report','/draft/apply',{expectedRevision:'published:1',messageId:'message',paths:['summary'],forcePaths:[]}))
  expect(changed).toHaveBeenCalled()
 })
 it('example instructions fill the editor and send within the chosen report conversation',async()=>{
  render(<ReportConversationPanel reportId="report"/>)
  await screen.findByText('Önerilen değişiklikler')
  await userEvent.click(screen.getByRole('button',{name:'Yönetici özetini kısalt'}))
  expect(screen.getByRole('textbox',{name:'Raporda yapılacak değişiklik'})).toHaveValue('Yönetici özetini kısalt')
  await userEvent.click(screen.getByRole('button',{name:'Değişiklik öner'}))
  await waitFor(()=>expect(workspaceRequest).toHaveBeenCalledWith('report','/conversations/conversation/messages',{content:'Yönetici özetini kısalt'}))
 })
})
