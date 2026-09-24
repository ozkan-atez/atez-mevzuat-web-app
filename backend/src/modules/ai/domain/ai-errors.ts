export type AiErrorCategory =
  | 'AUTHENTICATION'
  | 'PERMISSION'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'CONTENT_REJECTED'
  | 'UNKNOWN_PROVIDER_ERROR'

export class AiProviderError extends Error {
  override readonly name = 'AiProviderError'

  constructor(
    readonly category: AiErrorCategory,
    readonly retryable: boolean,
    message: string,
    readonly providerStatus: number | null = null,
  ) {
    super(message)
  }
}

interface RetryOptions {
  maxAttempts: number
  sleep?: (milliseconds: number) => Promise<void>
  random?: () => number
}

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

export async function executeWithAiRetries<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep
  const random = options.random ?? Math.random
  let lastError: unknown

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!(error instanceof AiProviderError) || !error.retryable || attempt === options.maxAttempts) throw error
      const baseDelay = Math.min(10_000, 500 * 2 ** (attempt - 1))
      await sleep(baseDelay + Math.floor(random() * 250))
    }
  }

  throw lastError
}
