import type { RenderContext } from '@atez/modules'
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
const text=(v:unknown)=>typeof v==='string'?v:''
const list=(v:unknown):unknown[]=>Array.isArray(v)?v:[]
/** Map supported legacy evidence without treating report-generation dates as publication dates. */
export function legacyContext(base:Record<string,unknown>,evidence:unknown,sources:{label:string;url:string|null}[]):RenderContext{
 const outer=record(evidence),a=record(outer.analysis??evidence),change=record(a.change),doc=record(a.document)
 const kinds:Record<string,string>={NEW_REGULATION:'NEW',AMENDMENT:'AMENDMENT',DEADLINE_EXTENSION:'EXTENSION',REPEAL:'REPEAL',SUSPENSION:'SUSPENSION',ANNOUNCEMENT:'ANNOUNCEMENT',NO_CHANGE:'NONE'}
 const publication=text(doc.gazetteDate)||null
 const comparisonNotes=list(a.comparisons).map(v=>{const r=record(v);return `${text(r.label)}: ${text(r.before)} → ${text(r.after)}`})
 return {document:{title:text(doc.title)||text(base.documentTitle)||text(base.title),officialNumber:text(doc.documentNumber)||text(base.documentNumber)||null,docType:'OTHER',institution:null,changeKind:kinds[text(change.type)]??'OTHER',changeKindLabel:text(base.typeLabel)||'Kaynak analizi',publicationDate:publication,url:text(doc.sourceUrl)||sources[0]?.url||null},analysis:{
 summary:text(change.summary)||text(a.summary)||text(base.summary),operationalImpact:text(change.operationalImpact)||text(change.detailedAnalysis)||text(a.detailedAnalysis)||text(base.note),comparisonCommentary:comparisonNotes.join('\n')||null,
 affected:{parties:list(a.affectedParties??base.affectedParties).map(v=>typeof v==='string'?v:[text(record(v).name),text(record(v).impact)].filter(Boolean).join(': ')).filter(Boolean),sectors:[]},
 exceptions:list(a.unresolvedReferences).map(v=>typeof v==='string'?v:[text(record(v).reference),text(record(v).reason)].filter(Boolean).join(': ')).filter(Boolean),
 claims:list(a.changes).map(v=>({text:text(record(v).description)})).filter(v=>v.text),
 comparison:{rows:[],note:comparisonNotes.join('\n')||null,notes:comparisonNotes},
 dates:{publication,effective:list(a.effectiveDates).map(v=>{const d=record(v);return {scope:null,rule:'EXPLICIT_DATE',date:text(d.date)||null,label:text(d.description)}})},
 priorState:{status:'NOT_FOUND',statusLabel:'Önceki durum doğrulanmadı',comparisonDate:null,note:text(change.previousRule)||null},
 documents:sources.map(s=>({title:s.label,role:'SUPPORTING',roleLabel:'Kaynak',publicationDate:null,officialNumber:null,url:s.url}))}}
}
