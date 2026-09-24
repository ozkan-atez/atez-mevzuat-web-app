import type { AiInputPart } from '../../ai/application/ai-model-client'

/**
 * Every revision request starts on the patch path.
 *
 * Routing used to match keywords, which cannot tell "put only the dates on this
 * line" from "the date is wrong, check the source": both contain "tarih", and the
 * first — a pure wording change — was sent to the expensive analysis path and
 * failed there. The patch model sees the request together with the current field
 * values and answers NEEDS_ANALYSIS when the facts really have to move, so it is
 * the better judge; `executePromptPatch` escalates on that answer.
 *
 * `PUBLICATION` remains in the enum only for rows written before the patch path
 * existed.
 */
export function classifyRevisionKind(): 'DIRECT_EDIT' {
  return 'DIRECT_EDIT'
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
