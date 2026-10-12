import { builtinProfile } from '../managed-sources/source-profile'
import { tariffCredentialsFromEnv } from '../managed-sources/tariff-auth'
import type { PrismaClient } from '@prisma/client'

import { defaultSections, templateHtml } from './report-template-catalog'
export { sectionComponents, templateHtml } from './report-template-catalog'
export function scanSupported(source: { baseUrl: string; key?: string; endpoints?: Array<{ status: string; adapter: string | null }>; profiles?: Array<{status:string;config?:unknown}>; credentials?: Array<{id:string}> }) {
  let hostname:string;try{hostname=new URL(source.baseUrl).hostname}catch{return false}
  if(!source.key||source.key==='resmi-gazete')return ['resmigazete.gov.tr','www.resmigazete.gov.tr'].includes(hostname)
  const builtin=builtinProfile(source.key)
  const known=Boolean(builtin?.allowedHosts.includes(hostname)&&(!source.endpoints||source.endpoints.some(endpoint=>endpoint.status==='ACTIVE'&&endpoint.adapter)))
  const verified=source.profiles?.some(profile=>profile.status==='VERIFIED')
  if(!known&&!verified)return false
  if(source.key==='tariff')return Boolean(source.credentials?.length||tariffCredentialsFromEnv())
  if(source.key==='mevzuat-net')return Boolean(source.credentials?.length)
  return true
}

/** Add known ingestion sources and sources actually observed in stored evidence. Never remove user data. */
export async function ensureWorkspaceCatalog(prisma: PrismaClient) {
  await prisma.source.upsert({ where: { key: 'resmi-gazete' }, update: {}, create: { key: 'resmi-gazete', name: 'Resmî Gazete', baseUrl: 'https://www.resmigazete.gov.tr', authorityType: 'OFFICIAL', description: 'Günlük yayın, mükerrer sayılar ve geçmiş mevzuat arşivi' } })
  const sites = [
    { key: 'ticaret-bakanligi', name: 'Ticaret Bakanlığı', baseUrl: 'https://ticaret.gov.tr/gumruk-islemleri/mevzuat', authorityType: 'OFFICIAL', feeds: [{ url: 'https://ggm.ticaret.gov.tr/duyurular', title: 'Gümrükler Genel Müdürlüğü duyuruları', adapter: 'TICARET_DUYURULAR' }, { url: 'https://ticaret.gov.tr/gumruk-islemleri/mevzuat/genelge/2026', title: 'Gümrük genelgeleri', adapter: 'TICARET_GENELGE' }] },
    { key: 'igmd', name: 'İGMD', baseUrl: 'https://www.igmd.org.tr/', authorityType: 'PROFESSIONAL', feeds: [{ url: 'https://www.igmd.org.tr/mevzuat_haberleri', title: 'İGMD mevzuat haberleri', adapter: 'IGMD_MEVZUAT' }] },
    { key: 'mevzuat-net', name: 'Mevzuat.Net', baseUrl: 'https://www.mevzuat.net/', authorityType: 'COMMERCIAL', feeds: [{ url: 'https://www.mevzuat.net/Guncellik.aspx', title: 'Mevzuat.Net güncellik', adapter: 'MEVZUAT_GUNCELLIK' }] },
    { key: 'tariff', name: 'TARIFF', baseUrl: 'https://tariff.singlewindow.io/', authorityType: 'COMMERCIAL', feeds: [{ url: 'https://tariff.singlewindow.io/legislation-news', title: 'TARIFF mevzuat duyuruları', adapter: 'TARIFF_API' }] },
  ]
  for (const { feeds, ...site } of sites) {
    const source = await prisma.source.upsert({ where: { key: site.key }, update: {}, create: site })
    for (const feed of feeds) await prisma.sourceEndpoint.upsert({ where: { sourceId_url: { sourceId: source.id, url: feed.url } }, update: {}, create: { sourceId: source.id, ...feed, status: 'ACTIVE', reason: 'Mevcut sistemin tarihli tarama bağlayıcısı' } })
  }
  const urls = await Promise.all([
    prisma.collectedDocument.findMany({ distinct: ['sourceUrl'], select: { sourceUrl: true } }),
    prisma.previousSourceDocument.findMany({ distinct: ['sourceUrl'], select: { sourceUrl: true } }),
    prisma.document.findMany({ distinct: ['canonicalUrl'], select: { canonicalUrl: true } }),
    prisma.documentAsset.findMany({ distinct: ['sourceUrl'], select: { sourceUrl: true } }),
    prisma.previousSourceAsset.findMany({ distinct: ['sourceUrl'], select: { sourceUrl: true } }),
    prisma.reportDraft.findMany({ select: { specJson: true } }),
  ])
  const origins = new Map<string, string>()
  const draftUrls: string[] = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (value && typeof value === 'object') { for (const [key, child] of Object.entries(value)) { if ((key === 'url' || key === 'sourceUrl') && typeof child === 'string') draftUrls.push(child); else if (child && typeof child === 'object') walk(child) } }
  }
  urls[5].forEach(row => walk(row.specJson))
  for (const row of [...urls[0], ...urls[1], ...urls[2], ...urls[3], ...urls[4], ...draftUrls.map(sourceUrl => ({ sourceUrl }))]) {
    try { const url = new URL(('sourceUrl' in row ? row.sourceUrl : row.canonicalUrl) ?? ''); if (url.protocol === 'https:' || url.protocol === 'http:') origins.set(url.hostname.replace(/^www\./, ''), url.origin) } catch { /* Ignore malformed historical links. */ }
  }
  for (const [host, origin] of origins) {
    if (['resmigazete.gov.tr','ticaret.gov.tr','ggm.ticaret.gov.tr','igmd.org.tr','mevzuat.net','tariff.singlewindow.io'].includes(host)) continue
    await prisma.source.upsert({ where: { key: host }, update: {}, create: { key: host, name: host, baseUrl: origin, authorityType: 'REFERENCE', description: 'Mevcut rapor ve belge kayıtlarında kullanılan kaynak' } })
  }
  const description = 'ATEZ kurumsal tasarımı sabit, içerikleri düzenlenebilir günlük rapor'
  const template = await prisma.reportTemplate.upsert({ where: { name: 'ATEZ Günlük Mevzuat' }, update: {}, create: { name: 'ATEZ Günlük Mevzuat', description, html: templateHtml, sections: defaultSections } })
  // Upgrade only the untouched factory template; custom text and templates are retained.
  const legacy = [['summary','Yönetici Özeti'],['changes','Mevzuat Değişiklikleri'],['impact','ATEZ Etki ve Aksiyonlar'],['sources','Kaynakça']].map(([id,heading])=>({id,heading,html:`<section data-section="${id}"><h2>{{heading}}</h2><div>{{content}}</div></section>`,enabled:true}))
  if (template.description === 'Başlıkları ve bölüm sırası düzenlenebilir günlük rapor' && Array.isArray(template.sections) && template.sections.length === legacy.length && template.sections.every((entry,index) => entry && typeof entry === 'object' && !Array.isArray(entry) && Object.entries(legacy[index]!).every(([key,value]) => entry[key] === value))) {
    await prisma.reportTemplate.update({where:{id:template.id},data:{html:templateHtml,sections:defaultSections,description}})
  }
}
