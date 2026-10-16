import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext } from 'playwright'
import { extractPdfText } from '../managed-sources/pdf-text'
import { safeSourceRequest } from '../managed-sources/source-session'
import { cleanText, type Bundle, type Collector, type Entry, type Material } from './contracts'
import { announcementLinks, assetLinks, identity, officialUrl, parseIndex } from './parsing'

export class PlaywrightCollector implements Collector {
  private constructor(private browser: Browser, private context: BrowserContext, private directory: string) {}
  static async create(directory: string) {
    await mkdir(directory, {recursive:true})
    const browser = await chromium.launch({headless:true})
    const context = await browser.newContext({serviceWorkers:'block', acceptDownloads:false})
    await context.route('**/*', async route => {
      try { officialUrl(route.request().url(), route.request().url()); if (!['GET','HEAD'].includes(route.request().method())) throw new Error(); await route.continue() }
      catch { await route.abort() }
    })
    return new PlaywrightCollector(browser, context, directory)
  }
  async close() { await this.browser.close() }
  private async html(url: string) {
    const page = await this.context.newPage()
    try {
      const response = await page.goto(officialUrl(url,url), {waitUntil:'domcontentloaded', timeout:30000})
      if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? 'yanıt yok'}`)
      await page.locator('body').waitFor()
      await page.waitForFunction(() => (document.body?.innerText.trim().length ?? 0) > 30, {}, {timeout:10000})
      const html = await page.content(), text = await page.locator('body').innerText()
      if (/captcha|access denied|just a moment|erişim engellendi/i.test(text)) throw new Error('Erişim doğrulaması gerekiyor.')
      const file = join(this.directory, `${identity(url)}.html`)
      await writeFile(file, html)
      return {html, text:cleanText(text), file}
    } finally { await page.close() }
  }
  async index(date: string, providedUrl?: string) {
    const [year, month, day] = date.split('-')
    const url = providedUrl ?? `https://www.resmigazete.gov.tr/${day}.${month}.${year}`
    const page = await this.html(url)
    return parseIndex(page.html, url, date)
  }
  async announcementEntries(entry: Entry, bundle: Bundle) {
    const root = bundle.materials.find(m => m.url === entry.url && m.mime === 'text/html')
    return root ? announcementLinks(await readFile(root.file,'utf8'), entry) : []
  }
  async collect(entry: Entry, followAssets = true): Promise<Bundle> {
    const bundle: Bundle = {entry, materials:[], errors:[]}, queue=[{url:entry.url,depth:0}], seen=new Set<string>()
    while (queue.length) {
      const {url,depth}=queue.shift()!
      if (seen.has(url)) continue
      if (seen.size >= 80 || depth > 4) {bundle.errors.push(`Ek kapsam sınırı: ${url}`);continue}
      seen.add(url)
      try {
        let bytes:Buffer, mime:string, file:string, text='', delivery:Material['delivery']='UNSUPPORTED'
        // HTML is rendered by Playwright; binaries are retained as original bytes.
        if (/\.html?(?:[?#]|$)/i.test(url)) {
          const page=await this.html(url); bytes=Buffer.from(page.html);mime='text/html';file=page.file;text=page.text;delivery='TEXT'
          if (followAssets) for (const child of assetLinks(page.html,url)) queue.push({url:child,depth:depth+1})
        } else {
          const r=await safeSourceRequest(url,['resmigazete.gov.tr','www.resmigazete.gov.tr'],{maxBytes:18_000_000})
          if(r.status!==200)throw new Error(`HTTP ${r.status}`)
          bytes=r.body;mime=r.contentType.split(';')[0]!.trim()
          if(bytes.subarray(0,5).toString()==='%PDF-')mime='application/pdf'
          if(mime==='application/pdf') {delivery='PDF';text=await extractPdfText(bytes,1000,2_000_000).catch(()=>null)??''}
          else if(/^image\/(png|jpeg|webp)$/.test(mime))delivery='IMAGE'
          else if(/^image\//.test(mime)) {
            // Gemini does not accept GIF/BMP directly. Render through Chromium to PNG.
            const page=await this.context.newPage()
            try {
              await page.setContent(`<img src="data:${mime};base64,${bytes.toString('base64')}">`)
              await page.locator('img').evaluate((image: HTMLImageElement) => image.decode())
              const animated= mime==='image/gif' && (bytes.toString('latin1').includes('NETSCAPE2.0') || bytes.toString('latin1').includes('ANIMEXTS1.0'))
              if(animated)throw new Error('Hareketli GIF tüm kareleriyle desteklenmiyor.')
              await writeFile(join(this.directory,`${identity(url)}.original`),bytes)
              bytes=await page.locator('img').screenshot({type:'png'});mime='image/png';delivery='IMAGE'
            } finally {await page.close()}
          } else if (/html/.test(mime)) {
            const page=await this.html(url);bytes=Buffer.from(page.html);mime='text/html';text=page.text;delivery='TEXT'
            if(followAssets)for(const child of assetLinks(page.html,url))queue.push({url:child,depth:depth+1})
          }
          file=join(this.directory,`${identity(url)}.${mime==='application/pdf'?'pdf':mime==='image/png'?'png':mime==='image/jpeg'?'jpg':'bin'}`)
          await writeFile(file,bytes)
        }
        const errors=delivery==='UNSUPPORTED'?[`Desteklenmeyen dosya türü: ${mime}`]:[]
        bundle.materials.push({id:identity(url),url,mime,file,text,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),delivery,errors})
        bundle.errors.push(...errors)
      } catch(error) {bundle.errors.push(`${url}: ${error instanceof Error?error.message:'Okunamadı'}`)}
    }
    return bundle
  }
}
