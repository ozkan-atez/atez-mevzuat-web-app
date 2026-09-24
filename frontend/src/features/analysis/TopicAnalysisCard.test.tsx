import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TopicAnalysisCard } from './TopicAnalysisCard'

describe('TopicAnalysisCard', () => {
  it('shows retry only for a topic awaiting retry', () => {
    render(<TopicAnalysisCard topic={{ id: 'topic-1', documentId: 'doc-1', title: 'İthalat Tebliği', status: 'AWAITING_RETRY', retryAvailable: true, errorCategory: 'RATE_LIMITED', errorMessage: 'Gemini geçici olarak yoğun.', analysisVersion: null, reportVersion: null, reportCard: null, reportBasename: null }} onRetry={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Analizi tekrar dene' })).toBeInTheDocument()
    expect(screen.getByText('Gemini geçici olarak yoğun.')).toBeInTheDocument()
  })
})
