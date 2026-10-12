import { z } from 'zod'
import { normalizeManagedSourceUrl } from './fetch-managed-source'
const address=z.string().transform((value,ctx)=>{try{return normalizeManagedSourceUrl(value)}catch{ctx.addIssue({code:'custom',message:'Geçerli bir HTTPS kaynak adresi gerekli.'});return z.NEVER}})
const selector = z.string().min(1).max(300)
export const sourceProfileSchema = z.object({
  name: z.string().min(1).max(200),
  transport: z.enum(['HTTP', 'BROWSER', 'TARIFF_API', 'GAZETTE']),
  allowedHosts: z.array(z.string().regex(/^[a-z0-9.-]+$/)).min(1).max(15),
  feeds: z.array(z.object({ url: address, title: z.string().max(200), row: selector, link: selector, date: selector.optional(), detailDate: selector.optional(), next: selector.optional(), yearInPath: z.boolean().optional(), recentOnly: z.boolean().optional() })).max(20),
  auth: z.object({ mode: z.enum(['NONE', 'FORM', 'TARIFF']), loginUrl: address.optional(), username: selector.optional(), password: selector.optional(), submit: selector.optional(), success: selector.optional() }),
  maxPages: z.number().int().min(1).max(30).default(10),
  maxDocuments: z.number().int().min(1).max(300).default(100),
  delayMs: z.number().int().min(300).max(10000).default(750),
}).superRefine((p, ctx) => {
  for (const url of [...p.feeds.map(f => f.url), ...(p.auth.loginUrl ? [p.auth.loginUrl] : [])]) if (!p.allowedHosts.includes(new URL(url).hostname)) ctx.addIssue({ code: 'custom', message: 'Adres izin verilen kaynak alan adlarından biri olmalı.' })
  if(p.transport!=='GAZETTE'&&!p.feeds.length)ctx.addIssue({code:'custom',message:'En az bir kaynak listesi gerekli.'})
  if((p.auth.mode==='TARIFF')!==(p.transport==='TARIFF_API'))ctx.addIssue({code:'custom',message:'TARIFF erişimi kendi hesap bağlantısını kullanmalı.'})
  if(p.auth.mode === 'FORM' && (!p.auth.loginUrl || !p.auth.username || !p.auth.password || !p.auth.submit || !p.auth.success || p.transport !== 'BROWSER')) ctx.addIssue({code:'custom',message:'Form oturumu için giriş, alanlar, başarı göstergesi ve tarayıcı erişimi gerekli.'})
})
export type SourceProfileConfig = z.infer<typeof sourceProfileSchema>
export function builtinProfile(key: string): SourceProfileConfig | null {
  const common = {maxPages:10,maxDocuments:100,delayMs:750,auth:{mode:'NONE' as const}}
  const profiles: Record<string, unknown> = {
    'resmi-gazete': {...common,name:'Resmî Gazete',transport:'GAZETTE',allowedHosts:['www.resmigazete.gov.tr','resmigazete.gov.tr'],feeds:[]},
    'ticaret-bakanligi': {...common,name:'Ticaret Bakanlığı',transport:'HTTP',allowedHosts:['ticaret.gov.tr','www.ticaret.gov.tr','ggm.ticaret.gov.tr'],feeds:[
      {url:'https://ggm.ticaret.gov.tr/duyurular',title:'Gümrük duyuruları',row:'ul.dizin-content li',link:'a[href]',detailDate:'.__header span'},
      {url:'https://ticaret.gov.tr/gumruk-islemleri/mevzuat/genelge/2026',title:'Gümrük genelgeleri',row:'table tr',link:'a[href$=".pdf"],a[href$=".PDF"]',date:'td:nth-child(3)',yearInPath:true},
    ]},
    igmd:{...common,name:'İGMD',transport:'HTTP',allowedHosts:['www.igmd.org.tr','igmd.org.tr','files.igmd.org.tr'],feeds:[{url:'https://www.igmd.org.tr/mevzuat_haberleri',title:'Mevzuat haberleri',row:'.border-ec',link:'h4.haberbaslik a[href]',date:'.bilgiler',next:'a[href^="?p="]'}]},
    'mevzuat-net':{...common,name:'Mevzuat.Net',transport:'BROWSER',allowedHosts:['www.mevzuat.net','mevzuat.net'],auth:{mode:'FORM',loginUrl:'https://www.mevzuat.net/LoginMevzuat.aspx',username:'#mid',password:'#indy',submit:'button:has-text("Abone Girişi")',success:'#SiteGenelContent'},feeds:[{url:'https://www.mevzuat.net/Guncellik.aspx',title:'Son yayımlanan 30 mevzuat',row:'#tblListe tr',link:'td:nth-child(4) a[href]',date:'td:nth-child(2)',recentOnly:true}]},
    tariff:{...common,name:'TARIFF',transport:'TARIFF_API',allowedHosts:['tariff.singlewindow.io','login.singlewindow.io'],auth:{mode:'TARIFF'},feeds:[{url:'https://tariff.singlewindow.io/legislation-news',title:'Mevzuat duyuruları',row:'article',link:'a[href]'}]},
  }
  if(!profiles[key])return null
  const profile=sourceProfileSchema.parse(profiles[key])
  if(key!=='resmi-gazete')profile.allowedHosts=[...new Set([...profile.allowedHosts,'www.resmigazete.gov.tr','resmigazete.gov.tr','ticaret.gov.tr','www.ticaret.gov.tr','ggm.ticaret.gov.tr','mevzuat.gov.tr','www.mevzuat.gov.tr','tbmm.gov.tr','www.tbmm.gov.tr'])]
  return profile
}
export function sourceUrl(value: string, base: string, profile: SourceProfileConfig): string | null {
  try { const url=normalizeManagedSourceUrl(new URL(value,base).toString());return profile.allowedHosts.includes(new URL(url).hostname) ? url : null } catch { return null }
}
export function assertContentAccess(html: string, url: string) {
  if (/LoginMevzuat|\/login(?:[/?]|$)|\/signin(?:[/?]|$)/i.test(url) || /<input[^>]+type=["']password["']/i.test(html)) throw new Error('AUTH_REQUIRED: Kaynak belgeye erişmek için oturum açılmasını istiyor.')
  if (/g-recaptcha|h-captcha|cf-turnstile|challenge-platform/i.test(html)) throw new Error('USER_ACTION_REQUIRED: Kaynak insan doğrulaması istiyor.')
  if (/Pro or Higher Plan Required|subscription required|aboneliğiniz.*sona ermiştir/i.test(html)) throw new Error('SUBSCRIPTION_REQUIRED: Bu içerik için etkin abonelik gerekiyor.')
}
