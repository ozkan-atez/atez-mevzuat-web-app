import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from './AuthProvider'
import { AcademyPage } from '../workspace/AcademyPage'
import { testSession } from '../../test/auth-fixture'
function renderAcademy(role:'VIEWER'|'EDITOR') {const session={...testSession,role,permissions:role==='VIEWER'?['workspace.read']:['workspace.read','academy.write']};render(<MemoryRouter><AuthContext.Provider value={{status:'authenticated',session,error:null,expired:false,can:permission=>session.permissions.includes(permission),reload:async()=>{},logout:async()=>{},clearForbidden:()=>{}}}><AcademyPage /></AuthContext.Provider></MemoryRouter>)}
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
describe('academy write permission',()=>{
  it('lets a viewer read their results without starting or submitting a quiz',async()=>{
    const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({attempts:[{id:'own1',type:'daily',date:'2026-10-12',correct:3,total:3,points:30}]})))
    vi.stubGlobal('fetch',fetcher);renderAcademy('VIEWER')
    await screen.findByText('Günlük Quiz · 2026-10-12 · 3/3 doğru')
    expect(screen.queryByRole('button',{name:/quiz’i başlat/})).not.toBeInTheDocument()
    expect(fetcher.mock.calls.every(call=>call[1]?.method!=='POST')).toBe(true)
  })
  it('saves an editor quiz only after the last answer is explicitly submitted',async()=>{
    const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>new Response(JSON.stringify(init?.method==='POST'?{correct:3,total:3,points:30}:{attempts:[]})))
    vi.stubGlobal('fetch',fetcher);renderAcademy('EDITOR')
    await userEvent.click(await screen.findByRole('button',{name:/Günlük quiz’i başlat/}))
    await userEvent.click(screen.getByRole('radio',{name:/T.C. Resmî Gazete/}).closest('label')!)
    await userEvent.click(screen.getByRole('button',{name:/Sonraki soru/}))
    await userEvent.click(screen.getByRole('radio',{name:/Gümrük Tarife İstatistik Pozisyonu/}).closest('label')!)
    await userEvent.click(screen.getByRole('button',{name:/Sonraki soru/}))
    await userEvent.click(screen.getByRole('radio',{name:/Tebliğin yürürlük maddesinden/}).closest('label')!)
    expect(fetcher.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0)
    await userEvent.click(screen.getByRole('button',{name:/Sonucu kaydet/}))
    await waitFor(()=>expect(fetcher.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(1))
    const post=fetcher.mock.calls.find(call=>call[1]?.method==='POST')!
    expect(JSON.parse(String(post[1]?.body))).toEqual({lessonId:'daily',answers:[1,0,1]})
  })
})
