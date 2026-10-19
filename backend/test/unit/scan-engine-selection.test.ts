import { afterEach, expect, it, vi } from 'vitest'
import { newScanEngine, usesWorkflowEngine } from '../../src/modules/scan-pipeline/selection'
afterEach(()=>vi.unstubAllEnvs())
it('freezes new runs only, retaining unsupported templates and old retries',()=>{
 vi.stubEnv('SCAN_ENGINE','v2')
 expect(newScanEngine()).toBe('v2')
 expect(newScanEngine('custom',null)).toBe('legacy')
 expect(newScanEngine('studio',{id:'studio',revision:1})).toBe('v2')
 expect(usesWorkflowEngine({datePolicy:'PUBLISHED_DATE'})).toBe(false)
 vi.stubEnv('SCAN_ENGINE','legacy')
 expect(newScanEngine()).toBe('legacy')
 expect(usesWorkflowEngine({engine:'v2'})).toBe(true)
})
