import {describe,it,expect,vi} from 'vitest'
import {gatherReportEvidence,wantsChatReport} from '../../src/modules/chat/application/create-chat-report'
import {sendChatMessage} from '../../src/modules/chat/application/send-chat-message'
import type {AssistantKnowledge} from '../../src/modules/chat/application/assistant-knowledge'
import type {ChatMessageView,ChatRepository} from '../../src/modules/chat/application/ports'
const evidence={id:'e1',title:'Duyuru',url:'https://www.igmd.org.tr/doc',text:'Gerçek kaynak metni.',publishedOn:'2026-10-08'}
const history:ChatMessageView[]=[{id:'old',role:'ASSISTANT',status:'COMPLETED',content:'Özet',context:{evidence:[evidence]},createdAt:'2026-10-14',errorDetail:null}]
describe('chat report creation',()=>{
  it.each(['rapor oluştur','rapor oluşturu musun','HTML rapor hazırlar mısın','bunu rapora dönüştür','raporlara ekle','bunu raporlaştır'])('recognizes actionable report request %s',text=>expect(wantsChatReport(text)).toBe(true))
  it.each(['rapor oluşturma','rapor nasıl oluşturulur','rapor oluşturmak için ne gerekli','sadece sohbet içinde rapor hazırla','raporları listele','rapor oluşturmanı istemiyorum'])('does not create for %s',text=>expect(wantsChatReport(text)).toBe(false))
  it('extracts an unreadable attachment as a report prerequisite without confirmation',async()=>{
    const getArchiveDocumentVersion=vi.fn().mockResolvedValueOnce({text:null,extractionStatus:'OCR_REQUIRED'}).mockResolvedValueOnce({...evidence,sourceUrl:evidence.url})
    const prepareDocument=vi.fn(async()=>{})
    const result=await gatherReportEvidence({content:'rapor oluştur',documentVersionIds:['v'],prepareDocument},[],{getArchiveDocumentVersion} as unknown as AssistantKnowledge)
    expect(prepareDocument).toHaveBeenCalledWith('v');expect(result.evidence[0]?.text).toBe(evidence.text)
  })
  it('stops if OCR cannot read the attachment',async()=>{
    const getArchiveDocumentVersion=vi.fn(async()=>({text:null}))
    await expect(gatherReportEvidence({content:'rapor oluştur',documentVersionIds:['v'],prepareDocument:vi.fn(async()=>{})},[],{getArchiveDocumentVersion} as unknown as AssistantKnowledge)).rejects.toThrow('rapor oluşturulmadı')
  })
  it('uses stored evidence for followup, never the model summary',async()=>expect(await gatherReportEvidence({content:'rapor oluştur'},history,{} as AssistantKnowledge)).toMatchObject({evidence:[evidence]}))
  it('does not mix old evidence into an explicit new selection',async()=>{
    const knowledge={scrapeChatSource:vi.fn(async()=>({documents:[{...evidence,title:'Yeni',url:'https://ticaret.gov.tr/new'}],warnings:['Kısmi kapsam']}))} as unknown as AssistantKnowledge
    const result=await gatherReportEvidence({content:'rapor oluştur',sourceIds:['new']},history,knowledge)
    expect(result.evidence).toHaveLength(1);expect(result.evidence[0]?.title).toBe('Yeni');expect(result.warnings).toEqual(['Kısmi kapsam'])
  })
  it('rereads legacy citation URLs and rejects unavailable evidence',async()=>{
    const {context:unused,...legacy}=history[0]!
    const old=[{...legacy,content:'[Kaynak](https://www.igmd.org.tr/doc)'}]
    const readChatUrl=vi.fn(async()=>evidence)
    expect((await gatherReportEvidence({content:'rapor oluştur'},old,{readChatUrl} as unknown as AssistantKnowledge)).evidence).toEqual([evidence])
    expect(readChatUrl).toHaveBeenCalledWith(evidence.url)
    await expect(gatherReportEvidence({content:'rapor oluştur'},[],{} as AssistantKnowledge)).rejects.toThrow('kaynak veya belge')
  })
  it('creates and links a saved HTML report without asking the chat model for prose',async()=>{
    const messages=[...history]
    const repository={getMessages:async()=>messages,appendMessage:vi.fn(async(input)=>{const view={...input,id:`m${messages.length}`,createdAt:'2026-10-14',errorDetail:null};messages.push(view);return view})} as unknown as ChatRepository
    const create=vi.fn(async()=>({reportId:'r1',title:'Rapor',url:'/reports/documents/r1',operationRequestId:'op1'}))
    const streamReply=vi.fn()
    const events=[]
    for await(const event of sendChatMessage({sessionId:'s',content:'rapor oluşturu musun',templateId:'t'}, {repository,model:{streamReply},modelName:'test',knowledge:{} as AssistantKnowledge,reportCreator:{create}}))events.push(event)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({templateId:'t',evidence:[evidence]}));expect(streamReply).not.toHaveBeenCalled()
    expect(messages.at(-1)?.content).toContain('[Raporu aç](/reports/documents/r1)');expect(events.at(-1)?.type).toBe('complete')
  })
})
