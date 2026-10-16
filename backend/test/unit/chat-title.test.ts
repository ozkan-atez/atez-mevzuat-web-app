import {describe,it,expect,vi} from 'vitest'
import {cleanChatTitle,generateChatTitle} from '../../src/modules/chat/application/generate-chat-title'
const input={sessionId:'s',messageId:'m'}
const fixture=()=>({repository:{getTitleSeed:vi.fn(async()=>"ticaret.gov.tr kaynkalarından 13 EKim'e ait değişiklik var mı varsa getir"),setGeneratedTitle:vi.fn()},model:{streamReply:vi.fn(async function*(){yield {type:'text',text:'13 Ekim Ticaret Bakanlığı duyuruları'} as const})},modelName:'test'})
describe('AI conversation title',()=>{
 it('uses the first message without tools and stores only the short title',async()=>{
  const f=fixture();await generateChatTitle(input,f as any)
  expect(f.repository.setGeneratedTitle).toHaveBeenCalledWith('s','13 Ekim Ticaret Bakanlığı duyuruları')
  expect(f.model.streamReply).toHaveBeenCalledWith(expect.objectContaining({model:'test',turns:[{role:'user',content:expect.stringContaining('13 EKim')}]}))
  expect((f.model.streamReply.mock.calls as any)[0][0].tools).toBeUndefined()
 })
 it('does not generate another title for a named conversation',async()=>{
  const f=fixture();f.repository.getTitleSeed.mockResolvedValue(null as any)
  await generateChatTitle(input,f as any)
  expect(f.model.streamReply).not.toHaveBeenCalled();expect(f.repository.setGeneratedTitle).not.toHaveBeenCalled()
 })
 it('falls back without throwing when the provider fails',async()=>{
  const f=fixture();f.model.streamReply.mockImplementation(async function*(){throw new Error('Unavailable')})
  await expect(generateChatTitle(input,f as any)).resolves.toBeUndefined()
  expect(f.repository.setGeneratedTitle).toHaveBeenCalledWith('s','Mevzuat sohbeti')
 })
 it.each(['**Başlık**','[Başlık](https://example.com)','<script>','Bir başlık\nBir açıklama','a'.repeat(73)])('rejects invalid output %s',value=>expect(cleanChatTitle(value)).toBeNull())
 it('strips wrapping quotes',()=>expect(cleanChatTitle('“13 Ekim duyuruları”')).toBe('13 Ekim duyuruları'))
})
