import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/AuthProvider'
import { testSession } from '../../test/auth-fixture'
import { ReportWorkspace } from './ReportWorkspace'
import { useReportDraft } from './useReportDraft'
const viewer={...testSession,role:'VIEWER' as const,permissions:['workspace.read','report.read','document.read','chat.read']}
const topic={id:'topic1',runId:'run1',title:'Yayımlanmış rapor',reportVersion:3,reportCard:'K1',thread:{messages:[]}}
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
function stubReadOnlyApi(){const fetcher=vi.fn(async(url:string,_init?:RequestInit)=>url.includes('/report-workspaces/')?new Response(JSON.stringify(url.endsWith('/conversations')?{conversations:[],nextCursor:null}:url.endsWith('/revisions')?{revisions:[]}:{report:{id:'r1',title:'Rapor',topicId:'topic1'},version:3,baseVersion:3,revision:'published:3',html:'',spec:{},draft:null})):url.endsWith('/html')?new Response('<html><body><h1>Yalnız yayımlanmış içerik</h1></body></html>'):new Response(JSON.stringify(url.endsWith('/delivery')?{sources:[]}:topic)));vi.stubGlobal('fetch',fetcher);return fetcher}
describe('viewer published report access',()=>{
  it('loads a selected published revision without fetching draft or exposing edit controls',async()=>{
    const fetcher=stubReadOnlyApi()
    render(<MemoryRouter initialEntries={['/reports/topic1?revision=1']}><AuthContext.Provider value={{status:'authenticated',session:viewer,error:null,expired:false,can:permission=>viewer.permissions.includes(permission),reload:async()=>{},logout:async()=>{},clearForbidden:()=>{}}}><ReportWorkspace topicId="topic1" popup /></AuthContext.Provider></MemoryRouter>)
    const preview=await screen.findByTitle('Bülten Önizleme')
    expect(preview).toHaveAttribute('srcdoc',expect.stringContaining('Yalnız yayımlanmış içerik'))
    expect(fetcher.mock.calls.some(call=>call[0]==='/api/v1/topics/topic1/reports/1/html')).toBe(true)
    expect(fetcher.mock.calls.some(call=>call[0].includes('/draft'))).toBe(false)
    expect(screen.queryByRole('textbox',{name:'Mesaj'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'E-Posta ile Dağıt'})).not.toBeInTheDocument()
    expect(screen.queryByText('Düzen ve kaynak ekleme araçları')).not.toBeInTheDocument()
  })
  it('does not dispatch draft mutations from a readonly draft hook',async()=>{
    const fetcher=stubReadOnlyApi()
    const {result}=renderHook(()=>useReportDraft('topic1',false))
    await waitFor(()=>expect(result.current.isLoading).toBe(false))
    expect(result.current.view?.draft).toBeNull()
    expect(result.current.view?.baseVersion).toBe(3)
    await result.current.submitPrompt('Bu özeti değiştir')
    await result.current.editField('title','Yeni başlık')
    expect(await result.current.publish()).toBeNull()
    expect(fetcher.mock.calls.every(call=>!call[0].includes('/draft')&&!call[1]?.method)).toBe(true)
  })
})
