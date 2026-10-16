import { SourceSizeLimitError } from './capture-error'
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib'
import { request } from 'node:https'
import { lookup } from 'node:dns/promises'
import { chromium, type Browser, type BrowserContext } from 'playwright'
import { isPublicIp, normalizeManagedSourceUrl } from './fetch-managed-source'
import { assertContentAccess, type SourceProfileConfig } from './source-profile'
import type { SourceLogin } from './source-secrets'
export interface SourceResource { body: Buffer; contentType: string; finalUrl: string }
export interface SourceSession { html(url:string):Promise<string>; binary(url:string,maxBytes:number):Promise<SourceResource>; close():Promise<void> }
/** All browser network traffic is fulfilled through a DNS-pinned, public-only transport. */
export async function safeSourceRequest(value:string, hosts:string[], options:{method?:string;headers?:Record<string,string>;body?:Buffer;maxBytes?:number;redirects?:number;follow?:boolean}={}):Promise<SourceResource & {status:number;headers:Record<string,string>}> {
  const url=new URL(normalizeManagedSourceUrl(value));if(!hosts.includes(url.hostname))throw new Error('Kaynak profilinin dışında bir adrese erişim engellendi.')
  const addresses=await lookup(url.hostname,{all:true});if(!addresses.length||addresses.some(a=>!isPublicIp(a.address)))throw new Error('Yerel ağ adreslerine kaynak erişimi engellendi.')
  const address=addresses.find(a=>a.family===4)??addresses[0]!
  const result=await new Promise<SourceResource & {status:number;headers:Record<string,string>}>((resolve,reject)=>{
    const headers={...options.headers};for(const key of Object.keys(headers))if(['host','connection','content-length','accept-encoding'].includes(key.toLowerCase()))delete headers[key]
    const req=request(url,{method:options.method??'GET',headers:{'User-Agent':'ATEZ-Mevzuat-Radari/1.0',...headers,'Accept-Encoding':'identity'},timeout:20000,lookup:(_h,o,cb)=>{if(typeof o==='object'&&o.all)cb(null,[address]);else cb(null,address.address,address.family)}},res=>{
      let size=0;const chunks:Buffer[]=[];const limit=options.maxBytes??4_000_000
      if(Number(res.headers['content-length'])>limit){const error=new SourceSizeLimitError(url.toString(),limit,Number(res.headers['content-length']));res.on('error',()=>{});res.destroy();reject(error);return}
      res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>limit)res.destroy(new SourceSizeLimitError(url.toString(),limit,size));else chunks.push(chunk)})
      res.on('error',reject);res.on('end',()=>resolve({body:Buffer.concat(chunks),contentType:String(res.headers['content-type']??''),finalUrl:url.toString(),status:res.statusCode??0,headers:Object.fromEntries(Object.entries(res.headers).filter(([,v])=>v!==undefined).map(([k,v])=>[k,Array.isArray(v)?v.join('\n'):String(v)]))}))
    });req.on('error',()=>reject(new Error('Kaynak bağlantısı kurulamadı.')));req.on('timeout',()=>req.destroy(new Error('Kaynak bağlantısı zaman aşımına uğradı.')));if(options.body)req.write(options.body);req.end()
  })
  const encoding=result.headers['content-encoding']?.toLowerCase()
  if(encoding && encoding!=='identity') {
    const limits={maxOutputLength:options.maxBytes??4_000_000}
    result.body=encoding==='gzip'?gunzipSync(result.body,limits):encoding==='deflate'?inflateSync(result.body,limits):encoding==='br'?brotliDecompressSync(result.body,limits):(()=>{throw new Error('Kaynak sıkıştırması desteklenmiyor.')})()
    delete result.headers['content-encoding'];delete result.headers['content-length']
  }
  if(options.follow!==false&&[301,302,303,307,308].includes(result.status)) {
    if((options.redirects??0)>=3||!result.headers.location)throw new Error('Kaynak yönlendirmesi doğrulanamadı.')
    const next=new URL(result.headers.location,url);if(next.origin!==url.origin&&options.headers&&Object.keys(options.headers).some(k=>/cookie|authorization/i.test(k)))throw new Error('Oturum bilgisi başka bir alana gönderilemez.')
    return safeSourceRequest(next.toString(),hosts,{...options,redirects:(options.redirects??0)+1})
  }
  return result
}
function ensureResponse(r: SourceResource & {status:number}) { if(r.status===401||r.status===403)throw new Error('AUTH_REQUIRED: Kaynağa erişim reddedildi; hesap veya abonelik kontrolü gerekli.');if(r.status<200||r.status>=300)throw new Error(`Kaynak HTTP ${r.status} döndürdü.`) }
export function decodeSource(r:SourceResource):string {return new TextDecoder(/windows-1254/i.test(`${r.contentType} ${r.body.subarray(0,2000).toString('latin1')}`)?'windows-1254':'utf-8').decode(r.body)}
export async function openSourceSession(profile:SourceProfileConfig,login:SourceLogin|null):Promise<SourceSession> {
  if(profile.auth.mode!=='NONE'&&!login)throw new Error('AUTH_REQUIRED: Bu kaynak için bir hesap bağlayın.')
  let browser:Browser|undefined;let context:BrowserContext|undefined
  if(profile.transport==='BROWSER') {
    try {
      browser=await chromium.launch({headless:true});context=await browser.newContext({acceptDownloads:true,serviceWorkers:'block'})
      await context.route('**/*',async route=>{
        const req=route.request();const method=req.method();if(!['GET','HEAD','POST'].includes(method)){await route.abort();return}
        try {
          const headers=await req.allHeaders();const target=new URL(req.url());
          if(method==='POST'&&(!profile.auth.loginUrl||target.origin!==new URL(profile.auth.loginUrl).origin)){await route.abort();return}
          const r=await safeSourceRequest(req.url(),profile.allowedHosts,{method,headers,...(req.postDataBuffer()?{body:req.postDataBuffer()!}:{}),follow:false,maxBytes:25_000_000})
          delete r.headers['transfer-encoding'];delete r.headers['content-encoding'];delete r.headers['content-length']
          await route.fulfill({status:r.status,headers:r.headers,body:r.body})
        }catch{await route.abort()}
      })
      if(profile.auth.mode==='FORM') {
        const page=await context.newPage();await page.goto(profile.auth.loginUrl!,{waitUntil:'domcontentloaded',timeout:30000})
        if(/g-recaptcha|h-captcha|cf-turnstile/i.test(await page.content()))throw new Error('USER_ACTION_REQUIRED: Girişte insan doğrulaması gerekiyor.')
        await page.locator(profile.auth.username!).fill(login!.username);await page.locator(profile.auth.password!).fill(login!.password)
        await page.locator(profile.auth.submit!).click()
        await page.locator(profile.auth.password!).waitFor({state:'hidden',timeout:20000})
        await page.locator(profile.auth.success!).first().waitFor({state:'visible',timeout:10000})
        assertContentAccess(await page.content(),page.url());await page.close()
      }
    }catch(error){await browser?.close();if(error instanceof Error&&/^(AUTH_|USER_ACTION_|SUBSCRIPTION_)/.test(error.message))throw error;throw new Error('Kaynak tarayıcısı veya giriş akışı tamamlanamadı; profil ve tarayıcı kurulumu kontrol edilmeli.')}
  }
  const render = async (url:string) => {
    const page=await context!.newPage()
    try {
      const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000})
      if(!response)throw new Error('Kaynak yanıtı alınamadı.')
      ensureResponse({body:Buffer.alloc(0),contentType:'',finalUrl:page.url(),status:response.status()})
      await page.waitForTimeout(500)
      const html=await page.content();assertContentAccess(html,page.url())
      return {html,finalUrl:page.url()}
    }finally{await page.close()}
  }
  const binary=async(url:string,maxBytes:number):Promise<SourceResource>=>{
    const headers:Record<string,string>={}
    if(context){const cookies=await context.cookies(url);if(cookies.length)headers.Cookie=cookies.map(c=>`${c.name}=${c.value}`).join('; ')}
    const r=await safeSourceRequest(url,profile.allowedHosts,{headers,maxBytes});ensureResponse(r)
    if(/html/i.test(r.contentType)){assertContentAccess(decodeSource(r),r.finalUrl);if(context){const rendered=await render(r.finalUrl);r.body=Buffer.from(rendered.html);r.finalUrl=rendered.finalUrl;r.contentType='text/html; charset=utf-8';if(r.body.length>maxBytes)throw new Error('İşlenmiş sayfa boyut sınırını aşıyor.')}}
    return r
  }
  return {binary,html:async url=>{
    if(context)return (await render(url)).html
    const r=await binary(url,4_000_000);if(!/html/i.test(r.contentType))throw new Error('Kaynak HTML sayfası döndürmedi.');return decodeSource(r)
  },close:async()=>{await browser?.close()}}
}
