import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { DownloadedFile, OfficialHttp } from '../application/ports'
import type { SourcePolicy } from '../domain/source-policy'
import { detectAndValidate } from './file-validator'

interface Options {
  delayMs: number
  timeoutMs: number
  maxAttempts: number
  maxFileBytes: number
}

interface Dependencies {
  fetch?: typeof fetch
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
  random?: () => number
}

const retryableStatuses = new Set([429, 500, 502, 503, 504])

export class OfficialHttpClient implements OfficialHttp {
  private readonly fetchFn: typeof fetch
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly now: () => number
  private readonly random: () => number
  private lastRequestAt = 0

  constructor(
    private readonly policy: SourcePolicy,
    private readonly options: Options,
    dependencies: Dependencies = {},
  ) {
    this.fetchFn = dependencies.fetch ?? fetch
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.now = dependencies.now ?? Date.now
    this.random = dependencies.random ?? Math.random
  }

  async download(sourceUrl: string, tempDirectory: string): Promise<DownloadedFile> {
    const initial = this.policy.assertAllowedUrl(sourceUrl)
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        const response = await this.requestFollowingOfficialRedirects(initial)
        if (!response.ok) {
          const error = new Error(`Official source returned HTTP ${response.status}`)
          if (!retryableStatuses.has(response.status) || attempt === this.options.maxAttempts) throw error
          lastError = error
          await this.backoff(attempt)
          continue
        }
        return await this.persistResponse(response, sourceUrl, tempDirectory)
      } catch (error) {
        if (error instanceof Error && !lastError) lastError = error
        throw error
      }
    }

    throw lastError ?? new Error('Official download failed')
  }

  private async requestFollowingOfficialRedirects(initial: URL): Promise<Response> {
    let current = initial
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      await this.throttle()
      const response = await this.fetchFn(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(this.options.timeoutMs),
        headers: {
          'User-Agent': 'ATEZ-Mevzuat-Radari/1.0 (+official-document-archiver)',
          Accept: 'text/html,application/pdf,image/*;q=0.9,*/*;q=0.1',
        },
      })
      this.lastRequestAt = this.now()

      if (response.status < 300 || response.status >= 400) return response
      const location = response.headers.get('location')
      if (!location) throw new Error('Official redirect has no Location header')
      current = this.policy.assertAllowedUrl(new URL(location, current).toString())
    }
    throw new Error('Official source exceeded redirect limit')
  }

  private async throttle(): Promise<void> {
    if (this.lastRequestAt === 0) return
    const remaining = this.options.delayMs - (this.now() - this.lastRequestAt)
    if (remaining > 0) await this.sleep(remaining)
  }

  private async backoff(attempt: number): Promise<void> {
    const milliseconds = Math.min(4_000, 500 * 2 ** (attempt - 1)) + Math.floor(this.random() * 250)
    await this.sleep(milliseconds)
  }

  private async persistResponse(response: Response, sourceUrl: string, tempDirectory: string): Promise<DownloadedFile> {
    if (!response.body) throw new Error('Official source returned an empty body')
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > this.options.maxFileBytes) throw new Error('Downloaded file exceeds the configured byte limit')

    const tempPath = join(tempDirectory, `${randomUUID()}.download`)
    const hash = createHash('sha256')
    let byteSize = 0
    const counter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        byteSize += chunk.length
        if (byteSize > this.options.maxFileBytes) {
          callback(new Error('Downloaded file exceeds the configured byte limit'))
          return
        }
        hash.update(chunk)
        callback(null, chunk)
      },
    })

    try {
      await pipeline(Readable.fromWeb(response.body as never), counter, createWriteStream(tempPath))
      const declaredType = response.headers.get('content-type')?.split(';', 1)[0] ?? null
      const { mediaType } = await detectAndValidate(tempPath, declaredType, sourceUrl)
      return {
        tempPath,
        sha256: hash.digest('hex'),
        mediaType,
        byteSize: BigInt(byteSize),
        sourceUrl,
      }
    } catch (error) {
      await unlink(tempPath).catch(() => undefined)
      throw error
    }
  }
}
