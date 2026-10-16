import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe,it,expect } from 'vitest'
import { IncrementalSession } from '../../src/modules/gazette-prototype/incremental'
import { runGazette } from '../../src/modules/gazette-prototype/run'
import type { Analyst,Collector,Entry,Index } from '../../src/modules/gazette-prototype/contracts'

const date='2026-10-13',main='https://www.resmigazete.gov.tr/13.10.2026'
const supplement=(n:number)=>`https://www.resmigazete.gov.tr/fihrist?tarih=${date}&mukerrer=${n}`
const entry=(n:number):Entry=>({id:`doc${n}`,title:`Belge ${n}`,url:`https://www.resmigazete.gov.tr/eskiler/2026/10/20261013${n?`M${n}`:''}-1.htm`,kind:'REGULATION',parentUrl:n?supplement(n):main})

async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'rg-incremental-')),file=join(dir,'source.html'),bytes=Buffer.from('Kaynak metni')
 await writeFile(file,bytes)
 let visible=0,fail=false,unreadable=false
 const calls={indices:[] as string[],documents:[] as string[],analyses:[] as string[]}
 const collector:Collector={
  index:async(_date,url)=>{calls.indices.push(url??main);if(fail)throw new Error('Fihrist alınamadı');const n=url?Number(new URL(url).searchParams.get('mukerrer')):0;return {url:url??main,date,issueNumber:'33399',text:'Fihrist',entries:[entry(n)],supplementUrls:n?[]:Array.from({length:visible},(_,i)=>supplement(i+1))} as Index},
  collect:async e=>{calls.documents.push(e.id);return {entry:e,errors:[],materials:[{id:e.id,url:e.url,mime:'text/html',file,text:bytes.toString(),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,delivery:'TEXT',errors:[]}]}},
  announcementEntries:async()=>[],
 }
 const analyst:Analyst={titles:async()=>[],analyze:async b=>{calls.analyses.push(b.entry.id);return {decision:unreadable?'REVIEW':'IN',summary:'Özet',reason:'Gerekçe',readable:!unreadable,materials:[{id:b.entry.id,readable:!unreadable,issue:''}],evidence:[{materialId:b.entry.id,quote:'Kaynak metni'}],evidenceVerification:'EXACT_TEXT'}}}
 const run=async(policy='v1')=>{
  const memory=await IncrementalSession.open(join(dir,'cache'),date,policy)
  try{const result=await runGazette({date},memory.collector(collector),memory.analyst(analyst),async()=>{},()=>{});return {result,activity:await memory.finish(result)}}finally{await memory.close()}
 }
 return {dir,calls,run,setVisible:(n:number)=>{visible=n},setFail:(value:boolean)=>{fail=value},setUnreadable:(value:boolean)=>{unreadable=value}}
}

describe('durable per-day incremental processing',()=>{
 it('05 processes main; 09 checks only; 15 processes M1; 18 checks only; M2 processes only M2',async()=>{
  const f=await fixture()
  try{
   const at05=await f.run();expect(at05.activity.bundleFetches).toBe(1);expect(at05.activity.analysisCalls).toBe(1)
   const at09=await f.run();expect(at09.activity.indexFetches).toBe(1);expect(at09.activity.bundleFetches).toBe(0);expect(at09.activity.analysisCalls).toBe(0);expect(at09.activity.change).toBe('NO_NEW_DOCUMENTS')
   f.setVisible(1)
   const at15=await f.run();expect(at15.activity.indexFetches).toBe(2);expect(at15.activity.bundleFetches).toBe(1);expect(at15.activity.analysisCalls).toBe(1);expect(at15.result.regulations).toHaveLength(2)
   const at18=await f.run();expect(at18.activity.indexFetches).toBe(1);expect(at18.activity.indexReuses).toBe(1);expect(at18.activity.bundleFetches).toBe(0);expect(at18.activity.analysisCalls).toBe(0)
   f.setVisible(2)
   const next=await f.run();expect(next.activity.indexFetches).toBe(2);expect(next.activity.bundleFetches).toBe(1);expect(next.activity.analysisCalls).toBe(1);expect(next.result.regulations).toHaveLength(3)
   expect(f.calls.documents).toEqual(['doc0','doc1','doc2']);expect(f.calls.analyses).toEqual(['doc0','doc1','doc2'])
  }finally{await rm(f.dir,{recursive:true,force:true})}
 })
 it('does not report no new issues when the live index check fails',async()=>{
  const f=await fixture();try{await f.run();f.setFail(true);const r=await f.run();expect(r.result.status).toBe('BLOCKED');expect(r.activity.change).toBe('CHECK_FAILED');expect(r.result.supplements.status).toBe('UNKNOWN')}finally{await rm(f.dir,{recursive:true,force:true})}
 })
 it('retries unfinished analysis without downloading the successful source again',async()=>{
  const f=await fixture();try{f.setUnreadable(true);const first=await f.run();expect(first.activity.completedEditions).toEqual([]);f.setUnreadable(false);const next=await f.run();expect(next.activity.bundleFetches).toBe(0);expect(next.activity.analysisCalls).toBe(1);expect(next.activity.completedEditions).toEqual([main])}finally{await rm(f.dir,{recursive:true,force:true})}
 })
 it('invalidates analysis on model/policy change but reuses source bytes',async()=>{
  const f=await fixture();try{await f.run('v1');const r=await f.run('v2');expect(r.activity.bundleFetches).toBe(0);expect(r.activity.analysisCalls).toBe(1)}finally{await rm(f.dir,{recursive:true,force:true})}
 })
 it('prevents simultaneous runs for the same day',async()=>{
  const f=await fixture();const memory=await IncrementalSession.open(join(f.dir,'cache'),date,'v1')
  try{await expect(IncrementalSession.open(join(f.dir,'cache'),date,'v1')).rejects.toThrow('eşzamanlı')}finally{await memory.close();await rm(f.dir,{recursive:true,force:true})}
 })
})
