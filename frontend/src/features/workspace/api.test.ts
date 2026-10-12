import {afterEach,describe,it,expect,vi} from 'vitest'
import {workspaceRequest} from './api'
afterEach(()=>vi.unstubAllGlobals())
describe('workspace requests',()=>{
 it('does not declare JSON for bodyless actions',async()=>{const fetcher=vi.fn(async()=>new Response('{}',{status:200}));vi.stubGlobal('fetch',fetcher);await workspaceRequest('source-profiles/id/profiles/v/verify',{method:'POST',headers:{'X-Source-Intent':'manage'}});expect(fetcher).toHaveBeenCalledWith('/api/v1/source-profiles/id/profiles/v/verify',{method:'POST',credentials:'same-origin',headers:{'X-Source-Intent':'manage','X-CSRF-Token':'test-csrf'}})})
 it('keeps JSON headers for submitted forms',async()=>{const fetcher=vi.fn(async()=>new Response('{}',{status:200}));vi.stubGlobal('fetch',fetcher);await workspaceRequest('automations',{method:'POST',body:'{}'});expect(fetcher).toHaveBeenCalledWith('/api/v1/automations',{method:'POST',body:'{}',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':'test-csrf'}})})
})
