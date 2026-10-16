import {it,expect,vi,afterEach} from 'vitest'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const {post}=vi.hoisted(()=>({post:vi.fn()}))
vi.mock('playwright',()=>({chromium:{launch:vi.fn(async()=>({close:async()=>{},newContext:async()=>({request:{post},newPage:async()=>({goto:async()=>{},close:async()=>{}})})}))}}))
import {GazetteFilter} from '../../src/modules/gazette-prototype/official-research'
const dirs:string[]=[]
afterEach(async()=>{post.mockReset();await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})))})
async function setup(){const d=await mkdtemp(join(tmpdir(),'rg-filter-'));dirs.push(d);return GazetteFilter.create(d)}
function row(title='Tebliğ 2018/5',date='2025-12-31'){return {konu:title,resmiGazeteTarihi:date,resmiGazeteSayisi:33124,mukerrerSayisi:4,url:'/fihrist?tarih=2025-12-31&mukerrer=4'}}
function response(data:unknown[],total=data.length){return {ok:()=>true,json:async()=>({recordsFiltered:total,data})}}
it('tüm sayfaları alır, ISO tarih gönderir ve substring numaraları ayıklar',async()=>{
 post.mockResolvedValueOnce(response([row(),row('Başka karar 2018/5552')],11)).mockResolvedValueOnce(response([row('Başka tebliğ 2018/5')],11))
 const f=await setup(),result=await f.search(['2018/5'],'2026-07-10');await f.close()
 expect(result.complete).toBe(true);expect(result.candidates).toHaveLength(2)
 expect(post.mock.calls[1]![1].data.start).toBe(10)
 expect(post.mock.calls[0]![1].data.parameters).toMatchObject({genelbitistarihi:'2026-07-10',genelmukerrer:'',genelsayi:''})
})
it('sağlayıcı tarih filtresini uygulamazsa tamamlandı demez',async()=>{post.mockResolvedValue(response([row('Tebliğ 2018/5','2026-07-11')]));const f=await setup();expect((await f.search(['2018/5'],'2026-07-10')).complete).toBe(false);await f.close()})
it('sayfalama yarıda kesilirse bulunamadı demez',async()=>{post.mockResolvedValueOnce(response([row()],11)).mockResolvedValueOnce(response([],11));const f=await setup();const result=await f.search(['2018/5'],'2026-07-10');expect(result.complete).toBe(false);expect(result.errors).toHaveLength(1);await f.close()})
it('RG dışındaki belge yönlendirmesini reddeder',async()=>{post.mockResolvedValue(response([{...row(),url:'https://example.com/fake.pdf'}]));const f=await setup();expect((await f.search(['2018/5'],'2026-07-10')).complete).toBe(false);await f.close()})
