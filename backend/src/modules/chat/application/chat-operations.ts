import { normalizeTurkish } from './resolve-date'
import type { OperationInput } from '../../operations/operation-service'

export interface ChatOperations {
  start(input: OperationInput, idempotencyKey: string): Promise<{ id: string; status: string; tasks: Array<{ id: string; operation: string; status: string }> }>
  get(id: string): Promise<unknown>
}

/** A requested outcome authorizes its prerequisites; uploads alone do not. */
export function parseDocumentOperation(content: string, versionIds: string[], mode: OperationInput['mode'] = 'FILL_MISSING'): OperationInput | null {
  const text = normalizeTurkish(content)
  if (!versionIds.length || /\b(nasil|miyim|yapma|calistirma|baslatma|analiz etme|inceleme|incelemey\w*|okuma|okumay\w*|istemiyorum)\b/.test(text)) return null
  if (/\banaliz\s+(?:et\w*|yap\w*|baslat\w*|calistir\w*)/.test(text) || /\b(?:incele\w*|degerlendir\w*)\b/.test(text)) return { operation: 'ANALYZE', mode, documentVersionIds: versionIds, instruction: content }
  if (/\b(?:oku|okur|okuyabilir)\w*\b/.test(text)) return { operation: 'EXTRACT', mode, documentVersionIds: versionIds }
  if (/\b(?:metin\w*|icerig\w*)\s+(?:cikar\w*|oku\w*)/.test(text)) return { operation: 'EXTRACT', mode, documentVersionIds: versionIds }
  return null
}
