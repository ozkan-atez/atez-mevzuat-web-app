import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { PermanentError, StorageKeys, TransientError, schema, sha256, type Db, type ObjectStore } from '@atez/platform'

const TOKEN_URL = 'https://login.singlewindow.io/auth/realms/agsw/protocol/openid-connect/token'
const CLIENT_ID = 'tarife'
export const TARIFF_MEASURES_URL = 'https://tariff.singlewindow.io/api/v2-0/tariff-query/tariff-measures-by-commodity'
const MAX_BYTES = 8_000_000

export interface TariffCredentials {
  username: string
  password: string
}

export function tariffCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): TariffCredentials | null {
  const username = env.TARIFF_USERNAME?.trim()
  const password = env.TARIFF_PASSWORD
  return username && password ? { username, password } : null
}

export interface TariffFetchResult {
  snapshotId: string
  raw: unknown
  url: string
  fromCache: boolean
}

/** Ham TARIFF yanıtının kaynağı (gerçek API ya da test sahtesi). */
export interface TariffApi {
  fetchMeasures(gtip: string, queryDate: string): Promise<{ url: string; raw: unknown }>
}

/**
 * Keycloak belirteci (`agsw` / `tarife`) süreç belleğinde değil Postgres'te, şifreli tutulur:
 * birden çok worker aynı belirteci paylaşır. Anahtar parola türevidir; DB tek başına sızarsa
 * belirteç okunamaz. Kimlik bilgileri ve belirteç loglanmaz.
 */
export class SingleWindowTariffApi implements TariffApi {
  private readonly accountKey: string
  private readonly key: Buffer
  constructor(
    private readonly db: Db,
    private readonly creds: TariffCredentials,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.accountKey = createHash('sha256').update(`tariff:${creds.username}`).digest('hex').slice(0, 32)
    this.key = scryptSync(creds.password, `atez-tariff-token:${this.accountKey}`, 32)
  }

  async fetchMeasures(gtip: string, queryDate: string): Promise<{ url: string; raw: unknown }> {
    const url = `${TARIFF_MEASURES_URL}?${new URLSearchParams({ commodityCode: gtip, countryCode: 'TR', queryType: 'import', queryDate })}`
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.token(attempt > 0)
      let res: Response
      try {
        res = await this.fetcher(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30_000) })
      } catch (err) {
        throw new TransientError(`TARIFF ağ hatası: ${String(err)}`, 'TARIFF_NETWORK')
      }
      if (res.status === 401 && attempt === 0) continue
      if (res.status === 429 || res.status >= 500) throw new TransientError(`TARIFF HTTP ${res.status}`, 'TARIFF_HTTP')
      if (!res.ok) throw new PermanentError(`TARIFF HTTP ${res.status}`, 'TARIFF_HTTP')
      const body = Buffer.from(await res.arrayBuffer())
      if (body.length > MAX_BYTES) throw new PermanentError('TARIFF yanıtı boyut sınırını aşıyor', 'TARIFF_TOO_LARGE')
      return { url, raw: JSON.parse(body.toString('utf8')) }
    }
    throw new PermanentError('TARIFF oturumu yenilenemedi', 'TARIFF_AUTH')
  }

  private async token(forceRefresh: boolean): Promise<string> {
    if (!forceRefresh) {
      const cached = await this.readToken()
      if (cached) return cached
    }
    // Aynı anda tek yenileme: transaction kapsamlı advisory lock.
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'tariff-token:' + this.accountKey}))`)
      if (!forceRefresh) {
        const again = await this.readToken(tx)
        if (again) return again
      }
      const form = new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'password', username: this.creds.username, password: this.creds.password })
      let res: Response
      try {
        res = await this.fetcher(TOKEN_URL, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(), redirect: 'error', signal: AbortSignal.timeout(15_000) })
      } catch (err) {
        throw new TransientError(`TARIFF oturum ağ hatası: ${String(err)}`, 'TARIFF_AUTH_NETWORK')
      }
      if (res.status === 400 || res.status === 401) throw new PermanentError('TARIFF kullanıcı adı veya şifresi kabul edilmedi', 'TARIFF_AUTH')
      if (!res.ok) throw new TransientError(`TARIFF oturumu açılamadı (${res.status})`, 'TARIFF_AUTH')
      const payload = (await res.json()) as { access_token?: unknown; expires_in?: unknown }
      if (typeof payload.access_token !== 'string' || !payload.access_token) throw new PermanentError('TARIFF erişim belirteci alınamadı', 'TARIFF_AUTH')
      const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 60
      const expiresAt = new Date(Date.now() + Math.max(1, expiresIn - 30) * 1000)
      await tx
        .insert(schema.providerToken)
        .values({ accountKey: this.accountKey, ciphertext: this.encrypt(payload.access_token), expiresAt })
        .onConflictDoUpdate({ target: schema.providerToken.accountKey, set: { ciphertext: this.encrypt(payload.access_token), expiresAt, updatedAt: sql`now()` } })
      return payload.access_token
    })
  }

  private async readToken(db: Pick<Db, 'select'> = this.db): Promise<string | null> {
    const [row] = await db
      .select()
      .from(schema.providerToken)
      .where(and(eq(schema.providerToken.accountKey, this.accountKey), sql`${schema.providerToken.expiresAt} > now()`))
    if (!row) return null
    try {
      return this.decrypt(row.ciphertext)
    } catch {
      return null
    }
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', this.key, iv)
    c.setAAD(Buffer.from(this.accountKey))
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
    return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')
  }

  private decrypt(blob: string): string {
    const b = Buffer.from(blob, 'base64')
    const d = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12))
    d.setAAD(Buffer.from(this.accountKey))
    d.setAuthTag(b.subarray(12, 28))
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')
  }
}

/**
 * TARIFF araç adaptörü (§7): aynı `(gtip, queryDate)` sorgusu önbellekten döner; ham yanıt
 * değişmez ve hash'li olarak `tariff_snapshot` + MinIO'da saklanır.
 */
export class TariffClient {
  constructor(
    private readonly db: Db,
    private readonly store: ObjectStore,
    private readonly api: TariffApi | null,
  ) {}

  get configured(): boolean {
    return this.api !== null
  }

  async lookUp(gtip: string, queryDate: string): Promise<TariffFetchResult> {
    const [cached] = await this.db
      .select()
      .from(schema.tariffSnapshot)
      .where(and(eq(schema.tariffSnapshot.gtip, gtip), eq(schema.tariffSnapshot.queryDate, queryDate)))
      .orderBy(sql`${schema.tariffSnapshot.fetchedAt} desc`)
      .limit(1)
    if (cached) {
      const snap = JSON.parse((await this.store.get(cached.objectKey)).toString('utf8')) as { raw: unknown }
      return { snapshotId: cached.id, raw: snap.raw, url: cached.url, fromCache: true }
    }
    if (!this.api) throw new PermanentError('TARIFF kimlik bilgisi yok (TARIFF_USERNAME / TARIFF_PASSWORD)', 'TARIFF_NO_CREDENTIALS')
    const { url, raw } = await this.api.fetchMeasures(gtip, queryDate)
    const hash = sha256(JSON.stringify(raw))
    const key = StorageKeys.tariffSnapshot(gtip, queryDate)
    const snapshot = {
      schemaVersion: 1,
      role: 'SUPPORTING_TARIFF',
      request: { gtip, queryDate, url },
      fetchedAt: new Date().toISOString(),
      sha256: hash,
      raw,
      validation: { status: 'UNVALIDATED', note: 'queryDate yanıtı filtrelemez; geçerlilik önlemin kendi effective_start/end penceresiyle kodda belirlenir.' },
    }
    await this.store.put(key, JSON.stringify(snapshot), 'application/json')
    const [row] = await this.db
      .insert(schema.tariffSnapshot)
      .values({ gtip, queryDate, url, sha256: hash, objectKey: key })
      .onConflictDoUpdate({ target: [schema.tariffSnapshot.gtip, schema.tariffSnapshot.queryDate, schema.tariffSnapshot.sha256], set: { fetchedAt: sql`now()` } })
      .returning({ id: schema.tariffSnapshot.id })
    return { snapshotId: row!.id, raw, url, fromCache: false }
  }
}
