/** Geçici hata: retry kuyruğuna gider (TTL + DLX). */
export class TransientError extends Error {
  override name = 'TransientError'
  constructor(message: string, readonly code = 'TRANSIENT', options?: { cause?: unknown }) {
    super(message, options)
  }
}

/** Kalıcı hata: yeniden denenmez; öğe FAILED olur, run durmaz. */
export class PermanentError extends Error {
  override name = 'PermanentError'
  constructor(message: string, readonly code = 'PERMANENT', options?: { cause?: unknown }) {
    super(message, options)
  }
}

export function errorInfo(err: unknown): { name: string; code: string; message: string } {
  if (err instanceof TransientError || err instanceof PermanentError) return { name: err.name, code: err.code, message: err.message }
  if (err instanceof Error) return { name: err.name, code: 'UNKNOWN', message: err.message }
  return { name: 'Unknown', code: 'UNKNOWN', message: String(err) }
}
