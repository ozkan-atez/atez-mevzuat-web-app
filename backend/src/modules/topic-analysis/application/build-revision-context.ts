import type { AiInputPart } from '../../ai/application/ai-model-client'

export function classifyRevisionKind(message: string): 'ANALYSIS' | 'PUBLICATION' {
  const analysisTerms = /(?:kaynak|kanıt|analiz|etkilenen|oran|tarih|hüküm|mevzuat|karşılaştır|önceki|yeni durum|gtip|gümrük|ithalat|ihracat)/i
  return analysisTerms.test(message) ? 'ANALYSIS' : 'PUBLICATION'
}

export function buildRevisionContext(input: {
  currentAnalysisJson: string
  currentAnalysisMarkdown: string
  request: string
  recentMessages: Array<{ role: 'USER' | 'ASSISTANT' | 'SYSTEM'; content: string }>
}): AiInputPart[] {
  return [
    { text: 'Mevcut kanonik analiz JSON:\n' + input.currentAnalysisJson },
    { text: 'Mevcut kapsamlı analiz kaydı:\n' + input.currentAnalysisMarkdown },
    { text: 'Son topic konuşması:\n' + input.recentMessages.slice(-5).map((message) => `${message.role}: ${message.content}`).join('\n') },
    { text: 'Kullanıcının revizyon talebi:\n' + input.request },
  ]
}
