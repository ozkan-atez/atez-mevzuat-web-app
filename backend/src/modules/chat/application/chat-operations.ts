import { normalizeTurkish } from './resolve-date'
import type { OperationInput } from '../../operations/operation-service'

export interface ChatOperations {
  start(input: OperationInput, idempotencyKey: string): Promise<{ id: string; status: string; tasks: Array<{ id: string; operation: string; status: string }> }>
  get(id: string): Promise<unknown>
}

/** Only direct verbs authorize work; discussion, questions and document content never do. */
export function parseDocumentOperation(content: string, versionIds: string[], mode: OperationInput['mode'] = 'FILL_MISSING'): OperationInput | null {
  const text = normalizeTurkish(content)
  if (!versionIds.length || /\b(nasil|miyim|misin|mumkun|yapma|calistirma|baslatma|analiz etme)\b/.test(text)) return null
  if (/\banaliz\s+(?:et\w*|yap\w*|baslat\w*|calistir\w*)/.test(text) || /\b(?:incele|degerlendir)\b/.test(text)) return { operation: 'ANALYZE', mode, documentVersionIds: versionIds, instruction: content }
  if (/\b(?:metin\w*|icerig\w*)\s+(?:cikar\w*|oku\w*)/.test(text)) return { operation: 'EXTRACT', mode, documentVersionIds: versionIds }
  return null
}
