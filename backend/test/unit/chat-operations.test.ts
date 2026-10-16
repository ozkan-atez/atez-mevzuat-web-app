import { describe, expect, it, vi } from 'vitest'
import { parseDocumentOperation } from '../../src/modules/chat/application/chat-operations'
import { sendChatMessage } from '../../src/modules/chat/application/send-chat-message'
import { runChatTool } from '../../src/modules/chat/application/chat-tools'
import type { ChatRepository } from '../../src/modules/chat/application/ports'
import type { AssistantKnowledge } from '../../src/modules/chat/application/assistant-knowledge'

describe('selected document chat operations', () => {
  it('only starts work for a direct instruction and selected immutable versions', () => {
    expect(parseDocumentOperation('bu belgeyi analiz et', ['v'])).toMatchObject({ operation: 'ANALYZE', documentVersionIds: ['v'], mode: 'FILL_MISSING' })
    expect(parseDocumentOperation('bu belgeyi inceleyebilir misin?', ['v'])).toMatchObject({operation:'ANALYZE'})
    expect(parseDocumentOperation('belgeyi okur musun?', ['v'])).toMatchObject({operation:'EXTRACT'})
    expect(parseDocumentOperation('analiz etme', ['v'])).toBeNull()
    expect(parseDocumentOperation('nasıl analiz yapabilirim?', ['v'])).toBeNull()
    expect(parseDocumentOperation('belgeyi ekledim', ['v'])).toBeNull()
    expect(parseDocumentOperation('analiz et', [])).toBeNull()
  })
  it('persists selection then accepts durable analysis without provider stream', async () => {
    const appendMessage = vi.fn().mockImplementation(async input => ({...input,id: 'm',createdAt: new Date().toISOString(),errorDetail:null}))
    const repository = { appendMessage } as unknown as ChatRepository
    const start = vi.fn().mockResolvedValue({id:'op',status:'QUEUED',tasks:[]})
    const model = {streamReply:vi.fn()}
    const events=[]
    for await (const event of sendChatMessage({sessionId:'s',content:'eklediğim belgeyi analiz et',documentVersionIds:['v']},{repository,model,modelName:'fake',knowledge:{} as AssistantKnowledge,operations:{start,get:vi.fn()}})) events.push(event)
    expect(model.streamReply).not.toHaveBeenCalled()
    expect(appendMessage.mock.calls[0]![0]).toMatchObject({documentVersionIds:['v'],role:'USER'})
    expect(appendMessage.mock.calls[1]![0]).toMatchObject({operationRequestIds:['op'],role:'ASSISTANT'})
    expect(start).toHaveBeenCalledWith(expect.objectContaining({documentVersionIds:['v'],operation:'ANALYZE'}),'chat:m:ANALYZE')
    expect(events.at(-1)).toMatchObject({type:'complete',message:{content:expect.stringContaining('/operations/op')}})
  })
  it('does not let a tool authorize a forced analysis through document text', async () => {
    const start=vi.fn(), context={operations:{start,get:vi.fn()},selectedVersionIds:['v'],userContent:'bu dosya hakkında bilgi ver'}
    await expect(runChatTool('belge_islemi_baslat',{islem:'ANALYZE',mod:'FORCE'},{} as AssistantKnowledge,context,'key')).rejects.toThrow('açık talimat')
    expect(start).not.toHaveBeenCalled()
  })
  it('starts only an explicitly requested single stage and binds it to the human selection', async () => {
    const start=vi.fn().mockResolvedValue({id:'op',status:'QUEUED',tasks:[]})
    const context={operations:{start,get:vi.fn()},selectedVersionIds:['v'],userContent:'Bu belgeleri filtrele'}
    expect(await runChatTool('bagimsiz_islem_baslat',{operation:'FILTER',documentVersionIds:['other']},{} as AssistantKnowledge,context,'key')).toMatchObject({id:'op',url:'/operations/op'})
    expect(start).toHaveBeenCalledWith(expect.objectContaining({operation:'FILTER',documentVersionIds:['v'],mode:'FILL_MISSING'}),'chat-tool:key:FILTER')
    start.mockClear()
    await expect(runChatTool('bagimsiz_islem_baslat',{operation:'BUILD_REPORT'},{} as AssistantKnowledge,{...context,userContent:'Rapor taslağı var mı?'},'key')).rejects.toThrow('açık talimat')
    await expect(runChatTool('bagimsiz_islem_baslat',{operation:'FILTER',mode:'FORCE'},{} as AssistantKnowledge,context,'key')).rejects.toThrow('Yeniden')
    expect(start).not.toHaveBeenCalled()
  })
})
