import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { TopicAnalysisChat } from './TopicAnalysisChat'

vi.mock('./api', () => ({
  getTopic: vi.fn().mockResolvedValue({ id: 'topic-1', thread: { id: 'thread-1', messages: [] } }),
  sendTopicMessage: vi.fn().mockResolvedValue({ messageId: 'message-1', status: 'QUEUED', revisionKind: 'ANALYSIS' }),
}))

describe('TopicAnalysisChat', () => {
  it('sends a revision inside the selected topic thread', async () => {
    render(<TopicAnalysisChat topicId="topic-1" />)
    await userEvent.type(await screen.findByRole('textbox'), 'Önceki ve yeni oranı daha açık karşılaştır.')
    await userEvent.click(screen.getByRole('button', { name: 'Gönder' }))
    expect(api.sendTopicMessage).toHaveBeenCalledWith('topic-1', 'Önceki ve yeni oranı daha açık karşılaştır.')
  })
})
