/** Freeze the engine on creation; historical retries retain their original implementation. */
export function newScanEngine(templateId?: string | null, studioSnapshot?: unknown): 'v2' | 'legacy' {
  return process.env.SCAN_ENGINE === 'v2' && (!templateId || !!studioSnapshot) ? 'v2' : 'legacy'
}
export function usesV2(config: unknown): boolean {
  return !!config && typeof config === 'object' && (config as {engine?:unknown}).engine === 'v2'
}
