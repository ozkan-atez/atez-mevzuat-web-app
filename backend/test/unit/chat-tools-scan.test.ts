import { describe, expect, it, vi } from 'vitest'
import { CHAT_TOOLS, runChatTool } from '../../src/modules/chat/application/chat-tools'
import type { AssistantKnowledge } from '../../src/modules/chat/application/assistant-knowledge'

describe('chat scan tool', () => {
  const knowledge = {} as AssistantKnowledge

  it('is offered to the model and delegates to the manual scan creator', async () => {
    expect(CHAT_TOOLS.some((tool) => tool.name === 'tarama_baslat')).toBe(true)
    const scanStarter = { startScan: vi.fn().mockResolvedValue({ id: 'run-1', status: 'QUEUED', targetDate: '2026-07-28' }) }
    const result = await runChatTool('tarama_baslat', { tarih: '2026-07-28' }, knowledge, scanStarter, crypto.randomUUID())
    expect(result).toEqual({ runId: 'run-1', durum: 'QUEUED', tarih: '2026-07-28', url: '/runs/run-1' })
    expect(scanStarter.startScan).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid date without creating a run', async () => {
    const scanStarter = { startScan: vi.fn() }
    await expect(runChatTool('tarama_baslat', { tarih: '2026-02-31' }, knowledge, scanStarter, crypto.randomUUID()))
      .rejects.toThrow('Geçerli bir tarama tarihi')
    expect(scanStarter.startScan).not.toHaveBeenCalled()
  })
})
