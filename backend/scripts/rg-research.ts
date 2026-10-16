import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse } from 'dotenv'
import { GoogleGenAI } from '@google/genai'
import { tariffCredentialsFromEnv } from '../src/modules/managed-sources/tariff-auth'
import { runDossierResearch } from '../src/modules/gazette-prototype/research-runner'
const option=(key:string)=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1]}
const input=option('--input');if(!input)throw new Error('--input ayrıntılı dossier JSON yolu gerekli')
const envFile=async(path:string)=>{try{return parse(await readFile(path))}catch{return {}}}
const env={...await envFile('.env'),...await envFile('../.env'),...process.env}
const credentials=tariffCredentialsFromEnv(env)
if(!credentials||!env.GEMINI_API_KEY)throw new Error('Tariff ve Gemini yapılandırması gerekli')
const dossier=JSON.parse(await readFile(resolve(input),'utf8'))
if(!Array.isArray(dossier.researchNeeds))throw new Error('Dossier researchNeeds içermiyor; yeniden çıkarım gerekli')
const directory=resolve(option('--output')??`${input}.research`)
const output=await runDossierResearch({publicationDate:dossier.publicationDate,currentUrl:dossier.entry.url,effectiveRules:dossier.effectiveRules,legalIdentifiers:dossier.amendedInstruments,tables:dossier.tables,researchNeeds:dossier.researchNeeds},
  {credentials,api:new GoogleGenAI({apiKey:env.GEMINI_API_KEY}),model:env.GEMINI_MODEL??'gemini-3.8-flash',directory,needId:option('--id')})
console.log(JSON.stringify({status:output.status,needs:output.results.map(r=>({id:r.id,status:r.status})),output:directory}))
