import { createHash } from 'node:crypto'
import { describe,it,expect,vi } from 'vitest'
import {captureSourceDocument,discoverAttachments} from '../../src/modules/managed-sources/source-attachments'
import {samplePdf} from '../helpers/sample-pdf'
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2QAAAAASUVORK5CYII=','base64')
const url='https://ggm.ticaret.gov.tr/duyurular/test'
const root='https://ticaret.gov.tr/'
describe('source attachment capture',()=>{
 it('discovers PDF query links, responsive images and embedded PDFs without navigation or foreign links',()=>{
  const links=discoverAttachments('<header><img src="/logo.png"></header><main><a href="/ek.PDF?download=1#page=2">Ek</a><img src="/a.png" srcset="/a.png 1x, /b.webp 2x"><object data="/second.pdf"></object><a href="https://other.example/a.pdf">Foreign</a><img src="https://127.0.0.1/a.png"></main>',url,root)
  expect(links.map(link=>link.url)).toEqual(['https://ggm.ticaret.gov.tr/ek.PDF?download=1','https://ggm.ticaret.gov.tr/a.png','https://ggm.ticaret.gov.tr/b.webp','https://ggm.ticaret.gov.tr/second.pdf'])
 })
 it('archives original HTML, real PDF and image bytes, with checksums and readable PDF content',async()=>{
  const bodies=new Map([ [url,{body:Buffer.from('<main><h1>Mevzuat duyurusu</h1><a href="/ek.pdf">PDF Ek</a><img src="/image.png" alt="Cetvel"></main>'),contentType:'text/html'}], ['https://ggm.ticaret.gov.tr/ek.pdf',{body:samplePdf(),contentType:'application/pdf'}],['https://ggm.ticaret.gov.tr/image.png',{body:png,contentType:'image/png'}] ])
  const stored=new Map<string,Buffer>()
  const store={putRunFile:vi.fn(async(key:string,body:Buffer,mediaType:string)=>{stored.set(key,body);return {bucket:'test',objectKey:key,mediaType,sha256:createHash('sha256').update(body).digest('hex'),byteSize:BigInt(body.length)}})}
  const capture=await captureSourceDocument(url,root,store,[],100000,async value=>{const body=bodies.get(value);if(!body)throw new Error('404');return body})
  expect(capture.status).toBe('COMPLETED');expect(capture.files).toHaveLength(3)
  expect(capture.contentText).toContain('Import regulation annex')
  const image=capture.files.find(file=>file.role==='IMAGE')!
  expect(stored.get(image.objectKey!)).toEqual(png)
  expect(image.sha256).toBe(createHash('sha256').update(png).digest('hex'))
 })
 it('reports missing PDF annexes and a truncated asset list as partial',async()=>{
  const store={putRunFile:vi.fn().mockResolvedValue({bucket:'test',objectKey:'key'})}
  const capture=await captureSourceDocument(url,root,store,[],100000,async value=>{if(value!==url)throw new Error('HTTP 404');return {body:Buffer.from('<main><a href="/missing.pdf">Mevzuat eki</a></main>'),contentType:'text/html'}})
  expect(capture.status).toBe('PARTIAL');expect(capture.files[1]).toMatchObject({status:'FAILED',error:'HTTP 404'})
 })
 it('does not call an HTML login page a successfully retrieved PDF',async()=>{
  const capture=await captureSourceDocument('https://ticaret.gov.tr/a.pdf',root,{putRunFile:vi.fn()},[],100000,async()=>({body:Buffer.from('<h1>Login</h1>'),contentType:'text/html'}))
  expect(capture.status).toBe('FAILED');expect(capture.errors[0]).toContain('PDF içeriği')
 })
 it('captures an annex beside a direct PDF, including an Office/ZIP file as original bytes',async()=>{
  const zip=Buffer.from('504b05060000000000000000000000000000000000000000','hex')
  const store={putRunFile:vi.fn().mockResolvedValue({bucket:'test',objectKey:'file'})}
  const capture=await captureSourceDocument('https://ticaret.gov.tr/main.pdf',root,store,[{url:'https://ticaret.gov.tr/annex.zip',title:'Ek arşiv'}],100000,async value=>value.endsWith('.pdf')?{body:samplePdf(),contentType:'application/pdf'}:{body:zip,contentType:'application/zip'})
  expect(capture.status).toBe('COMPLETED');expect(capture.files).toHaveLength(2)
  expect(store.putRunFile.mock.calls[1]?.[1]).toEqual(zip)
 })
 it('follows same-source relative links from the actual redirected page URL',async()=>{
  const store={putRunFile:vi.fn().mockResolvedValue({bucket:'test',objectKey:'file'})};const fetched:string[]=[]
  const capture=await captureSourceDocument('https://ticaret.gov.tr/page',root,store,[],100000,async value=>{fetched.push(value);return value.endsWith('annex.pdf')?{body:samplePdf(),contentType:'application/pdf'}:{body:Buffer.from('<main><a href="annex.pdf">Ek</a></main>'),contentType:'text/html',finalUrl:'https://ticaret.gov.tr/page/'}})
  expect(capture.status).toBe('COMPLETED');expect(fetched[1]).toBe('https://ticaret.gov.tr/page/annex.pdf')
 })
 it('records the size-limit failure instead of silently truncating the document',async()=>{
  const capture=await captureSourceDocument(url,root,{putRunFile:vi.fn()},[],5,async()=>({body:Buffer.from('123456'),contentType:'text/html'}))
  expect(capture.status).toBe('FAILED');expect(capture.errors[0]).toContain('boyut sınırı')
 })

 it('finds the real lazy-loaded picture as well as direct PDF references on official sites',()=>{
  const links=discoverAttachments('<main><img src="data:image/png;base64,AAA" data-src="/diagram.png"><a href="https://www.resmigazete.gov.tr/annex.pdf">Resmî ek</a></main>',url,root)
  expect(links.map(link=>link.url)).toEqual(['https://www.resmigazete.gov.tr/annex.pdf','https://ggm.ticaret.gov.tr/diagram.png'])
 })

 it('keeps legacy publisher article files and excludes advertising and related stories',()=>{
  const html='<a href="/advert.pdf">Advert</a><section><img src="/article.jpg"><div class="haber-dokuman-kart"><a href="/annex.pdf">Ek</a></div><div class="haberler"><img src="/other.jpg"></div></section>'
  expect(discoverAttachments(html,'https://www.igmd.org.tr/news','https://www.igmd.org.tr/').map(file=>file.url)).toEqual(['https://www.igmd.org.tr/annex.pdf','https://www.igmd.org.tr/article.jpg'])
  expect(discoverAttachments('<div id="SiteGenelHeader"><img src="/logo.gif"></div><div id="SiteGenelContent"><a href="/law.pdf">Kanun</a></div>','https://www.mevzuat.net/law','https://www.mevzuat.net/').map(file=>file.url)).toEqual(['https://www.mevzuat.net/law.pdf'])
 })

})
