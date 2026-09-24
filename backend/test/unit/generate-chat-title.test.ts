import { describe, expect, it, vi } from 'vitest'
import { generateChatTitle } from '../../src/modules/chat/application/generate-chat-title'
import type { ChatModelClient } from '../../src/modules/chat/application/chat-model-client'
import type { ChatRepository } from '../../src/modules/chat/application/ports'

describe('generateChatTitle', () => {
  it('summarizes the exchange and stores a cleaned title once', async () => {
    let title: string | null = null
    const repository = {
      getSessionTitle: vi.fn(async () => title),
      setTitleIfMatches: vi.fn(async (_id: string, expected: string | null, next: string) => { if (title === expected) title = next }),
    } as unknown as ChatRepository
    const model: ChatModelClient = {
      async *streamReply(request) {
        expect(request.tools).toBeUndefined()
        expect(request.systemInstruction).toContain('kısa ve ayırt edici')
        yield { type: 'text', text: '"Gümrük Tarifesi Sınıflandırması."' }
      },
    }
    const input = { sessionId: 's1', userMessage: 'GTİP nedir?', assistantMessage: 'GTİP gümrük tarife kodudur.', repository, model, modelName: 'gemini-test' }

    await generateChatTitle(input)
    await generateChatTitle(input)

    expect(title).toBe('Gümrük Tarifesi Sınıflandırması')
    expect(repository.setTitleIfMatches).toHaveBeenCalledOnce()
  })
})
