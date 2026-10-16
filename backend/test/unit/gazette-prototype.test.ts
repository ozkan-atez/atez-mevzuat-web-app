import { describe,it,expect } from 'vitest'
import { parseIndex,assetLinks,announcementLinks,officialUrl } from '../../src/modules/gazette-prototype/parsing'
import { runGazette } from '../../src/modules/gazette-prototype/run'
import type { Analyst,Collector,Entry } from '../../src/modules/gazette-prototype/contracts'
import { enforceTitleUncertainty } from '../../src/modules/gazette-prototype/gemini-analyst'
import { GeminiAnalyst } from '../../src/modules/gazette-prototype/gemini-analyst'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GoogleGenAI } from '@google/genai'
import type { Bundle } from '../../src/modules/gazette-prototype/contracts'
const base='https://www.resmigazete.gov.tr/13.10.2026'
const html='<body>13 Ekim 2026 Tarihli ve 33399 Sayılı Resmî Gazete<a href="/eskiler/2026/10/20261013-1.htm">Yönetmelik</a><a href="/ilanlar/eskiilanlar/2026/10/20261013-2.htm">İlanlar</a><a href="/fihrist?tarih=2026-09-06&mukerrer=1">Son Mükerrer</a></body>'
describe('gazette prototype',()=>{
 it('does not confuse an older latest supplement with the requested date',()=>{const index=parseIndex(html,base,'2026-10-13');expect(index.entries).toHaveLength(2);expect(index.supplementUrls).toEqual([])})
 it('uses the day-specific numbered supplements and ignores the global button even on the same day',()=>{
   const withLinks=html.replace('</body>','<a href="/fihrist?tarih=2026-10-13&mukerrer=9">Son Mükerrer</a><a href="/fihrist?tarih=2026-10-13&mukerrer=1">Mükerrer 1</a><a href="/fihrist?tarih=2026-10-13&mukerrer=2">Mükerrer 2</a></body>')
   expect(parseIndex(withLinks,base,'2026-10-13').supplementUrls).toEqual([base.replace('/13.10.2026','/fihrist?tarih=2026-10-13&mukerrer=1'),base.replace('/13.10.2026','/fihrist?tarih=2026-10-13&mukerrer=2')])
 })
 it('fails closed on wrong issue date',()=>{expect(()=>parseIndex(html,base,'2026-10-12')).toThrow()})
 it('collects nested image, PDF and embedded HTML references without anchors',()=>{expect(assetLinks('<img src="a.gif"><a href="ek.pdf">Ek</a><iframe src="nested.htm"></iframe><a href="#top">Yukarı</a>',base)).toHaveLength(3)})
 it('rejects foreign assets',()=>{expect(()=>officialUrl('https://evil.example/a.pdf',base)).toThrow()})
 it('flags embedded image representations instead of silently losing them',()=>{expect(()=>assetLinks('<img src="data:image/png;base64,AA==">',base)).toThrow()})
 it('escalates institution-only notices even if the model says OUT',()=>{const entry:Entry={id:'court',title:'Asliye Ceza Mahkemesinden:',url:base,kind:'ANNOUNCEMENT',parentUrl:base,titleBasis:'INSTITUTION_ONLY'};expect(enforceTitleUncertainty([entry],[{id:'court',decision:'OUT',reason:'Tahmin'}])[0]?.decision).toBe('REVIEW')})
 it('preserves the tender subject with its institution',()=>{const entry:Entry={id:'a',title:'İlanlar',url:base,kind:'ANNOUNCEMENT',parentUrl:base};expect(announcementLinks('<p>YAĞ SATIN ALINACAKTIR</p><p><a href="a.pdf">TCDD’den:</a></p>',entry)[0]?.title).toBe('YAĞ SATIN ALINACAKTIR TCDD’den:')})
 it('reads every main item; follows uncertain announcement titles; keeps failed analysis as review',async()=>{
   const entries=parseIndex(html,base,'2026-10-13').entries, calls:string[]=[]
   const collector:Collector={index:async()=>parseIndex(html,base,'2026-10-13'),collect:async(entry)=>{calls.push(entry.id);return {entry,materials:[],errors:[]}},announcementEntries:async(entry)=>[{...entry,id:'child',url:base+'/child.pdf'}]}
   const analyst:Analyst={titles:async()=>[{id:'child',decision:'REVIEW',reason:'Kurum adı yetersiz'}],analyze:async()=>{throw new Error('Okunamadı')}}
   const r=await runGazette({date:'2026-10-13',expectedMainLinks:2},collector,analyst,async()=>{},()=>{})
   expect(calls).toEqual([entries[0]!.id,entries[1]!.id,'child']);expect(r.status).toBe('NEEDS_REVIEW');expect(r.counts.REVIEW).toBe(2)
 })
 it('fully reads a standalone announcement page even when its title is OUT',async()=>{
   const index=parseIndex(html,base,'2026-10-13'),calls:Array<{id:string;assets:boolean|undefined}>=[]
   const collector:Collector={index:async()=>index,collect:async(entry,assets)=>{calls.push({id:entry.id,assets});return {entry,materials:[],errors:[]}},announcementEntries:async()=>[]}
   const analyst:Analyst={titles:async entries=>entries.map(e=>({id:e.id,decision:'OUT',reason:'Günlük veri'})),analyze:async()=>({decision:'OUT',summary:'Okundu',reason:'Kapsam dışı',readable:true,materials:[],evidence:[]})}
   await runGazette({date:'2026-10-13'},collector,analyst,async()=>{},()=>{})
   expect(calls.filter(c=>c.id===index.entries[1]!.id)).toHaveLength(2)
 })
})

describe('Gemini material verification',()=>{
 it('does not certify image evidence just because a heading quote matches',async()=>{
   const dir=await mkdtemp(join(tmpdir(),'rg-test-'))
   try {
     const file=join(dir,'image.jpg');await writeFile(file,Buffer.from([255,216,255]))
     const bundle:Bundle={entry:{id:'root',title:'Kurlar',url:base,kind:'ANNOUNCEMENT',parentUrl:base},errors:[],materials:[
       {id:'text',url:base,mime:'text/html',file:'',text:'MERKEZ BANKASI',sha256:'a',bytes:10,delivery:'TEXT',errors:[]},
       {id:'image',url:base+'/image.jpg',mime:'image/jpeg',file,text:'',sha256:'b',bytes:3,delivery:'IMAGE',errors:[]}]}
     const response={decision:'OUT',summary:'Günlük kurlar',reason:'Operasyonel veri',readable:true,materials:[{id:'text',readable:true,issue:''},{id:'image',readable:true,issue:''}],evidence:[{materialId:'text',quote:'MERKEZ BANKASI'}]}
     const api={models:{generateContent:async()=>({text:JSON.stringify(response)})}} as unknown as GoogleGenAI
     const result=await new GeminiAnalyst(api,'test',dir).analyze(bundle)
     expect(result.evidenceVerification).toBe('VISUAL_REVIEW_REQUIRED')
   }finally{await rm(dir,{recursive:true,force:true})}
 })
 it('allows one evidence repair but retains REVIEW when quotations still fail',async()=>{
   const dir=await mkdtemp(join(tmpdir(),'rg-test-'));let calls=0
   try {
     const bundle:Bundle={entry:{id:'root',title:'Test',url:base,kind:'REGULATION',parentUrl:base},errors:[],materials:[{id:'text',url:base,mime:'text/html',file:'',text:'Gerçek kaynak metni',sha256:'a',bytes:20,delivery:'TEXT',errors:[]}]}
     const response={decision:'OUT',summary:'Özet',reason:'Gerekçe',readable:true,materials:[{id:'text',readable:true,issue:''}],evidence:[{materialId:'text',quote:'Kaynakta olmayan alıntı'}]}
     const api={models:{generateContent:async()=>{calls++;return {text:JSON.stringify(response)}}}} as unknown as GoogleGenAI
     const result=await new GeminiAnalyst(api,'test',dir).analyze(bundle)
     expect(calls).toBe(2);expect(result.decision).toBe('REVIEW');expect(result.evidenceVerification).toBe('FAILED')
   }finally{await rm(dir,{recursive:true,force:true})}
 })
})
