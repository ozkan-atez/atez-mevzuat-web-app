import { mkdir,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GoogleGenAI } from '@google/genai'
import type { TariffCredentials } from '../managed-sources/tariff-auth'
import { AuthenticatedTariffRetriever } from './tariff-retrieval'
import { GazetteFilter,GeminiOfficialResearcher,type OfficialResearcher } from './official-research'
import { PlaywrightCollector } from './playwright-collector'
import { executeResearch } from './execute-research'
import { buildResearchPlan } from './research-plan'
import { researchNeedSchema } from './tariff-catalog'

export async function runDossierResearch(dossier:Parameters<typeof buildResearchPlan>[1] & {researchNeeds:unknown[]},config:{credentials:TariffCredentials;api:GoogleGenAI;model:string;directory:string;needId?:string|undefined}) {
  const plans=buildResearchPlan(dossier.researchNeeds.map(n=>researchNeedSchema.parse(n)),dossier)
  const selected=plans.filter(p=>!config.needId||p.id===config.needId)
  if(!selected.length)throw new Error('Çalıştırılacak araştırma ihtiyacı yok')
  await mkdir(config.directory,{recursive:true})
  const tariff=new AuthenticatedTariffRetriever(config.credentials,join(config.directory,'tariff'))
  let filter:GazetteFilter|undefined,collector:PlaywrightCollector|undefined,researcher:GeminiOfficialResearcher|undefined
  const official:OfficialResearcher={research:async(plan,fields,gtips)=>{
    if(!researcher){filter=await GazetteFilter.create(join(config.directory,'search'));collector=await PlaywrightCollector.create(join(config.directory,'official'));researcher=new GeminiOfficialResearcher(filter,collector,config.api,config.model,join(config.directory,'official'))}
    return researcher.research(plan,fields,gtips)
  }}
  const results:Awaited<ReturnType<typeof executeResearch>>[]=[]
  try {
    for(const plan of selected){results.push(await executeResearch(plan,tariff,official));await writeFile(join(config.directory,'research.json'),JSON.stringify({schemaVersion:'1',results,status:'RUNNING'},null,2))}
    const output={schemaVersion:'1',results,status:results.every(r=>r.status==='FOUND')?'COMPLETED':'NEEDS_REVIEW'}
    await writeFile(join(config.directory,'research.json'),JSON.stringify(output,null,2))
    return output
  }finally{await filter?.close();await collector?.close()}
}
