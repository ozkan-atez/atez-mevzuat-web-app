import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublishStandaloneDraft } from './PublishStandaloneDraft'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
describe('explicit standalone publication',()=>{
  it('uses the current published version and publishes only after a click',async()=>{
    const fetcher=vi.fn(async(_url:string,init?:RequestInit)=>new Response(JSON.stringify(init?.method==='POST'?{reportId:'report1',version:2,operationTaskId:'task2'}:{reportId:'report1',expectedVersion:1,isPublished:false,version:null})))
    vi.stubGlobal('fetch',fetcher)
    render(<MemoryRouter><PublishStandaloneDraft taskId="task2" /></MemoryRouter>)
    const publish=await screen.findByRole('button',{name:'Taslağı rapor olarak yayımla'})
    expect(fetcher.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0)
    await userEvent.click(publish)
    expect(await screen.findByRole('link',{name:'Yayımlanmış raporu aç · v2'})).toHaveAttribute('href','/reports/documents/report1')
    const post=fetcher.mock.calls.find(call=>call[1]?.method==='POST')!
    expect(post[0]).toBe('/api/v1/operation-tasks/task2/publish')
    expect(JSON.parse(String(post[1]!.body))).toEqual({expectedVersion:1})
  })
  it('does not publish if the current version context cannot be loaded',async()=>{
    const fetcher=vi.fn(async(_url:string,_init?:RequestInit)=>new Response(JSON.stringify({message:'Rapor erişilemiyor.'}),{status:404}))
    vi.stubGlobal('fetch',fetcher)
    render(<MemoryRouter><PublishStandaloneDraft taskId="task2" /></MemoryRouter>)
    await screen.findByText('Rapor erişilemiyor.')
    expect(screen.queryByRole('button',{name:'Taslağı rapor olarak yayımla'})).not.toBeInTheDocument()
    await waitFor(()=>expect(fetcher.mock.calls).toHaveLength(1))
  })
})
