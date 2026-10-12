import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutomationStagePanel } from './AutomationStagePanel'
import type { WorkspaceAutomation, WorkspaceSource } from './api'
const automation:WorkspaceAutomation={id:'auto1',name:'Günlük bülten',hour:9,minute:0,times:[],weekdays:[1],timezone:'Europe/Istanbul',isActive:true,sourceIds:['source1'],groupIds:[],templateId:'template1',lastRunId:null,lastRunAt:null,lastError:null}
const source={id:'source1',name:'Resmî Gazete'} as WorkspaceSource
const task={id:'op1',operation:'DISCOVER',mode:'FILL_MISSING' as const,status:'SUCCEEDED',tasks:[]}
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
describe('automation independent stages',()=>{
  it('starts only an explicit selected stage with its own key and preserves scheduling',async()=>{
    const fetcher=vi.fn(async(_url:string,_init?:RequestInit)=>new Response(JSON.stringify(task)))
    vi.stubGlobal('fetch',fetcher)
    render(<MemoryRouter><AutomationStagePanel automation={automation} sources={[source]} /></MemoryRouter>)
    expect(fetcher.mock.calls).toHaveLength(0)
    await userEvent.click(screen.getByLabelText('Çalıştırma biçimi'))
    await userEvent.click(await screen.findByText('Eksik adımları tamamla'))
    await userEvent.click(screen.getByRole('button',{name:'Seçili adımı başlat'}))
    expect(await screen.findByRole('link',{name:'İşlemi incele'})).toHaveAttribute('href','/operations/op1')
    const posts=fetcher.mock.calls.filter(call=>call[1]?.method==='POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]![0]).toBe('/api/v1/automations/auto1/operations')
    expect(JSON.parse(String(posts[0]![1]!.body))).toEqual({operation:'DISCOVER',mode:'FILL_MISSING' as const,documentVersionIds:[],sourceId:'source1',date:expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)})
    expect(posts[0]![1]!.headers).toEqual({'Content-Type':'application/json','Idempotency-Key':expect.any(String),'X-CSRF-Token':'test-csrf'})
  })
  it('restores persisted operation cards and offers completed analyses for draft creation',async()=>{
    const request={...task,operation:'ANALYZE',tasks:[{id:'analysis-task',operation:'ANALYZE',status:'SUCCEEDED',artifacts:[],reused:false}]}
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(request))))
    render(<MemoryRouter><AutomationStagePanel automation={automation} sources={[source]} operations={[request]} /></MemoryRouter>)
    expect(await screen.findByRole('link',{name:'İşlemi incele'})).toHaveAttribute('href','/operations/op1')
    await userEvent.click(screen.getByLabelText('Otomasyon işlem adımı'))
    await userEvent.click(await screen.findByText('Analizden rapor taslağı oluştur'))
    await userEvent.click(screen.getByLabelText('Otomasyon rapor analiz kaydı'))
    await userEvent.click(await screen.findByText('Tamamlanmış analiz 1'))
    await waitFor(()=>expect(screen.getByRole('button',{name:'Seçili adımı başlat'})).not.toBeDisabled())
  })
})
