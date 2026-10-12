import type {WorkspaceChange} from './workspace-api'
/** Only fields supported by the server patch contract are offered for selective restore. */
export function diffWorkspaceSpecs(previous:unknown,next:unknown):WorkspaceChange[]{
 const out:WorkspaceChange[]=[]
 const walk=(a:unknown,b:unknown,path:string)=>{if(JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))walk((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key],path?`${path}.${key}`:key);return}if(Array.isArray(a)&&Array.isArray(b)&&a.length===b.length){a.forEach((v,i)=>walk(v,b[i],`${path}.${i}`));return}out.push({path,previousValue:a ?? null,nextValue:b ?? null,revertible:/^(title|summary|typeLabel|note|documentNumber|oldDeadline|newDeadline|removedRule|replacementRule|alert|emptyDayText|affectedParties\.\d+|dates\.\d+|table\.(title|note|rows\.\d+\.\d+)|timeline\.\d+\.(date|description)|supportingSource\.label|reportContent\.(title|summary|detailedAnalysis))$/.test(path)})};walk(previous,next,'');return out
}
