import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Analyst, Bundle, Collector, Decision, Entry, Index, TitleDecision } from './contracts'
import type { runGazette } from './run'

type Run = Awaited<ReturnType<typeof runGazette>>
type State = { version:1; date:string; indices:Record<string,Index>; completedEditions:string[]; bundles:Record<string,Bundle>; analyses:Record<string,Decision>; titles:Record<string,TitleDecision>; checks:unknown[] }
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
const bundleKey=(entry:Entry,assets=true)=>`${entry.id}:${assets}`

/** Local durable checkpoint adapter. The domain runner remains unaware of disk or caching. */
export class IncrementalSession {
  readonly activity={indexFetches:0,indexReuses:0,bundleFetches:0,bundleReuses:0,analysisCalls:0,analysisReuses:0,titleItemsAnalyzed:0,titleItemsReused:0,newEditions:[] as string[]}
  private constructor(private directory:string,private state:State,private policyKey:string) {}
  static async open(directory:string,date:string,policyKey:string) {
    const dir=resolve(directory);await mkdir(join(dir,'materials'),{recursive:true})
    const lock=await open(join(dir,'run.lock'),'wx').catch(()=>{throw new Error('Bu tarih için başka bir işlem çalışıyor veya önceki işlem kilidi var. Aynı gün eşzamanlı işlenmez.')})
    await lock.writeFile(JSON.stringify({pid:process.pid,date,startedAt:new Date().toISOString()}));await lock.close()
    try {
      let state:State
      try {state=JSON.parse(await readFile(join(dir,'state.json'),'utf8'))}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;state={version:1,date,indices:{},completedEditions:[],bundles:{},analyses:{},titles:{},checks:[]}}
      if(state.version!==1||state.date!==date)throw new Error('Önbellek tarih/sürüm kimliği uyuşmuyor.')
      return new IncrementalSession(dir,state,policyKey)
    }catch(error){await rm(join(dir,'run.lock'));throw error}
  }
  async close(){await rm(join(this.directory,'run.lock'),{force:true})}
  private async persist(){const file=join(this.directory,'state.json');await writeFile(file+'.tmp',JSON.stringify(this.state,null,2));await rename(file+'.tmp',file)}
  private analysisKey(bundle:Bundle){return hash({policy:this.policyKey,entry:bundle.entry,materials:bundle.materials.map(m=>[m.id,m.sha256,m.delivery]),errors:bundle.errors})}
  private titleKey(entry:Entry){return hash({policy:this.policyKey,entry})}
  private async valid(bundle:Bundle){
    if(bundle.errors.length||!bundle.materials.length||bundle.materials.some(m=>m.errors.length))return false
    try {for(const m of bundle.materials)if(sha(await readFile(m.file))!==m.sha256)return false;return true}catch{return false}
  }
  private async retain(bundle:Bundle,assets:boolean){
    if(!await this.valid(bundle))return
    const retained=structuredClone(bundle)
    for(const m of retained.materials){const path=join(this.directory,'materials',m.sha256);await writeFile(path,await readFile(m.file));m.file=path}
    this.state.bundles[bundleKey(bundle.entry,assets)]=retained;await this.persist()
  }
  collector(source:Collector):Collector {
    return {
      index:async(date,url)=>{
        if(date!==this.state.date)throw new Error('Önbellek farklı tarih için kullanılamaz.')
        if(url&&this.state.completedEditions.includes(url)&&this.state.indices[url]){this.activity.indexReuses++;return structuredClone(this.state.indices[url]!)}
        this.activity.indexFetches++
        const index=await source.index(date,url)
        if(!this.state.completedEditions.includes(index.url))this.activity.newEditions.push(index.url)
        this.state.indices[index.url]=index;await this.persist();return index
      },
      collect:async(entry,assets=true)=>{
        const cached=this.state.bundles[bundleKey(entry,assets)]
        if(cached&&await this.valid(cached)){this.activity.bundleReuses++;return structuredClone({...cached,entry})}
        this.activity.bundleFetches++
        const bundle=await source.collect(entry,assets);await this.retain(bundle,assets);return bundle
      },
      announcementEntries:(entry,bundle)=>source.announcementEntries(entry,bundle),
    }
  }
  analyst(source:Analyst):Analyst {
    return {
      titles:async entries=>{
        const missing=entries.filter(e=>!this.state.titles[this.titleKey(e)])
        this.activity.titleItemsReused+=entries.length-missing.length
        if(missing.length){
          this.activity.titleItemsAnalyzed+=missing.length
          const decisions=await source.titles(missing)
          if(decisions.length!==missing.length||new Set(decisions.map(d=>d.id)).size!==missing.length||decisions.some(d=>!missing.some(e=>e.id===d.id)))throw new Error('Başlık sonuç kümesi uyuşmuyor.')
          for(const e of missing)this.state.titles[this.titleKey(e)]=decisions.find(d=>d.id===e.id)!
          await this.persist()
        }
        return entries.map(e=>structuredClone(this.state.titles[this.titleKey(e)]!))
      },
      analyze:async bundle=>{
        const key=this.analysisKey(bundle),cached=this.state.analyses[key]
        if(cached){this.activity.analysisReuses++;return structuredClone(cached)}
        this.activity.analysisCalls++
        const decision=await source.analyze(bundle)
        if(!bundle.errors.length&&decision.readable&&decision.decision!=='REVIEW'&&decision.evidenceVerification!=='FAILED'&&decision.materials.every(m=>m.readable)){
          this.state.analyses[key]=decision;await this.persist()
        }
        return decision
      },
    }
  }
  async finish(result:Run){
    // Only fully processed editions may skip future index downloads. Successful documents
    // within a partial run are still checkpointed and reused individually.
    for(const index of result.indices){
      const successful=index.entries.every(e=>{
        const regulation=result.regulations.find(r=>r.entry.id===e.id)
        if(regulation)return Boolean(regulation.analysis&&regulation.analysis.decision!=='REVIEW'&&!regulation.error)
        const items=result.announcements.filter(a=>a.entry.parentUrl===e.url||a.entry.id===e.id)
        return items.length>0&&items.every(a=>!a.error&&(a.analysis?a.analysis.decision!=='REVIEW':a.titleDecision?.decision==='OUT'))
      })
      if(successful&&!result.errors.length&&!this.state.completedEditions.includes(index.url))this.state.completedEditions.push(index.url)
    }
    const checkedAt=new Date().toISOString()
    const summary={checkedAt,date:result.date,status:result.status,change:result.status==='BLOCKED'?'CHECK_FAILED':this.activity.bundleFetches||this.activity.analysisCalls||this.activity.titleItemsAnalyzed?'PROCESSED_NEW_OR_PENDING':'NO_NEW_DOCUMENTS',...this.activity,completedEditions:[...this.state.completedEditions],supplements:result.supplements}
    this.state.checks.push(summary);await this.persist();return summary
  }
  /** Import an existing prototype attempt once, without redownloading its source files. */
  async seed(result:Run,readBundle:(id:string)=>Promise<Bundle>){
    if(result.date!==this.state.date)throw new Error('Aktarılan çalışma başka bir tarihe ait.')
    for(const page of result.pages)await this.retain(page,page.entry.kind==='REGULATION')
    for(const item of [...result.regulations,...result.announcements]){
      if('titleDecision' in item&&item.titleDecision)this.state.titles[this.titleKey(item.entry)]=item.titleDecision as TitleDecision
      if(item.analysis&&item.analysis.decision!=='REVIEW'&&item.analysis.readable&&!item.error){
        const bundle=await readBundle(item.entry.id)
        if(await this.valid(bundle)){await this.retain(bundle,true);this.state.analyses[this.analysisKey(bundle)]=item.analysis}
      }
    }
    // Global navigation metadata from old attempts is deliberately not imported as discovery.
    for(const index of result.indices)this.state.indices[index.url]={...index,supplementUrls:index.supplementUrls.filter(url=>new URL(url).searchParams.get('tarih')===result.date||url.includes(result.date.replaceAll('-','')+'M'))}
    await this.finish(result)
  }
}
