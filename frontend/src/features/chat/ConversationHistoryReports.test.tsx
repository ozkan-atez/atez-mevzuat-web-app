import {afterEach,describe,expect,it,vi} from 'vitest'
import {MemoryRouter} from 'react-router-dom'
import {cleanup,render,screen} from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import {ConversationHistory} from './ConversationHistory'
import {workspaceRequest} from '../workspace/api'
vi.mock('../workspace/api',()=>({workspaceRequest:vi.fn()}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
const props={items:[],activeId:undefined,isLoading:false,error:null,onRetry:()=>{},onDelete:()=>{}}
describe('report group pagination',()=>{
 it('loads another report page without losing the first group or exposing general chat deletion',async()=>{
  vi.mocked(workspaceRequest).mockResolvedValueOnce({reports:[{id:'r1',title:'Birinci rapor',conversations:[{id:'c1',title:'Özet düzeltmesi',archivedAt:null}]}],nextCursor:'r1'}).mockResolvedValueOnce({reports:[{id:'r2',title:'İkinci rapor',conversations:[]}],nextCursor:null})
  render(<MemoryRouter><ConversationHistory {...props}/></MemoryRouter>)
  await screen.findByText('Birinci rapor');await userEvent.click(screen.getByRole('button',{name:'Daha fazla rapor'}))
  expect(await screen.findByText('İkinci rapor')).toBeVisible();expect(screen.getByText('Birinci rapor')).toBeVisible()
  expect(workspaceRequest).toHaveBeenLastCalledWith('report-workspaces?cursor=r1')
  expect(screen.queryByRole('button',{name:/sohbetini sil/})).not.toBeInTheDocument()
 })
 it('shows a retriable report history error',async()=>{
  vi.mocked(workspaceRequest).mockRejectedValueOnce(new Error('Bağlantı kurulamadı')).mockResolvedValueOnce({reports:[],nextCursor:null})
  render(<MemoryRouter><ConversationHistory {...props}/></MemoryRouter>)
  await screen.findByText('Bağlantı kurulamadı');await userEvent.click(screen.getByRole('button',{name:'Raporları yeniden yükle'}))
  expect(workspaceRequest).toHaveBeenCalledTimes(2)
 })
})
