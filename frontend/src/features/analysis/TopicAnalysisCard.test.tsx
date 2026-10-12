import { render, screen } from '../../test/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { TopicAnalysisCard } from './TopicAnalysisCard'

describe('TopicAnalysisCard', () => {
  it('shows retry only for a topic awaiting retry', () => {
    render(<TopicAnalysisCard topic={{ id: 'topic-1', documentId: 'doc-1', title: 'İthalat Tebliği', status: 'AWAITING_RETRY', retryAvailable: true, errorCategory: 'RATE_LIMITED', errorMessage: 'Gemini geçici olarak yoğun.', analysisVersion: null, reportVersion: null, reportCard: null, reportBasename: null }} onRetry={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Analizi tekrar dene' })).toBeInTheDocument()
    expect(screen.getByText('Gemini geçici olarak yoğun.')).toBeInTheDocument()
  })
})

it('shows readable feedback for legacy raw validation errors', () => {
 render(<TopicAnalysisCard topic={{ id:'topic-1', documentId:'doc-1', title:'İthalat Tebliği', status:'BLOCKED', retryAvailable:false, errorCategory:'INVALID_RESPONSE', errorMessage:'[{"code":"custom","path":["tables"],"message":"Dolgu metni kullanılamaz"}]', analysisVersion:null, reportVersion:null, reportCard:null, reportBasename:null }} onRetry={vi.fn()} />)
 expect(screen.getByText('Analiz çıktısı içerik doğrulamasından geçmedi. Analizin yeniden hazırlanması gerekiyor.')).toBeInTheDocument()
 expect(screen.queryByText(/"code"/)).not.toBeInTheDocument()
})
