import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {parse} from 'dotenv'
import {GoogleGenAI} from '@google/genai'
import {GeminiChatModelClient,type GeminiChatChunk} from '../src/modules/chat/infrastructure/gemini-chat-model-client'
const read=(path:string)=>{try{return parse(readFileSync(path))}catch{return {}}}
const config={...process.env,...read('.env'),...read('../.env')}
if(!config.GEMINI_API_KEY)throw new Error('Gemini key missing')
const api=new GoogleGenAI({apiKey:config.GEMINI_API_KEY})
const model=new GeminiChatModelClient({generateContentStream:async request=>api.models.generateContentStream(request as never) as unknown as Promise<AsyncIterable<GeminiChatChunk>>},{timeoutMs:60000})
const result:Record<string,unknown>={model:config.GEMINI_MODEL,checkedAt:new Date().toISOString(),answer:'',research:null}
try{for await(const chunk of model.streamReply({model:config.GEMINI_MODEL ?? 'gemini-3.8-flash',webSearch:true,systemInstruction:'Türkçe yanıtla, yalnızca resmî kaynakları kullan ve kaynak belirt.',turns:[{role:'user',content:'Ticaret Bakanlığı Gümrükler Genel Müdürlüğü resmî duyurular sayfasını bul. Sayfanın bağlantısını ve ne tür duyurular yayımladığını iki cümleyle açıkla.'}]})){if(chunk.type==='text')result.answer=String(result.answer)+chunk.text;else if(chunk.type==='grounding')result.research=chunk.research}}catch(error){result.error=error instanceof Error?error.message.slice(0,500):'Failed'}
mkdirSync(resolve('../docs/operations/browser-access-checks'),{recursive:true})
writeFileSync(resolve('../docs/operations/browser-access-checks/google-search.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({...result,research:result.research?{...(result.research as object),searchSuggestions:'[stored in result file]'}:null}))
