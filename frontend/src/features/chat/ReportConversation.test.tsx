import { render, screen, cleanup, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, it, expect, vi } from 'vitest'
import { ReportConversation } from './ReportConversation'
import { getReportThread } from './api'
import { useReportDraft } from '../revision/useReportDraft'
vi.mock('./api',()=>({getReportThread:vi.fn()}))
vi.mock('../revision/useReportDraft',()=>({useReportDraft:vi.fn()}))
afterEach(()=>{cleanup();vi.resetAllMocks()})
it('shows teammates and report versions together and sends corrections to the same report',async()=>{
 const submitPrompt=vi.fn().mockResolvedValue(undefined),onOpenReport=vi.fn()
 vi.mocked(useReportDraft).mockReturnValue({isLoading:false,isPrompting:false,isBusy:false,error:null,submitPrompt,reload:vi.fn().mockResolvedValue(undefined),view:null} as unknown as ReturnType<typeof useReportDraft>)
 vi.mocked(getReportThread).mockResolvedValue({reportId:'r1',topicId:'t1',title:'Ortak rapor',latestVersion:2,revisions:[],messages:[
  {id:'m1',role:'USER',content:'Başlığı düzelt',authorId:'u1',authorName:'Ayşe',baseVersion:1,reportVersion:2,status:'COMPLETED',errorDetail:null,createdAt:'2026-10-13T08:00:00Z'},
  {id:'m2',role:'USER',content:'Özeti kısalt',authorId:'u2',authorName:'Bora',baseVersion:2,status:'COMPLETED',errorDetail:null,createdAt:'2026-10-13T08:01:00Z'},
 ]})
 render(<MemoryRouter><ReportConversation id="t1" onOpenReport={onOpenReport} onOpenHistory={()=>{}} onChanged={()=>{}} /></MemoryRouter>)
 await screen.findByText('Başlığı düzelt')
 expect(screen.getByText(/Ayşe ·/)).toHaveTextContent('r1 üzerinden → r2')
 expect(screen.getByText(/Bora ·/)).toBeVisible()
 await userEvent.click(screen.getByRole('button',{name:/Raporu aç/}))
 expect(onOpenReport).toHaveBeenCalledWith('t1',false)
 await userEvent.type(screen.getByRole('textbox',{name:'Mesaj'}),'Son paragrafı düzelt{Enter}')
 await waitFor(()=>expect(submitPrompt).toHaveBeenCalledWith('Son paragrafı düzelt'))
 expect(useReportDraft).toHaveBeenCalledWith('t1',true)
})
