import { load } from 'cheerio'
import { builtinProfile, sourceUrl, type SourceProfileConfig } from './source-profile'
import { openSourceSession } from './source-session'
import { sourceDate } from './source-collector'
export async function discoverProfile(source:{key:string;name:string|null;baseUrl:string}) {
  const known=builtinProfile(source.key);const host=new URL(source.baseUrl).hostname
  const config:SourceProfileConfig=known??{name:source.name??host,transport:'HTTP',allowedHosts:[host,...(host.startsWith('www.')?[host.slice(4)]:[`www.${host}`])],feeds:[],auth:{mode:'NONE'},maxPages:10,maxDocuments:100,delayMs:750}
  const session=await openSourceSession({...config,transport:'BROWSER',auth:{mode:'NONE'}},null)
  const pending=[...(known?.feeds.map(feed=>feed.url)??[]),source.baseUrl];const examined:Array<{url:string;links:number;datedRows:number;error?:string}>=[];const seen=new Set<string>()
  try {
    while(pending.length&&seen.size<8) {
      const url=pending.shift()!;if(seen.has(url))continue;seen.add(url)
      try {
        const $=load(await session.html(url));const links=$('a[href]').toArray().flatMap(a=>{const href=sourceUrl($(a).attr('href')??'',url,config);const title=$(a).text().trim();return href&&/mevzuat|duyuru|haber|arşiv|arsiv|genelge|güncel|guncel|sirküler/i.test(`${title} ${href}`)?[{url:href,title}]:[]})
        const candidates=['article','table tr','li'].map(row=>({row,count:$(row).toArray().filter(node=>$(node).find('a[href]').length&&sourceDate($(node).find('time').attr('datetime')??$(node).text())).length})).sort((a,b)=>b.count-a.count)
        const best=candidates[0]!;examined.push({url,links:links.length,datedRows:best.count})
        if(!known&&best.count>=2)config.feeds.push({url,title:$('h1,h2').first().text().trim()||'Tarihli kayıtlar',row:best.row,link:'a[href]',date:'time,td,span,p',next:'a[rel="next"]'})
        if(seen.size<3)for(const link of links.slice(0,8))if(!seen.has(link.url)&&!pending.includes(link.url))pending.push(link.url)
      }catch(error){examined.push({url,links:0,datedRows:0,error:error instanceof Error?error.message:'Sayfa incelenemedi.'})}
    }
    if(!known&&!config.feeds.length)throw new Error('Otomatik liste kuralları doğrulanamadı. Giriş veya siteye özel liste profili gerekiyor.')
    return {config,evidence:{examined,bounded:pending.length>0,notes:'Keşif taslağıdır. Liste, tarih ve örnek belge doğrulanmadan etkinleşmez.'}}
  }finally{await session.close()}
}
