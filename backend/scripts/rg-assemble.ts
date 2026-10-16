import {readFile,writeFile,mkdir}from'node:fs/promises'
import{join,resolve}from'node:path'
import{dossierSchema,finalizeDossier}from'../src/modules/gazette-prototype/dossier'
import{identity,parseIndex}from'../src/modules/gazette-prototype/parsing'
import type{Bundle,Entry}from'../src/modules/gazette-prototype/contracts'
const option=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]}
const input=resolve(option('--input')!),run=JSON.parse(await readFile(join(input,'result.json'),'utf8'))
if(run.status==='RUNNING')throw new Error('Tarama devam ediyor.')
await mkdir(join(input,'dossiers-final'),{recursive:true})
const dirs=(option('--dossiers')??'dossiers,dossiers-continuation,dossiers-repair').split(',')
const metadata=new Map<string,Entry>()
for(const index of run.indices)try{const parsed=parseIndex(await readFile(join(input,'sources',`${identity(index.url)}.html`),'utf8'),index.url,run.date);for(const e of parsed.entries)metadata.set(e.id,e)}catch{/* Existing cached index metadata remains available. */}
let audit:any={status:'PENDING',findings:[],documentChecks:[]}
try{audit=JSON.parse(await readFile(join(input,'dossier-audit.json'),'utf8'))}catch{}
const documents:Array<{entry:Entry;decision:string;initialModelDecision:string;summary:string|null;reason:string;detailRead:boolean;detailedAnalysis:any;extractionStatus:string}>=[]
for(const item of [...run.regulations,...run.announcements]){
 const entry=metadata.get(item.entry.id)??item.entry
 const rawDecision=item.analysis?.decision??(item.titleDecision?.decision==='OUT'?'OUT':'REVIEW')
 const override=audit.findings?.find((f:any)=>f.entryId===entry.id&&f.decisionOverride)
 const decision=override?.decisionOverride??rawDecision
 let detailedAnalysis:any=null
 if(decision==='IN'){
  const bundle:Bundle=JSON.parse(await readFile(join(input,`${entry.id}.bundle.json`),'utf8'))
  for(const dir of dirs)try{
   const raw=JSON.parse(await readFile(join(input,dir,`${entry.id}.model.json`),'utf8'))
   detailedAnalysis={...finalizeDossier(dossierSchema.parse(JSON.parse(raw.response)),bundle,run.date),model:raw.model,rawExtractionFile:join(input,dir,`${entry.id}.model.json`)}
  }catch{/* Failed or absent attempts remain explicit below. */}
  if(detailedAnalysis){
   const finding=audit.findings?.filter((f:any)=>f.entryId===entry.id&&f.unresolved)
   if(finding?.length){detailedAnalysis.readiness.extraction='NEEDS_REVIEW';detailedAnalysis.readiness.issues.push(...finding.map((f:any)=>f.message))}
   detailedAnalysis.evidenceAudit=audit.documentChecks?.find((c:any)=>c.entryId===entry.id)??{status:'PENDING'}
   await writeFile(join(input,'dossiers-final',`${entry.id}.json`),JSON.stringify(detailedAnalysis,null,2))
  }
 }
 documents.push({entry,decision,initialModelDecision:rawDecision,summary:item.analysis?.summary??null,reason:override?.message??item.analysis?.reason??item.error??item.titleDecision?.reason??'Karar yok',detailRead:Boolean(item.analysis),detailedAnalysis,extractionStatus:decision==='IN'?(detailedAnalysis?.readiness.extraction??'FAILED'):'NOT_REQUESTED'})
}
const count=(decision:string)=>documents.filter(d=>d.decision===decision).length
const output={schemaVersion:'0.2',prototype:true,date:run.date,issueNumbers:run.indices.map((i:any)=>i.issueNumber),supplements:run.supplements,
 counts:{topLevelLinks:run.counts.topLevelLinks,regulations:run.counts.regulations,announcementItems:run.counts.announcementItems,IN:count('IN'),OUT:count('OUT'),REVIEW:count('REVIEW'),dossiersCreated:documents.filter(d=>d.detailedAnalysis).length,dossiersNeedingReview:documents.filter(d=>d.extractionStatus==='NEEDS_REVIEW').length,dossiersFailed:documents.filter(d=>d.extractionStatus==='FAILED').length},
 stages:{collection:run.status,extraction:documents.some(d=>['FAILED','NEEDS_REVIEW'].includes(d.extractionStatus))?'NEEDS_REVIEW':'EXTRACTED',historicalLookup:'NOT_EXECUTED',legalPublication:'NOT_APPROVED'},audit,documents,sourceRun:join(input,'result.json'),createdAt:new Date().toISOString()}
await writeFile(join(input,'filter-report.json'),JSON.stringify(output,null,2));console.log(JSON.stringify({counts:output.counts,stages:output.stages,file:join(input,'filter-report.json')}))
