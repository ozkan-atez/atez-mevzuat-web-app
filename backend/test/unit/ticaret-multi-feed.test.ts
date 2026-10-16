import { describe, expect, it, vi } from 'vitest'
import { builtinProfile } from '../../src/modules/managed-sources/source-profile'
import { expandedTicaretProfile } from '../../src/modules/managed-sources/source-profile-store'
import { collectSource } from '../../src/modules/managed-sources/source-collector'
const profile=builtinProfile('ticaret-bakanligi')!
const feed=profile.feeds.find(f=>f.url.endsWith('/haberler'))!
const row=(slug:string,date:string)=>`<li><a href="/${slug}"><div class="text"><h5>${slug}</h5><span>${date}</span></div></a></li>`
const page=(rows:string,next='')=>`<ul class="dizin-content">${rows}</ul>${next?`<ul class="pagination"><li title="Next Page"><a href="${next}">Next</a></li></ul>`:''}`
const session=(html:(url:string)=>Promise<string>)=>({html:vi.fn(html),binary:vi.fn(),close:vi.fn()})
describe('Ticaret broad daily collection',()=>{
  it('upgrades only the shipped two-feed profile and preserves custom settings',()=>{
    const legacy={...profile,maxDocuments:100,feeds:profile.feeds.slice(0,2),allowedHosts:profile.allowedHosts.filter(h=>!['tagm.ticaret.gov.tr','personel.ticaret.gov.tr','ithalat.ticaret.gov.tr'].includes(h))}
    expect(expandedTicaretProfile('ticaret-bakanligi',legacy)?.feeds).toHaveLength(8)
    const initial={...legacy,allowedHosts:['ticaret.gov.tr','www.ticaret.gov.tr','ggm.ticaret.gov.tr'],feeds:legacy.feeds.map(({titleSelector,...feed})=>feed)}
    expect(expandedTicaretProfile('ticaret-bakanligi',initial)?.feeds).toHaveLength(8)
    expect(expandedTicaretProfile('ticaret-bakanligi',{...initial,delayMs:1000})).toBeNull()
    expect(expandedTicaretProfile('ticaret-bakanligi',{...legacy,maxPages:3})).toBeNull()
    expect(expandedTicaretProfile('ticaret-bakanligi',profile)).toBeNull()
  })
  it('follows s pagination and keeps non-customs news with the publication field',async()=>{
    const s=session(async url=>url.includes('s=2')?page(row('Ekonomi haberi','14 Ekim 2026')):page(row('Toplantı 22.10.2026','15 Ekim 2026'),'/haberler?s=2'))
    const r=await collectSource({...profile,feeds:[feed],delayMs:0},'2026-10-14',s,null)
    expect(r.items.map(i=>[i.title,i.publishedOn])).toEqual([['Toplantı 22.10.2026','2026-10-15'],['Ekonomi haberi','2026-10-14']])
    expect(r.pages).toHaveLength(2);expect(r.warnings).toEqual([])
  })
  it('shares the budget and retains duplicate dates for coverage',async()=>{
    const s=session(async()=>page(row('a','14 Ekim 2026')+row('b','14 Ekim 2026')+row('c','14 Ekim 2026')))
    const r=await collectSource({...profile,maxDocuments:5,feeds:[feed,{...feed,url:'https://ticaret.gov.tr/duyurular'}]},'2026-10-14',s,null)
    expect(r.items).toHaveLength(3);expect(r.pages).toHaveLength(2);expect(r.warnings).toEqual([])
  })
  it('continues past partly undated pages without assigning an invented date',async()=>{
    const s=session(async url=>url.endsWith('/unknown')?'<div class="__header"><span>Belirsiz</span></div>':url.includes('s=2')?page(row('target','14 Ekim 2026')):page(row('old','10 Ekim 2026')+row('unknown',''),'/haberler?s=2'))
    const r=await collectSource({...profile,feeds:[feed],delayMs:0},'2026-10-14',s,null)
    expect(r.items.find(i=>i.title==='target')?.publishedOn).toBe('2026-10-14')
    expect(r.items.find(i=>i.title==='unknown')?.publishedOn).toBeNull()
    expect(r.notes?.join(' ')).toContain('yayın tarihi bilinmiyor')
  })
  it('reports a failed section while preserving other sections',async()=>{
    const s=session(async url=>{if(url.endsWith('/duyurular'))throw new Error('HTTP 503');return page(row('news','14 Ekim 2026'))})
    const r=await collectSource({...profile,feeds:[feed,{...feed,url:'https://ticaret.gov.tr/duyurular',title:'Duyurular'}]},'2026-10-14',s,null)
    expect(r.items).toHaveLength(1);expect(r.warnings.join(' ')).toContain('Duyurular: HTTP 503')
  })
})
