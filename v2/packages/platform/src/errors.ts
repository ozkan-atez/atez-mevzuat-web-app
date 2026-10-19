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

const CONNECTION_CODES = new Set([
  // PostgreSQL: yönetici/çökme kaynaklı kapanma, bağlantı istisnaları, kapasite
  '57P01', '57P02', '57P03', '08000', '08001', '08003', '08004', '08006', '53300',
  // Node ağ hataları
  'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH',
])
const CONNECTION_MESSAGE = /connection terminated|connection (?:is )?closed|client has encountered a connection error|terminating connection|socket hang up|channel closed|connection closed/i

/**
 * Altyapı bağlantısı koptu mu (Postgres/RabbitMQ/ağ)? Bu hatalar işin kendisiyle ilgili değildir:
 * mesaj park edilmez, bekleyip yeniden denenir (cause zinciri de taranır).
 */
export function isConnectionError(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && CONNECTION_CODES.has(code)) return true
    if (e instanceof Error && CONNECTION_MESSAGE.test(e.message)) return true
    e = (e as { cause?: unknown }).cause
  }
  return false
}
