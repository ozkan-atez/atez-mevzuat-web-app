import type { DiscoveredItem, SourcePrecheck, StepOutput } from '@atez/contracts'
import { PermanentError, TransientError, hashJson, type Db, type HttpFetcher, type Logger } from '@atez/platform'
import * as repo from '../../documents/repo'
import { dayPageUrl, parseDayPage, parseFihristPage, RgParseError, type RgListItem } from './parse'

export const RG_ADAPTER_VERSION = '1'

interface Observed {
  issue: string
  mukerrerCount: number
  mainKeysHash: string
  itemCount: number
}

/**
 * RG ön kontrolü ve keşif (§5.3 basamak 0–1, §9.1):
 *  0. Günlük sayfa tek istekle okunur. Ana sayı ve mükerrer rozeti önceki gözlemle aynıysa ve
 *     o güne ait yarım kalmış belge yoksa tarama burada biter (AI çağrısı yok).
 *     Rozet büyüdüyse yalnızca yeni `mukerrer=N` fihristleri okunur.
 *  1. Her belge `kaynak + canonicalKey` kimliğiyle kaydedilir; işlenmiş (SEEN) belgeler atlanır,
 *     yarım kalmışlar (PENDING) yeniden aday olur. FORCE hepsini yeniden aday yapar.
 */
export async function discoverResmiGazete(
  deps: { db: Db; http: HttpFetcher; log: Logger },
  sourceId: string,
  date: string,
  opts: { force: boolean },
): Promise<StepOutput<'source.discover'>> {
  const dayUrl = dayPageUrl(date)
  const res = await deps.http.fetch({ url: dayUrl, noFollow: true })
  if (res.status >= 300 && res.status < 400) throw new PermanentError(`RG ${date} günlük sayfası yok (HTTP ${res.status})`, 'RG_DAY_NOT_FOUND')
  if (res.status !== 200) throw new TransientError(`RG günlük sayfa HTTP ${res.status}`, 'RG_HTTP')
  const day = guard(() => parseDayPage(res.body.toString('utf8'), date))

  const previous = await repo.getObservation(deps.db, sourceId, date)
  const prevObserved = previous?.observed as Observed | undefined
  const prevCount = prevObserved?.mukerrerCount ?? 0
  const toFetch = opts.force || !previous ? day.mukerrer : day.mukerrer.filter((m) => m.n > prevCount)

  const editions: SourcePrecheck['editions'] = [{ issue: day.issue, mukerrer: null, url: dayUrl, items: day.items.length }]
  const listed: (RgListItem & { feed: string; issue: string })[] = day.items.map((i) => ({ ...i, feed: dayUrl, issue: day.issue }))
  for (const m of toFetch) {
    const r = await deps.http.fetch({ url: m.url, noFollow: true })
    // Var olmayan mükerrer 302 döner; rozette görünüp 302 dönüyorsa henüz yayımlanmamış sayılır.
    if (r.status !== 200) throw new TransientError(`RG ${m.n}. mükerrer fihristi HTTP ${r.status}`, 'RG_MUKERRER_HTTP')
    const page = guard(() => parseFihristPage(r.body.toString('utf8'), date, m.n))
    editions.push({ issue: page.issue, mukerrer: m.n, url: m.url, items: page.items.length })
    listed.push(...page.items.map((i) => ({ ...i, feed: m.url, issue: page.issue })))
  }

  const rows = await repo.upsertDiscovered(
    deps.db,
    sourceId,
    listed.map((i) => ({
      canonicalKey: i.canonicalKey,
      url: i.url,
      title: i.title,
      kind: i.kind,
      publishedOn: date,
      listContext: { rgSection: i.rgSection, rgType: i.rgType, rgIssue: i.issue, mukerrer: i.mukerrer, position: i.position, feed: i.feed },
    })),
  )
  const isNew = new Map(rows.map((r) => [r.canonicalKey, r.firstSeenAt.getTime() === r.lastSeenAt.getTime()]))

  const all = await repo.documentsForDate(deps.db, sourceId, date)
  const candidates: DiscoveredItem[] = []
  for (const d of all.sort(byPosition)) {
    const final = (repo.FINAL_STATES as readonly string[]).includes(d.processingState)
    if (final && !opts.force) continue
    const ctx = (d.listContext ?? {}) as Record<string, unknown>
    candidates.push({
      schemaVersion: 1,
      source: sourceId,
      feed: (ctx.feed as string) ?? dayUrl,
      documentId: d.id,
      identity: { canonicalKey: d.canonicalKey, url: d.url },
      title: d.title,
      kind: d.kind as DiscoveredItem['kind'],
      listedDate: date,
      listContext: {
        rgSection: (ctx.rgSection as string | null) ?? null,
        rgType: (ctx.rgType as string | null) ?? null,
        rgIssue: (ctx.rgIssue as string | null) ?? null,
        mukerrer: (ctx.mukerrer as number | null) ?? null,
        position: (ctx.position as number) ?? 0,
      },
      precheck: { status: final ? 'SEEN' : isNew.get(d.canonicalKey) ? 'NEW' : 'PENDING' },
    })
  }

  const observed: Observed = {
    issue: day.issue,
    mukerrerCount: day.badgeCount,
    mainKeysHash: hashJson(day.items.map((i) => i.canonicalKey).sort()),
    itemCount: all.length,
  }
  const observedHash = hashJson({ issue: observed.issue, mukerrerCount: observed.mukerrerCount, mainKeysHash: observed.mainKeysHash })
  const status: SourcePrecheck['status'] = !previous ? 'FIRST_SEEN' : previous.observedHash === observedHash ? 'NO_CHANGE' : 'CHANGED'
  await repo.saveObservation(deps.db, sourceId, date, observed as unknown as Record<string, unknown>, observedHash)

  const counts = {
    listed: all.length,
    new: candidates.filter((c) => c.precheck.status === 'NEW').length,
    pending: candidates.filter((c) => c.precheck.status === 'PENDING').length,
    skipped: all.length - candidates.length,
  }
  deps.log.info('rg discover', { date, status, editions: editions.length, ...counts })
  return {
    sourceId,
    date,
    precheck: { status, editions, previous: prevObserved ? { mukerrerCount: prevObserved.mukerrerCount, itemCount: prevObserved.itemCount } : null },
    candidates,
    counts,
  }
}

function byPosition(a: { listContext: unknown }, b: { listContext: unknown }): number {
  const ka = a.listContext as { mukerrer?: number | null; position?: number }
  const kb = b.listContext as { mukerrer?: number | null; position?: number }
  return (ka.mukerrer ?? 0) - (kb.mukerrer ?? 0) || (ka.position ?? 0) - (kb.position ?? 0)
}

function guard<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof RgParseError) throw new PermanentError(err.message, err.code)
    throw err
  }
}
