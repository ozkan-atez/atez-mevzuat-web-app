import{readFile,writeFile,mkdir}from'node:fs/promises'
import{parse}from'dotenv'
import{getTariffAccessToken,tariffCredentialsFromEnv}from'../src/modules/managed-sources/tariff-auth'
import{parseTariffMeasures}from'../src/modules/tariff/tariff-lookup'
const readEnv=async(p:string)=>{try{return parse(await readFile(p))}catch{return{}}}
const env={...await readEnv('.env'),...await readEnv('../.env'),...process.env}
const credentials=tariffCredentialsFromEnv(env)
if(!credentials)throw new Error('Tariff bağlantısı yapılandırılmamış veya kapalı.')
const token=await getTariffAccessToken(credentials)
const out='../.local/rg-prototype/tariff-history-inspection';await mkdir(out,{recursive:true})
for(const date of ['2026-07-11','2026-08-09','2026-08-10']){
 const url='https://tariff.singlewindow.io/api/v2-0/tariff-query/tariff-measures-by-commodity?'+new URLSearchParams({commodityCode:'691090000000',countryCode:'TR',queryType:'import',queryDate:date})
 const response=await fetch(url,{headers:{Accept:'application/json',Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000),redirect:'error'})
 if(!response.ok){console.log(JSON.stringify({date,status:response.status}));continue}
 const data=await response.json() as any
 await writeFile(`${out}/${date}.raw.json`,JSON.stringify({url,fetchedAt:new Date().toISOString(),data},null,2))
 const parsed=parseTariffMeasures(data);await writeFile(`${out}/${date}.parsed.json`,JSON.stringify(parsed,null,2))
 console.log(JSON.stringify({date,topKeys:Object.keys(data),measures:data.measures?.length,measureKeys:Object.keys(data.measures?.[0]??{}),kinds:[...new Set(parsed.map(m=>`${m.typeCode}: ${m.typeName}`))],surveillance:parsed.filter(m=>/gözetim/i.test(m.typeName??''))}))
}
const response=await fetch('https://tariff.singlewindow.io/api/v1-0/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}),signal:AbortSignal.timeout(20000)})
console.log(JSON.stringify({mcpStatus:response.status}))
if(response.ok){const data=await response.json();await writeFile(`${out}/mcp-tools.json`,JSON.stringify(data,null,2));console.log(JSON.stringify(data))}
