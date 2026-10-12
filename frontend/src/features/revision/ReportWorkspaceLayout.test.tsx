import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportWorkspace } from './ReportWorkspace'
vi.mock('./ReportConversationPanel',()=>({ReportConversationPanel:()=> <section aria-label="AI ile raporu düzenle"><textarea aria-label="Raporda yapılacak değişiklik"/></section>}))
vi.mock('../analysis/api',()=>({getTopic:vi.fn(async()=>({id:'topic1',runId:'run1',title:'ATEZ raporu',reportVersion:2,reportCard:'K1',thread:{messages:[]}}))}))
vi.mock('../delivery/api',()=>({getDeliveryContext:vi.fn(async()=>({sources:[]})),downloadReportPdf:vi.fn()}))
vi.mock('./api',()=>({getReportDraftHistory:vi.fn(async()=>({revisions:[{version:2,createdAt:'2026-10-12T10:00:00Z',edits:[{id:'saved1',sequence:1,path:'title',previousValue:'Eski başlık',nextValue:'Yeni başlık',source:'USER',prompt:null,chatMessageId:null,revertible:true,revertsEditId:null,revertedByEditId:null,createdAt:'2026-10-12T10:00:00Z'}]}]}))}))
vi.mock('./WorkspaceCustomization',()=>({WorkspaceCustomization:()=> <div>Araç içerikleri</div>}))
vi.mock('./useReportDraft',()=>({useReportDraft:()=>({view:{draft:null,baseVersion:2,publishedVersion:2,isStale:false,spec:{},html:'<html><body><h1 data-field="title">Rapor içeriği</h1></body></html>'},isLoading:false,isBusy:false,isPrompting:false,error:null,conflictVersion:null,reload:vi.fn(),editField:vi.fn(),revert:vi.fn(),publish:vi.fn(),discard:vi.fn(),submitPrompt:vi.fn(),applyTemplate:vi.fn(),saveCustomization:vi.fn(),addSource:vi.fn()})}))
afterEach(cleanup)
describe('report first correction layout',()=>{
  it.each([true,false])('shows the prominent AI conversation before preview (popup=%s)',async(popup)=>{
    render(<MemoryRouter><ReportWorkspace topicId="topic1" popup={popup} /></MemoryRouter>)
    const preview=await screen.findByTestId('report-preview')
    const composer=screen.getByRole('textbox',{name:'Raporda yapılacak değişiklik'})
    expect(composer.compareDocumentPosition(preview)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('tab',{name:'Bülten önizleme'})).not.toBeInTheDocument()
    const sources = screen.getByLabelText('Kullanılan kaynaklar')
    expect(sources.compareDocumentPosition(preview)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(composer.closest('section')).toHaveAttribute('aria-label','AI ile raporu düzenle')
    expect(composer.closest('.atez-report-scroll')).not.toBeNull()
    expect(screen.queryByText('Düzeltme isteği')).not.toBeInTheDocument()
    expect(screen.queryByText('Araç içerikleri')).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Belge ekle'})).not.toBeInTheDocument()
  })
  it('opens saved revision changes without offering undo for published edits',async()=>{
    render(<MemoryRouter><ReportWorkspace topicId="topic1" popup /></MemoryRouter>)
    await screen.findByTestId('report-preview')
    await userEvent.click(screen.getByText('Kaydedilmiş revizyonlar ve düzeltme geçmişi'))
    await waitFor(()=>expect(screen.getByText('Kaydedildi · r02')).toBeVisible())
    await userEvent.click(screen.getByRole('button',{name:'Başlık'}))
    await waitFor(()=>expect(screen.getByText('Yeni başlık')).toBeVisible())
    expect(screen.queryByRole('button',{name:'Geri al'})).not.toBeInTheDocument()
  })

})
