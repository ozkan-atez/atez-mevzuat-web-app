import { candidateIndexUrls, parseEditions, parseIssueNumber } from '../scan-runs/infrastructure/resmi-gazete-parser'
import { load } from 'cheerio'
import { parseTurkishDate, scrapeSourceFeed } from './source-feed-scrapers'
import { sourceUrl, type SourceProfileConfig } from './source-profile'
import type { SourceSession } from './source-session'
import type { SourceLogin } from './source-secrets'
export interface SourceCandidate { title:string;url:string;publishedOn:string|null;feedUrl:string;capturedContent?:string|null;capturedHtml?:string;attachments?:Array<{url:string;title:string}> }
export interface SourceCollection { items:SourceCandidate[]; warnings:string[]; notes?:string[]; pages:string[]; observed:number; oldestDate:string|null; newestDate:string|null }
export function sourceDate(value:string):string|null {const iso=value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];const parsed=iso?new Date(`${iso}T00:00:00Z`):null;return iso&&parsed&&!Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===iso?iso:parseTurkishDate(value)}
export async function collectSource(profile:SourceProfileConfig,targetDate:string,session:SourceSession,login:SourceLogin|null,mode='PUBLISHED_DATE'):Promise<SourceCollection> {
  if(profile.transport==='GAZETTE') {
    const warnings:string[]=[]
    for(const indexUrl of candidateIndexUrls(targetDate)) {
      try {
        const html=await session.html(indexUrl)
        if(!parseIssueNumber(html)) { warnings.push('Gazete sayısı doğrulanamadı.'); continue }
        const editions=parseEditions(html,indexUrl,targetDate)
        const items=editions.flatMap(edition=>edition.documents.map(document=>({title:document.title,url:document.sourceUrl,publishedOn:targetDate,feedUrl:indexUrl})))
        // An unexpected empty parser result cannot establish a no-change day.
        return {items,warnings:items.length?[]:['Gazete belge listesi doğrulanamadı; boş gün sonucu üretilmedi.'],pages:[indexUrl],observed:items.length,oldestDate:items.length?targetDate:null,newestDate:items.length?targetDate:null}
      } catch { warnings.push('Gazete fihristi okunamadı.') }
    }
    return {items:[],warnings:[...new Set(warnings)],pages:[],observed:0,oldestDate:null,newestDate:null}
  }
  if(profile.transport==='TARIFF_API') {
    const items=await scrapeSourceFeed({adapter:'TARIFF_API',url:profile.feeds[0]!.url,sourceKey:'tariff',targetDate,datePolicy:mode,maxPages:profile.maxPages,maxDocuments:profile.maxDocuments,...(login?{credentials:login}:{})})
    return {items,warnings:items.coverageWarnings??[],pages:[profile.feeds[0]!.url],observed:items.length,oldestDate:items.map(i=>i.publishedOn).sort()[0]??null,newestDate:items.map(i=>i.publishedOn).sort().at(-1)??null}
  }
  const records=new Map<string,SourceCandidate>();const warnings:string[]=[];const pages:string[]=[];const dates:string[]=[]
  for(const feed of profile.feeds) {
    if(records.size>=profile.maxDocuments){warnings.push(`${feed.title}: Belge sınırı nedeniyle bu listeye ulaşılamadı; tarama kapsamı eksik.`);continue}
    const first=feed.yearInPath?feed.url.replace(/\/\d{4}\/?$/,`/${targetDate.slice(0,4)}`):feed.url
    // Share the inventory budget: a busy feed must not be cut to 1/N of the limit.
    const feedLimit=profile.maxDocuments
    const pending=[first];const seen=new Set<string>();let feedDates:string[]=[];let seenRows=0
    while(pending.length&&seen.size<profile.maxPages&&records.size<feedLimit) {
      const url=pending.shift()!;if(seen.has(url))continue;seen.add(url)
      try {
        const html=await session.html(url);pages.push(url);const $=load(html);const pageDates:string[]=[]
        const rows=$(feed.row).toArray();let actionable=0
        for(const row of rows) {
          const link=$(row).find(feed.link).first();const href=link.attr('href');if(!href)continue
          const resolved=sourceUrl(href,url,profile);if(!resolved)continue
          const title=(feed.titleSelector?$(row).find(feed.titleSelector).first().text():link.text()).trim().replace(/\s+/g,' ').slice(0,300);if(!title)continue;actionable++;seenRows++
          const existing=records.get(resolved)
          if(existing){if(existing.publishedOn){pageDates.push(existing.publishedOn);feedDates.push(existing.publishedOn)};continue}
          if(records.size>=feedLimit){warnings.push('Belge sınırına ulaşıldı; kaynak bütünüyle taranamadı.');break}
          const dateNode=feed.date?$(row).find(feed.date).first():null
          let publishedOn=dateNode?sourceDate(dateNode.attr('datetime')??$(row).find(feed.date!).map((_i,node)=>$(node).text()).get().join(' ')):null
          if(!publishedOn&&feed.detailDate&&!/\.(pdf|docx?|xlsx?|zip)(?:$|\?)/i.test(resolved)) {
            try { const detail=load(await session.html(resolved));publishedOn=sourceDate(detail(feed.detailDate).first().text()) } catch(error){warnings.push(`${title}: ${error instanceof Error?error.message:'Ayrıntı okunamadı.'}`)}
          }
          if(publishedOn){pageDates.push(publishedOn);dates.push(publishedOn);feedDates.push(publishedOn)}
          const attachments=$(row).find('a[href]').toArray().flatMap(a=>{const next=sourceUrl($(a).attr('href')??'',url,profile);return next&&next!==resolved&&/\.(pdf|docx?|xlsx?|zip)(?:$|\?)/i.test(next)?[{url:next,title:$(a).text().trim()}]:[]})
          records.set(resolved,{url:resolved,title,publishedOn,feedUrl:first,attachments})
        }
        if(!actionable)warnings.push(`${feed.title}: Beklenen liste yapısı bulunamadı; boş gün doğrulanamadı.`)
        if(feed.next) {
          const currentNumber=Number(new URL(url).searchParams.get(feed.pageParameter??'p')??1)
          const links=$(feed.next).toArray().flatMap(a=>{const next=sourceUrl($(a).attr('href')??'',url,profile);if(!next||seen.has(next))return [];const p=Number(new URL(next).searchParams.get(feed.pageParameter??'p'));return p&&p<=currentNumber?[]:[next]})
          // Only stop after a whole dated page is older than the requested day.
          if(mode!=='PUBLISHED_DATE'||pageDates.length<actionable||pageDates.some(d=>d>=targetDate)) pending.push(...links.sort((a,b)=>Number(new URL(a).searchParams.get(feed.pageParameter??'p')??0)-Number(new URL(b).searchParams.get(feed.pageParameter??'p')??0)).slice(0,1).filter(next=>!pending.includes(next)))
        }
        if(pending.length)await new Promise(resolve=>setTimeout(resolve,profile.delayMs))
      }catch(error){warnings.push(`${feed.title}: ${error instanceof Error?error.message:'Liste okunamadı.'}`)}
    }
    if(pending.length||records.size>=feedLimit)warnings.push(`${feed.title}: Sayfa/belge sınırına ulaşıldı; tarama kapsamı eksik.`)
    if(!seenRows)warnings.push(`${feed.title}: Kayıt yapısı doğrulanamadı.`)
    if(feed.recentOnly&&feedDates.length&&targetDate<feedDates.sort()[0]!)warnings.push(`${feed.title}: Hedef tarih görünür listenin dışında; arşiv erişimi gerekiyor.`)
    if(!feedDates.length&&mode==='PUBLISHED_DATE')warnings.push(`${feed.title}: Yayın tarihleri doğrulanamadı.`)
  }
  const values=[...records.values()];const unknown=values.filter(item=>!item.publishedOn).length
  const notes:string[]=[]
  if(unknown&&mode==='PUBLISHED_DATE')notes.push(`${unknown} kaydın yayın tarihi bilinmiyor; kaynak envanterinde saklandı, günlük seçime alınmadı.`)
  return {items:values,notes,warnings:[...new Set(warnings)],pages,observed:values.length,oldestDate:dates.sort()[0]??null,newestDate:dates.at(-1)??null}
}
