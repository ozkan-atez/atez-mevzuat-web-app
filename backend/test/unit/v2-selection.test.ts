import { afterEach, expect, it, vi } from 'vitest'
import { newScanEngine, usesV2 } from '../../src/modules/v2-integration/selection'
afterEach(()=>vi.unstubAllEnvs())
it('freezes new runs only, retaining unsupported templates and old retries',()=>{
 vi.stubEnv('SCAN_ENGINE','v2')
 expect(newScanEngine()).toBe('v2')
 expect(newScanEngine('custom',null)).toBe('legacy')
 expect(newScanEngine('studio',{id:'studio',revision:1})).toBe('v2')
 expect(usesV2({datePolicy:'PUBLISHED_DATE'})).toBe(false)
 vi.stubEnv('SCAN_ENGINE','legacy')
 expect(newScanEngine()).toBe('legacy')
 expect(usesV2({engine:'v2'})).toBe(true)
})
