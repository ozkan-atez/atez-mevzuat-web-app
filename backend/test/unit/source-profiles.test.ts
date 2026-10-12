import { describe,it,expect,vi } from 'vitest'
import { builtinProfile,assertContentAccess,sourceProfileSchema,sourceUrl } from '../../src/modules/managed-sources/source-profile'
import { encryptLogin,decryptLogin } from '../../src/modules/managed-sources/source-secrets'
import { collectSource,sourceDate } from '../../src/modules/managed-sources/source-collector'
import { sourceAdminAllowed } from '../../src/modules/managed-sources/source-profile.routes'
const profile=builtinProfile('igmd')!
describe('source profiles and secrets',()=>{
  it('binds encrypted credentials to the source and workspace',()=>{const key=Buffer.alloc(32,7);const encrypted=encryptLogin({username:'alice',password:'never-print'},'source1','local',key);expect(encrypted).not.toContain('never-print');expect(decryptLogin(encrypted,'source1','local',key)).toEqual({username:'alice',password:'never-print'});expect(()=>decryptLogin(encrypted,'source2','local',key)).toThrow();expect(()=>decryptLogin(encrypted,'source1','other',key)).toThrow()})
  it('rejects login, subscription and challenge pages as source evidence',()=>{expect(()=>assertContentAccess('<input type="password">','https://example.org/doc')).toThrow('AUTH_REQUIRED');expect(()=>assertContentAccess('Pro or Higher Plan Required','https://example.org/doc')).toThrow('SUBSCRIPTION_REQUIRED');expect(()=>assertContentAccess('cf-turnstile','https://example.org/doc')).toThrow('USER_ACTION_REQUIRED')})
  it('does not permit unlisted domains or malformed date values',()=>{expect(sourceUrl('https://igmd.org.tr.evil.test/doc',profile.feeds[0]!.url,profile)).toBeNull();expect(sourceDate('2026-99-99')).toBeNull();expect(sourceProfileSchema.safeParse({...profile,allowedHosts:['example.com']}).success).toBe(false)})
  it('rejects remote and cross-origin secret administration',()=>{expect(sourceAdminAllowed({ip:'8.8.8.8',method:'PUT',headers:{'x-source-intent':'manage'}})).toBe(false);expect(sourceAdminAllowed({ip:'127.0.0.1',method:'PUT',headers:{origin:'https://evil.test','x-source-intent':'manage'}})).toBe(false);expect(sourceAdminAllowed({ip:'127.0.0.1',method:'PUT',headers:{origin:'http://localhost:8888','x-source-intent':'manage'}})).toBe(true)})
  it('follows pagination to older target dates and retains undated inventory',async()=>{
    const html=vi.fn(async(url:string)=>url.includes('p=2')?'<div class="border-ec"><h4 class="haberbaslik"><a href="/old">Older</a></h4><span class="bilgiler">08.10.2026</span></div>':'<div class="border-ec"><h4 class="haberbaslik"><a href="/new">New</a></h4><span class="bilgiler">11.10.2026</span></div><div class="border-ec"><h4 class="haberbaslik"><a href="/guide.pdf">Undated</a></h4></div><a href="?p=2">2</a>')
    const result=await collectSource(profile,'2026-10-08',{html,binary:vi.fn(),close:vi.fn()},null)
    expect(result.items).toHaveLength(3);expect(result.items.find(i=>i.title==='Undated')?.publishedOn).toBeNull();expect(result.pages).toHaveLength(2);expect(result.notes?.join(' ')).toContain('yayın tarihi bilinmiyor');expect(result.warnings).toEqual([])
  })
  it('reports a page limit instead of declaring a complete scan',async()=>{const html=vi.fn(async()=>'<div class="border-ec"><h4 class="haberbaslik"><a href="/new">New</a></h4><span class="bilgiler">11.10.2026</span></div><a href="?p=2">2</a>');const r=await collectSource({...profile,maxPages:1},'2026-10-01',{html,binary:vi.fn(),close:vi.fn()},null);expect(r.warnings.join(' ')).toContain('kapsamı eksik')})
})
