import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { AssistantKnowledge } from '../../src/modules/chat/application/assistant-knowledge'
import { PrismaAssistantKnowledge } from '../../src/modules/chat/infrastructure/prisma-assistant-knowledge'
import { CHAT_TOOLS, runChatTool } from '../../src/modules/chat/application/chat-tools'

describe('managed sources for sidebar chat', () => {
  it('declares read-only source search and detail tools and safely supports old knowledge mocks', async () => {
    expect(CHAT_TOOLS.map(tool => tool.name)).toContain('eklenen_kaynaklari_ara')
    expect(await runChatTool('eklenen_kaynaklari_ara', {}, {} as AssistantKnowledge)).toEqual({ kaynaklar: [] })
    expect(await runChatTool('eklenen_kaynagi_getir', { kaynakId: 's1' }, {} as AssistantKnowledge)).toHaveProperty('bulunamadi')
  })
  it('bounds tool search limits and uses only stored source identifiers', async () => {
    const searchManagedSources = vi.fn().mockResolvedValue([])
    const getManagedSource = vi.fn().mockResolvedValue(null)
    const knowledge = { searchManagedSources, getManagedSource } as unknown as AssistantKnowledge
    await runChatTool('eklenen_kaynaklari_ara', { sorgu: '  gümrük  ', limit: 10000 }, knowledge)
    expect(searchManagedSources).toHaveBeenCalledWith({ query: 'gümrük', limit: 20 })
    await runChatTool('eklenen_kaynagi_getir', { kaynakId: 's1' }, knowledge)
    expect(getManagedSource).toHaveBeenCalledWith({ id: 's1' })
  })
  it('filters out disabled sources and references withheld from chat, and limits text to 20,000 characters', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 's1', title: 'Kaynak', url: 'https://example.com', description: null, fetchedAt: new Date('2026-10-05'), contentText: 'x'.repeat(30000) })
    const knowledge = new PrismaAssistantKnowledge({ managedSource: { findFirst } } as unknown as PrismaClient, { getContent: vi.fn() })
    const source = await knowledge.getManagedSource({ id: 's1' })
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 's1', isActive: true, useInChat: true } })
    expect(source?.text).toHaveLength(20000)
    expect(source?.url).toBe('https://example.com')
  })
  it('returns metadata and applies trusted source priority without exposing full stored text in search', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 's1', title: 'Gümrük', url: 'https://example.com', description: null, contentText: 'long evidence', fetchedAt: null }])
    const knowledge = new PrismaAssistantKnowledge({ managedSource: { findMany }, sourceEndpoint: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as PrismaClient, { getContent: vi.fn() })
    const found = await knowledge.searchManagedSources({ query: 'gümrük', limit: 10 })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ isActive: true, useInChat: true }), take: 100 }))
    expect(found[0]).toMatchObject({ id: 's1', readable: true })
    expect(found[0]).not.toHaveProperty('contentText')
  })
})
