import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from './AuthProvider'
import { testSession } from '../../test/auth-fixture'
import { AutomationsPage } from '../workspace/AutomationPages'
import { PublishStandaloneDraft } from '../reports/PublishStandaloneDraft'
const readPermissions=['workspace.read','report.read','document.read','chat.read']
function fixture(role:'EDITOR'|'VIEWER'){const session={...testSession,role,permissions:role==='VIEWER'?readPermissions:testSession.permissions.filter(permission=>!['admin.manage','config.manage','delivery.send'].includes(permission))};return{status:'authenticated' as const,session,error:null,expired:false,can:(permission:string)=>session.permissions.includes(permission),reload:async()=>{},logout:async()=>{},clearForbidden:()=>{}}}
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
describe('permission aware optional lookups',()=>{
  it.each(['VIEWER','EDITOR'] as const)('does not request admin job monitoring for %s automation readers',async(role)=>{
    const fetcher=vi.fn(async(url:RequestInfo|URL)=>new Response(JSON.stringify(String(url).endsWith('/automations')?{automations:[],builtInSchedules:[]}:String(url).endsWith('/sources')?{sources:[]}:String(url).endsWith('/templates')?{templates:[],components:[]}:{groups:[]})))
    vi.stubGlobal('fetch',fetcher)
    render(<MemoryRouter><AuthContext.Provider value={fixture(role)}><AutomationsPage /></AuthContext.Provider></MemoryRouter>)
    expect(await screen.findByRole('heading',{name:'Otomasyonlar'})).toBeVisible()
    expect(fetcher.mock.calls.some(call=>String(call[0]).includes('/background-jobs'))).toBe(false)
    expect(screen.queryByRole('button',{name:/Otomasyon oluştur/})).not.toBeInTheDocument()
  })
  it('does not request privileged publication metadata for a viewer',()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    render(<MemoryRouter><AuthContext.Provider value={fixture('VIEWER')}><PublishStandaloneDraft taskId="published-task" /></AuthContext.Provider></MemoryRouter>)
    expect(fetcher).not.toHaveBeenCalled()
    expect(screen.queryByRole('button',{name:'Taslağı rapor olarak yayımla'})).not.toBeInTheDocument()
  })
})
