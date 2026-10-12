import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthProvider'
import { LoginPage, safeReturnTo } from './LoginPage'
import { RequireSession } from './RequireSession'
import { Can } from './Can'
import { StartScanButton } from '../scans/StartScanButton'
import { Sidebar } from '../../components/layout/Sidebar'
import { setSessionMemory, reportAuthFailure, getSessionMemory } from './session'
import { testSession } from '../../test/auth-fixture'
function Probe(){const auth=useAuth();return <><div>Özel rapor içeriği</div><Can permission="report.edit"><button>Raporu düzenle</button></Can><Can permission="delivery.send"><button>E-posta gönder</button></Can><StartScanButton onClick={()=>{}} /><Sidebar /><button onClick={()=>void auth.logout()}>Çıkış testi</button></>}
function app(path='/reports'){return render(<MemoryRouter initialEntries={[path]}><AuthProvider><Routes><Route path="/login" element={<LoginPage />} /><Route element={<RequireSession />}><Route path="*" element={<Probe />} /></Route></Routes></AuthProvider></MemoryRouter>)}
beforeEach(()=>setSessionMemory(null))
afterEach(()=>{cleanup();vi.unstubAllGlobals();setSessionMemory(null)})
describe('cookie session UI',()=>{
  it('shows a redirect login link on 401 and never a password form or private content',async()=>{
    const fetcher=vi.fn(async()=>new Response('{}',{status:401}));vi.stubGlobal('fetch',fetcher)
    app('/reports?revision=2')
    const link=await screen.findByRole('link',{name:'Kurumsal hesapla giriş yap'})
    expect(link).toHaveAttribute('href','/api/auth/login?returnTo=%2Freports%3Frevision%3D2')
    expect(screen.queryByText('Özel rapor içeriği')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/parola|şifre/i)).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('uses server permissions to hide viewer mutations and admin navigation',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({...testSession,role:'VIEWER',permissions:['workspace.read','report.read','document.read','chat.read']}))))
    const store=vi.spyOn(Storage.prototype,'setItem')
    app()
    await screen.findByText('Özel rapor içeriği')
    expect(screen.queryByRole('button',{name:'Yeni tarama başlat'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Raporu düzenle'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'E-posta gönder'})).not.toBeInTheDocument()
    expect(screen.queryByText('Yönetim')).not.toBeInTheDocument()
    expect(store).not.toHaveBeenCalled()
    store.mockRestore()
  })
  it('keeps editor report actions while hiding delivery and membership administration',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({...testSession,role:'EDITOR',permissions:testSession.permissions.filter(permission=>!['admin.manage','config.manage','delivery.send'].includes(permission))}))))
    app()
    expect(await screen.findByRole('button',{name:'Raporu düzenle'})).toBeVisible()
    expect(screen.queryByRole('button',{name:'E-posta gönder'})).not.toBeInTheDocument()
    expect(screen.queryByText('Yönetim')).not.toBeInTheDocument()
  })
  it('removes private content on expiry without automatically replaying requests',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify(testSession)));vi.stubGlobal('fetch',fetcher)
    app()
    await screen.findByText('Özel rapor içeriği')
    reportAuthFailure({status:401,message:'Oturum bitti.'})
    await screen.findByRole('link',{name:'Kurumsal hesapla giriş yap'})
    expect(screen.queryByText('Özel rapor içeriği')).not.toBeInTheDocument()
    expect(getSessionMemory()).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('shows a friendly 503 and retries only when requested',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:503})).mockResolvedValueOnce(new Response(JSON.stringify(testSession)))
    vi.stubGlobal('fetch',fetcher);app()
    await screen.findByText('Giriş hizmetine ulaşılamıyor')
    expect(screen.queryByRole('link',{name:'Kurumsal hesapla giriş yap'})).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button',{name:'Yeniden dene'}))
    expect(await screen.findByText('Özel rapor içeriği')).toBeVisible()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('shows 403 separately from unauthenticated login',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:403})))
    app();await screen.findByText('Bu sayfaya erişim yetkiniz yok')
    expect(screen.queryByRole('link',{name:'Kurumsal hesapla giriş yap'})).not.toBeInTheDocument()
  })
  it('clears the local UI session after logout without persisting provider tokens',async()=>{
    const fetcher=vi.fn(async(_url:string,init?:RequestInit)=>new Response(JSON.stringify(init?.method==='POST'?{}:testSession)))
    vi.stubGlobal('fetch',fetcher);app()
    await userEvent.click(await screen.findByRole('button',{name:'Çıkış testi'}))
    await screen.findByRole('link',{name:'Kurumsal hesapla giriş yap'})
    expect(getSessionMemory()).toBeNull()
    const post=fetcher.mock.calls.find(call=>call[1]?.method==='POST')!
    expect(post[0]).toBe('/api/auth/logout')
    expect(post[1]?.headers).toEqual({'X-CSRF-Token':'test-csrf'})
    await waitFor(()=>expect(screen.queryByText('Özel rapor içeriği')).not.toBeInTheDocument())
  })
  it('explains missing membership after the sanitized callback failure',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:401})))
    app('/login?error=MEMBERSHIP_REQUIRED')
    expect(await screen.findByText('Bu çalışma alanına erişim izniniz yok. Hesabınızın yetkilendirilmesi için yöneticinize başvurun.')).toBeVisible()
    expect(screen.queryByText('Giriş tamamlanamadı. Yeniden deneyin.')).not.toBeInTheDocument()
  })
  it('rejects external or encoded redirect paths',()=>{
    for(const path of ['https://evil.test','//evil.test','/api/auth/logout','/login','/%2fevil.test','/\\evil.test'])expect(safeReturnTo(path)).toBe('/')
    expect(safeReturnTo('/reports/documents/report1')).toBe('/reports/documents/report1')
  })
})
