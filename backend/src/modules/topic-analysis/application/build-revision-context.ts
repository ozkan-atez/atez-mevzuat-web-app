import type { AiInputPart } from '../../ai/application/ai-model-client'

/**
 * Routes a revision request to the path that can honour it.
 *
 * `DIRECT_EDIT` supersedes the old `PUBLICATION` route: both cover "the facts
 * stand, the wording changes", but the patch path edits named fields instead of
 * regenerating the whole spec, so untouched fields cannot drift. `PUBLICATION`
 * remains in the enum for rows written before this change.
 */
export function classifyRevisionKind(message: string): 'ANALYSIS' | 'DIRECT_EDIT' {
  const analysisTerms = /(?:kaynak|kanıt|analiz|etkilenen|oran|tarih|hüküm|mevzuat|karşılaştır|önceki|yeni durum|gtip|gümrük|ithalat|ihracat)/i
  return analysisTerms.test(message) ? 'ANALYSIS' : 'DIRECT_EDIT'
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
