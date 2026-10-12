export interface WebResearch {
  mode?:'browser'
  completed?:boolean
  sources:Array<{title:string;url:string}>
  citations:Array<{endIndex:number;text?:string;sourceIndices:number[]}>
  queries:string[]
  searchSuggestions:string|null
}
export interface GroundingMetadata {
  groundingChunks?:Array<{web?:{uri?:string;title?:string}}>
  groundingSupports?:Array<{segment?:{endIndex?:number;text?:string};groundingChunkIndices?:number[]}>
  webSearchQueries?:string[]
  searchEntryPoint?:{renderedContent?:string}
}
export function normalizeGrounding(metadata:GroundingMetadata):WebResearch {
  const indices=new Map<number,number>()
  const sources:WebResearch['sources']=[]
  for(const [i,chunk] of (metadata.groundingChunks ?? []).entries()){
    try{const url=new URL(chunk.web?.uri ?? '');if(url.protocol!=='https:')continue;indices.set(i,sources.length);sources.push({title:(chunk.web?.title ?? url.hostname).slice(0,300),url:url.href})}catch{}
  }
  return {sources,citations:(metadata.groundingSupports ?? []).flatMap(support=>{
    const end=support.segment?.endIndex
    const mapped=(support.groundingChunkIndices ?? []).flatMap(index=>indices.has(index)?[indices.get(index)!]:[])
    return end!==undefined&&mapped.length ? [{endIndex:end,...(support.segment?.text ? {text:support.segment.text}:{}),sourceIndices:mapped}]:[]
  }),queries:(metadata.webSearchQueries ?? []).slice(0,30),searchSuggestions:metadata.searchEntryPoint?.renderedContent?.slice(0,100000) ?? null}
}
export function withWebCitations(text:string,research:WebResearch):string {
  // Gemini Segment offsets are UTF-8 byte offsets; JS string indices are UTF-16.
  const insertions=new Map<number,Set<number>>()
  const bytes=Buffer.from(text,'utf8')
  for(const citation of research.citations){
    if(citation.endIndex<0 || citation.endIndex>bytes.length)continue
    const prefix=bytes.subarray(0,citation.endIndex).toString('utf8')
    if(citation.text && !prefix.endsWith(citation.text))continue
    const position=prefix.length
    const indices=insertions.get(position) ?? new Set<number>()
    for(const i of citation.sourceIndices)if(research.sources[i])indices.add(i)
    insertions.set(position,indices)
  }
  let result=text
  for(const [position,indices] of [...insertions].sort((a,b)=>b[0]-a[0])){
    const links=[...indices].map(i=>`[${i+1}](${research.sources[i]!.url})`).join(' ')
    result=result.slice(0,position)+' '+links+result.slice(position)
  }
  return result
}
