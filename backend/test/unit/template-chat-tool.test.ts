import { describe, expect, it, vi } from 'vitest'
import { runChatTool } from '../../src/modules/chat/application/chat-tools'
import type { AssistantKnowledge } from '../../src/modules/chat/application/assistant-knowledge'

describe('report template chat tool', () => {
  const knowledge = {} as AssistantKnowledge

  it('creates one editable draft only for an explicit template request', async () => {
    const createTemplate = vi.fn(async () => ({ id: 'template-1', name: 'Yönetici bülteni' }))
    await expect(runChatTool('rapor_sablonu_taslagi_olustur', { istek: 'Yönetici özeti ekle' }, knowledge, { createTemplate })).rejects.toThrow(/açıkça/)
    expect(createTemplate).not.toHaveBeenCalled()
    const result = await runChatTool('rapor_sablonu_taslagi_olustur', { istek: 'Yönetici özeti ekle', hazirDuzen: 'detailed' }, knowledge, { authorizedTemplate: true, createTemplate })
    expect(createTemplate).toHaveBeenCalledWith({ request: 'Yönetici özeti ekle', preset: 'detailed' })
    expect(result).toMatchObject({ templateId: 'template-1', url: '/templates?id=template-1', status: 'TASLAK' })
  })
})
