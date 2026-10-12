import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { chromium } from 'playwright'
import { GoogleGenAI, Environment, type Content } from '@google/genai'
import { safeSourceRequest } from '../src/modules/managed-sources/source-session'

const read=(path:string)=>{try{return parse(readFileSync(path))}catch{return {}}}
const config={...process.env,...read(resolve('.env')),...read(resolve('../.env'))}
const live=process.argv.includes('--gemini')
const out=resolve(config.SOURCE_TEST_OUTPUT ?? '../docs/operations/browser-access-checks')
mkdirSync(out,{recursive:true})
const db=config.LOCAL_DATABASE_URL ?? config.DATABASE_URL ?? 'postgresql://atez:atezpassword@127.0.0.1:5432/atez_db?schema=public'
const prisma=new PrismaClient({datasources:{db:{url:db}}})
const client=live&&config.GEMINI_API_KEY ? new GoogleGenAI({apiKey:config.GEMINI_API_KEY}):null
const model=config.GEMINI_BROWSER_MODEL ?? config.GEMINI_MODEL ?? 'gemini-3.8-flash'
const results:unknown[]=[]
const maxSteps=Math.min(8,Math.max(1,Number(config.SOURCE_TEST_MAX_STEPS ?? 3)))
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined
try{
  const sources:Array<{key:string;name:string|null;baseUrl:string;profiles:Array<{config:unknown}>}>=config.SOURCE_TEST_INPUT ? JSON.parse(readFileSync(config.SOURCE_TEST_INPUT,'utf8')) : await prisma.source.findMany({where:{isActive:true},include:{profiles:true}})
  writeFileSync(resolve(out,'sources.json'),JSON.stringify(sources.map(source=>({key:source.key,name:source.name,baseUrl:source.baseUrl,profiles:source.profiles.map((p:any)=>({config:p.config}))})),null,2))
  browser=await chromium.launch({headless:true})
  console.log(JSON.stringify({environment:process.platform,model,liveGemini:Boolean(client),chromium:true}))
  for(const source of sources.filter(source=>!config.SOURCE_TEST_FILTER || config.SOURCE_TEST_FILTER.split(',').includes(source.key))){
    const profile=source.profiles[0]?.config as {allowedHosts?:string[];feeds?:Array<{url:string}>;auth?:{mode:string}}|undefined
    const url=profile?.feeds?.[0]?.url ?? source.baseUrl
    const allowedHosts=profile?.allowedHosts ?? [new URL(url).hostname,'www.resmigazete.gov.tr','resmigazete.gov.tr']
    const result:Record<string,unknown>={key:source.key,name:source.name,url,authMode:profile?.auth?.mode ?? 'NONE',checkedAt:new Date().toISOString(),http:null,browser:null,agent:null}
    try{const response=await safeSourceRequest(url,allowedHosts);result.http={status:response.status,bytes:response.body.length}}catch(error){result.http={error:error instanceof Error?error.message:'Failed'}}
    const blockedHosts=new Set<string>()
    const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',acceptDownloads:false})
    await context.route('**/*',async route=>{
      if(route.request().method()!=='GET'){await route.abort();return}
      try{
        const response=await safeSourceRequest(route.request().url(),allowedHosts,{headers:await route.request().allHeaders(),follow:false,maxBytes:8_000_000})
        for(const key of ['transfer-encoding','content-encoding','content-length'])delete response.headers[key]
        await route.fulfill({status:response.status,headers:response.headers,body:response.body})
      }catch{try{blockedHosts.add(new URL(route.request().url()).hostname)}catch{}await route.abort()}
    })
    const page=await context.newPage()
    let navigationStatus:number|null=null
    page.on('response',response=>{if(response.request().isNavigationRequest()&&response.frame()===page.mainFrame())navigationStatus=response.status()})
    try{
      const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000})
      await page.waitForFunction(()=>document.body?.innerText.trim().length>100,{},{timeout:10000}).catch(()=>undefined)
      const text=await page.locator('body').innerText({timeout:5000})
      result.browser={status:response?.status(),url:page.url(),title:await page.title(),textCharacters:text.length,blockedHosts:[...blockedHosts],links:await page.locator('a[href]').count(),sample:text.slice(0,350)}
      await page.screenshot({path:resolve(out,`${source.key}.png`)})
      if(client && response?.ok() && text.length>100){
        const contents:Content[]=[{role:'user',parts:[{text:`Test public read-only browser access. Current URL: ${page.url()}. Find and open one legislation/news detail link on this page, then report its title. Do not log in, type, submit forms, accept agreements, solve CAPTCHAs or download files. If login/subscription is required, stop and report it.`}]}]
        const actions:unknown[]=[]
        for(let step=0;step<maxSteps;step++){
          const screenshot=await page.screenshot()
          if(step===0)contents[0]!.parts!.push({inlineData:{mimeType:'image/png',data:screenshot.toString('base64')}})
          const reply=await client.models.generateContent({model,contents,config:{httpOptions:{timeout:45000},tools:[{computerUse:{environment:Environment.ENVIRONMENT_BROWSER}}]}})
          const candidate=reply.candidates?.[0]?.content
          if(!candidate)throw new Error('Agent returned no candidate')
          contents.push(candidate)
          const calls=(candidate.parts ?? []).flatMap(part=>part.functionCall ? [part.functionCall]:[])
          if(!calls.length){result.agent={model,actions,answer:reply.text?.slice(0,1200),finalUrl:page.url()};break}
          const responses:NonNullable<Content['parts']>=[]
          for(const call of calls){
            const args=call.args ?? {};const safety=args.safety_decision ?? args.safetyDecision
            if(safety && typeof safety==='object' && 'decision' in safety && !['allowed','regular'].includes(String(safety.decision)))throw new Error('Agent action requires confirmation or is blocked')
            const name=call.name ?? '';actions.push({name,args})
            const x=Number(args.x)*1280/1000,y=Number(args.y)*900/1000
            if(['navigate','navigate_to'].includes(name)){const target=String(args.url);if(!allowedHosts.includes(new URL(target).hostname))throw new Error('Agent navigation outside source profile');await page.goto(target,{waitUntil:'domcontentloaded',timeout:20000})}
            else if(['click','click_at'].includes(name)){
              // Only link navigation is allowed in this read-only probe.
              const target=await page.evaluate(({x,y})=>{
                const element=document.elementFromPoint(x,y)
                return {href:element?.closest('a')?.getAttribute('href'),dismiss:Boolean(element?.closest('[data-dismiss="modal"],[data-bs-dismiss="modal"],.modal .close,.modal-close'))}
              },{x,y})
              if(target.dismiss)await page.mouse.click(x,y)
              else {
                if(!target.href)throw new Error('Agent click is neither a link nor a modal close; stopped by read-only test')
                const next=new URL(target.href,page.url());if(!allowedHosts.includes(next.hostname))throw new Error('Agent link outside source profile');await page.goto(next.href,{waitUntil:'domcontentloaded',timeout:20000})
              }
            } else if(['wait','wait_5_seconds'].includes(name))await page.waitForTimeout(Math.min(5000,Math.max(0,Number(args.seconds ?? 5)*1000)))
            else if(['scroll','scroll_document'].includes(name))await page.mouse.wheel(0,args.direction==='up'?-600:600)
            else throw new Error(`Unsupported read-only test action: ${name}`)
            const image=await page.screenshot()
            responses.push({functionResponse:{name,...(call.id?{id:call.id}:{}),response:{url:page.url()},parts:[{inlineData:{mimeType:'image/png',data:image.toString('base64')}}]}} as never)
          }
          contents.push({role:'user',parts:responses})
          result.agent={model,actions,finalUrl:page.url(),detailOpened:page.url()!==url}
        }
      }
    }catch(error){result.agent={...(result.agent as object ?? {}),error:error instanceof Error?error.message.slice(0,400):'Failed'};if(!result.browser)result.browser={error:error instanceof Error?error.message.slice(0,400):'Failed'}}
    finally{
      if(result.agent && typeof result.agent==='object')Object.assign(result.agent,{finalStatus:navigationStatus,finalUrl:page.url(),finalTitle:await page.title().catch(()=>''),finalTextCharacters:await page.locator('body').innerText({timeout:3000}).then(text=>text.length).catch(()=>0)})
      await context.close()
    }
    results.push(result);writeFileSync(resolve(out,'results.json'),JSON.stringify({checkedAt:new Date().toISOString(),environment:process.platform,model,results},null,2));console.log(JSON.stringify(result))
  }
}finally{await browser?.close();await prisma.$disconnect()}
