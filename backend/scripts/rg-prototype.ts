import { PrismaClient } from '@prisma/client'
import { PrismaUsageRecorder } from '../src/modules/usage/prisma-usage-recorder'
import { workerServiceActor } from '../src/platform/worker-actor'
import { runWithActorContext } from '../src/platform/actor-context'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { parse } from 'dotenv'
import { GoogleGenAI } from '@google/genai'
import { DateTime } from 'luxon'
import { requestSchema } from '../src/modules/gazette-prototype/contracts'
import { PlaywrightCollector } from '../src/modules/gazette-prototype/playwright-collector'
import { GeminiAnalyst } from '../src/modules/gazette-prototype/gemini-analyst'
import { runGazette } from '../src/modules/gazette-prototype/run'
import { IncrementalSession } from '../src/modules/gazette-prototype/incremental'

const option=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]}
const readEnv=async(path:string)=>{try{return parse(await readFile(path))}catch{return {}}}
// Root project configuration is authoritative; process overrides remain available.
const env={...await readEnv('.env'),...await readEnv('../.env'),...process.env}
if(!env.GEMINI_API_KEY)throw new Error('GEMINI_API_KEY yapılandırılmamış.')
const date=option('--date');if(!date||!DateTime.fromISO(date).isValid)throw new Error('--date YYYY-MM-DD gerekli.')
const expected=option('--expected-links')
const request=requestSchema.parse({date,...(expected?{expectedMainLinks:Number(expected)}:{})})
const out=resolve(option('--output')??`../.local/rg-prototype/${date}-${Date.now()}`)
await mkdir(out,{recursive:true})
// Never overwrite a prior attempt.
await writeFile(join(out,'request.json'),JSON.stringify(request,null,2),{flag:'wx'})
const model=option('--model')??env.GEMINI_MODEL??'gemini-3.8-flash'
const memory=await IncrementalSession.open(resolve(option('--cache')??`../.local/rg-prototype/cache/${date}`),date,`${model}:atez-scope-v1:multimodal-v2:tariff-research-v1`)
const usageDatabaseUrl=env.LOCAL_DATABASE_URL??env.DATABASE_URL
if(!usageDatabaseUrl)throw new Error('Token takibi için veritabanı bağlantısı gerekli.')
const usageDb=new PrismaClient({datasources:{db:{url:usageDatabaseUrl}}})
let collector:PlaywrightCollector|undefined
try{
  const seedFrom=option('--seed-from')
  if(seedFrom){
    const seed=JSON.parse(await readFile(join(seedFrom,'result.json'),'utf8'))
    const config=JSON.parse(await readFile(join(seedFrom,`${seed.regulations[0]?.entry.id}.input.json`),'utf8'))
    if(config.model!==model)throw new Error('Aktarılan analizlerin modeli farklı; --seed-from kullanmadan çalıştırın.')
    await memory.seed(seed,async id=>JSON.parse(await readFile(join(seedFrom,`${id}.bundle.json`),'utf8')))
  }
  collector=await PlaywrightCollector.create(join(out,'sources'))
  const analyst=new GeminiAnalyst(new GoogleGenAI({apiKey:env.GEMINI_API_KEY}),model,out,option('--reuse-analysis-from'),new PrismaUsageRecorder(usageDb))
  const result=await runWithActorContext(await workerServiceActor(usageDb),()=>runGazette(request,memory.collector(collector!),memory.analyst(analyst),async(name,value)=>{await writeFile(join(out,name),JSON.stringify(value,null,2))},message=>console.log(message)))
  const activity=await memory.finish(result)
  await writeFile(join(out,'activity.json'),JSON.stringify(activity,null,2))
  console.log(JSON.stringify({output:join(out,'result.json'),model,status:result.status,counts:result.counts,activity,errors:result.errors}))
  if(result.status!=='COMPLETED')process.exitCode=2
}finally{try{await collector?.close()}finally{await memory.close();await usageDb.$disconnect()}}
