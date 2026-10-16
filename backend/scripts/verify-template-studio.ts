import { config } from 'dotenv'
config({path:'.env',quiet:true}); config({path:'../.env',quiet:true})
import { GoogleGenAI } from '@google/genai'
import { GeminiAiModelClient } from '../src/modules/ai/infrastructure/gemini-ai-model-client'
import { defaultTemplateDefinition } from '../src/modules/workspace/template-definition'
import { generateTemplateReport,suggestTemplate } from '../src/modules/workspace/template-ai'
import { renderTemplateReport } from '../src/modules/workspace/template-renderer'

const env={gemini:{apiKey:process.env.GEMINI_API_KEY,model:process.env.GEMINI_MODEL ?? 'gemini-3.7-flash',timeoutMs:Number(process.env.GEMINI_TIMEOUT_MS ?? 60000)}}
if(!env.gemini.apiKey)throw new Error('AI smoke test requires a configured provider.')
const sdk=new GoogleGenAI({apiKey:env.gemini.apiKey})
const model=new GeminiAiModelClient({generateContent:async request=>{
 const response=await sdk.models.generateContent(request)
 return {...(response.text?{text:response.text}:{}),...(response.responseId?{responseId:response.responseId}:{}),...(response.usageMetadata?{usageMetadata:response.usageMetadata}:{})}
}},{timeoutMs:env.gemini.timeoutMs})
const definition=defaultTemplateDefinition()
const component=await suggestTemplate(model,env.gemini.model,definition,'COMPONENT','Önceki oran, yeni oran ve fark için üç metin alanından oluşan bir karşılaştırma kartı oluştur. Bu yalnızca yazılım testidir.')
console.log(JSON.stringify({componentCreated:component.definition.components.length===definition.components.length+1,usage:component.usage}))
const report=await generateTemplateReport({definition,revision:1,sources:[{id:'test-evidence',label:'Yazılım testi için kurgu kaynak; gerçek mevzuat değildir',url:null,excerpt:'Bu metin yalnız yazılım testi içindir. Kurgu kurum, örnek bildirim ekranını 20 Ekim 2026 tarihinde açacaktır. Örnek operasyon ekibi bu ekrandan bildirim yapacaktır. Metinde GTİP veya vergi oranı yer almaz.'}],evidence:{note:'Yalnızca kurgu test verisi. Gerçek mevzuat veya hukuki yönlendirme değildir.'},model,modelName:env.gemini.model,allowBlocked:true})
const html=renderTemplateReport(report.report,{title:'Kurgu test raporu',reportId:'TEST',date:'13 Ekim 2026'})
console.log(JSON.stringify({sections:report.report.content.sections.map(s=>({id:s.requirementId,status:s.status,component:s.componentId})),htmlProduced:html.includes('Yönetici özeti'),instructionsNotPrinted:!html.includes(definition.requirements[0]!.instruction),usage:report.usage}))
