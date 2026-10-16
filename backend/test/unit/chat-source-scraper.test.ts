import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { activeSourceProfile } from '../../src/modules/managed-sources/source-profile-store'
import { sourceLogin } from '../../src/modules/managed-sources/source-secrets'
import { openSourceSession } from '../../src/modules/managed-sources/source-session'
import { collectSource } from '../../src/modules/managed-sources/source-collector'
import { belongsToChatSource, scrapeChatSource } from '../../src/modules/chat/infrastructure/scrape-chat-source'
import { PrismaAssistantKnowledge } from '../../src/modules/chat/infrastructure/prisma-assistant-knowledge'
vi.mock('../../src/modules/managed-sources/source-profile-store',()=>({activeSourceProfile:vi.fn()}))
vi.mock('../../src/modules/managed-sources/source-secrets',()=>({sourceLogin:vi.fn()}))
vi.mock('../../src/modules/managed-sources/source-collector',()=>({collectSource:vi.fn()}))
vi.mock('../../src/modules/managed-sources/source-session',()=>({openSourceSession:vi.fn(),decodeSource:(resource:{body:Buffer})=>resource.body.toString()}))
const db={} as PrismaClient
const source={id:'source-1',key:'custom',title:'Kaynak',url:'https://example.com',description:null}
const close=vi.fn(),binary=vi.fn()
beforeEach(()=>{
 vi.resetAllMocks()
 vi.mocked(activeSourceProfile).mockResolvedValue({id:'p1',version:1,config:{name:'Kaynak',transport:'HTTP',auth:{mode:'NONE'},allowedHosts:['example.com','other.com'],feeds:[{url:'https://example.com/news',title:'Haber',row:'li',link:'a'}],maxPages:10,maxDocuments:100,delayMs:300}})
 vi.mocked(sourceLogin).mockResolvedValue(null)
 vi.mocked(openSourceSession).mockResolvedValue({html:vi.fn(),binary,close})
 vi.mocked(collectSource).mockResolvedValue({items:[{title:'Gümrük',url:'https://example.com/article',publishedOn:'2026-10-13',feedUrl:'https://example.com/news'},{title:'Dış kaynak',url:'https://other.com/article',publishedOn:'2026-10-13',feedUrl:'https://example.com/news'}],warnings:[],pages:[],observed:2,oldestDate:null,newestDate:null})
 binary.mockResolvedValue({body:Buffer.from('<html><body><main>Kaynak kanıtı</main></body></html>'),contentType:'text/html',finalUrl:'https://example.com/article'})
})
describe('selected source scraper',()=>{
 it('lists the actual active Sources catalog, not managed-source archives',async()=>{
  const findMany=vi.fn().mockResolvedValue([{id:'s1',key:'resmi-gazete',name:'Resmî Gazete',baseUrl:'https://resmigazete.gov.tr',description:null}])
  const knowledge=new PrismaAssistantKnowledge({source:{findMany}} as unknown as PrismaClient,{getContent:vi.fn()})
  expect(await knowledge.searchChatSources({limit:100})).toEqual([{id:'s1',key:'resmi-gazete',title:'Resmî Gazete',url:'https://resmigazete.gov.tr',description:null}])
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({where:{isActive:true}}))
 })
 it('scrapes fresh content, restricts profile hosts, and never fetches another source',async()=>{
  const result=await scrapeChatSource(db,source,'13 Ekim 2026 gümrük')
  expect(openSourceSession).toHaveBeenCalledWith(expect.objectContaining({allowedHosts:['example.com'],maxPages:10,maxDocuments:100}),null)
  expect(binary).toHaveBeenCalledTimes(1)
  expect(binary).toHaveBeenCalledWith('https://example.com/article',4000000)
  expect(result.matchedItems).toHaveLength(1)
  expect(result.targetDate).toBe('2026-10-13')
  expect(result.documents).toEqual([expect.objectContaining({text:'Kaynak kanıtı',url:'https://example.com/article'})])
  expect(close).toHaveBeenCalled()
 })
 it('reads an unprofiled source and only its own visible links',async()=>{
  vi.mocked(activeSourceProfile).mockRejectedValue(new Error('PROFILE_REQUIRED: Profil gerekli'))
  const html=vi.fn().mockResolvedValue('<a href="https://example.com/article">Gümrük</a><a href="https://other.com/article">Başka kaynak</a>')
  vi.mocked(openSourceSession).mockResolvedValue({html,binary,close})
  const result=await scrapeChatSource(db,source,'Gümrük')
  expect(collectSource).not.toHaveBeenCalled()
  expect(result.warnings.join(' ')).toContain('Doğrulanmış tarama profili yok')
  expect(binary.mock.calls.every(([url])=>String(url).startsWith('https://example.com'))).toBe(true)
  expect(result.documents.length).toBeGreaterThan(0)
 })
 it('reports unreadable content without falling back to another source',async()=>{
  binary.mockRejectedValue(new Error('HTTP 403'))
  const result=await scrapeChatSource(db,source,'Özetle')
  expect(result.documents).toEqual([])
  expect(result.warnings.join(' ')).toContain('erişilemedi')
  expect(binary).toHaveBeenCalledTimes(1)
  expect(close).toHaveBeenCalled()
 })
 it('rejects foreign redirects and closes on cancellation',async()=>{
  binary.mockResolvedValue({body:Buffer.from('wrong evidence'),contentType:'text/plain',finalUrl:'https://other.com/page'})
  expect((await scrapeChatSource(db,source,'Özetle')).documents).toEqual([])
  const controller=new AbortController();controller.abort()
  await expect(scrapeChatSource(db,source,'Özetle',controller.signal)).rejects.toThrow()
  expect(binary).toHaveBeenCalledTimes(1)
 })
 it('accepts only HTTPS on the source domain or its subdomains',()=>{
  expect(belongsToChatSource('https://sub.example.com/page',source.url)).toBe(true)
  for(const url of ['https://example.com.evil.com','http://example.com','https://other.com','https://localhost']) expect(belongsToChatSource(url,source.url)).toBe(false)
 })
})
