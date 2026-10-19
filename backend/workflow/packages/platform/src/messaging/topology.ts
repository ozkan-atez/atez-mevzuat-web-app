import type { Channel } from 'amqplib'
import { STEP_CATALOG, type Pool, type StepKey } from '@atez/contracts'

/**
 * RabbitMQ topolojisi (§12). Koddan idempotent kurulur; kuyruk açma yetkisi yoksa
 * `topologyDefinitions()` çıktısı altyapı ekibine verilir.
 *
 * Gecikmeli retry eklentisi varsayılmaz: TTL + DLX. Mesaj `atez.retry` (headers) üzerinden
 * gecikme kuyruğuna girer; süre dolunca orijinal routing key ile `atez.cmd`'ye döner.
 * Kalıcı hatalar ve zehirli mesajlar `atez.dlx` → `q.parking`.
 */
export const EXCHANGES = {
  cmd: 'atez.cmd',
  evt: 'atez.evt',
  retry: 'atez.retry',
  dlx: 'atez.dlx',
} as const

/** Orkestratör kuyruğu (Ç7: dalın `workflow.coordinator` adı). */
export const ORCHESTRATOR_QUEUE = 'workflow.coordinator'
export const PARKING_QUEUE = 'q.parking'
export const RETRY_HEADER = 'x-retry-delay'

export const POOLS: readonly Pool[] = ['io', 'browser', 'doc', 'ai-lite', 'ai-main', 'ai-interactive', 'render', 'delivery']

/**
 * Havuz → kuyruk eşlemesi (Ek B.4 Ç7: dalın `workflow.*` adları; §12'deki `q.*` adlarının yerini
 * alır). `ai-lite` ve `ai-main` aynı toplu AI kuyruğunu paylaşır; model katmanı adımın kendisinde
 * seçilir. Chat/revizyon işleri ayrı `workflow.ai.interactive` kuyruğunda gece işlerinin arkasında
 * beklemez.
 */
export const POOL_QUEUES: Record<Pool, string> = {
  io: 'workflow.io',
  browser: 'workflow.browser',
  doc: 'workflow.document',
  'ai-lite': 'workflow.ai.batch',
  'ai-main': 'workflow.ai.batch',
  'ai-interactive': 'workflow.ai.interactive',
  render: 'workflow.render',
  delivery: 'workflow.delivery',
}
export const poolQueue = (pool: Pool): string => POOL_QUEUES[pool]
/** API'ye canlı olay iletimi (SSE) için örnek başına kuyruk. */
export const apiPushQueue = (instance: string): string => `workflow.api.push.${instance}`
export const stepRoutingKey = (step: StepKey | string): string => `step.${step}`

export interface RetryTier {
  label: string
  delayMs: number
}

export const DEFAULT_RETRY_TIERS: readonly RetryTier[] = [
  { label: '10s', delayMs: 10_000 },
  { label: '1m', delayMs: 60_000 },
  { label: '10m', delayMs: 600_000 },
]

export const retryQueue = (tier: RetryTier): string => `q.retry.${tier.label}`
/** `attempt` 1'den başlar: 1. retry → ilk kademe; kademeler bitince son kademe tekrarlanır. */
export const retryTierFor = (tiers: readonly RetryTier[], failedAttempt: number): RetryTier =>
  tiers[Math.min(Math.max(failedAttempt, 1), tiers.length) - 1]!

export interface TopologySpec {
  exchanges: { name: string; type: 'topic' | 'headers' | 'fanout' }[]
  queues: { name: string; arguments: Record<string, unknown> }[]
  bindings: { source: string; destination: string; routingKey: string; arguments: Record<string, unknown> }[]
}

export function buildTopology(tiers: readonly RetryTier[] = DEFAULT_RETRY_TIERS): TopologySpec {
  const quorum = { 'x-queue-type': 'quorum' }
  const spec: TopologySpec = {
    exchanges: [
      { name: EXCHANGES.cmd, type: 'topic' },
      { name: EXCHANGES.evt, type: 'topic' },
      { name: EXCHANGES.retry, type: 'headers' },
      { name: EXCHANGES.dlx, type: 'fanout' },
    ],
    queues: [],
    bindings: [],
  }
  for (const name of new Set(POOLS.map(poolQueue))) {
    spec.queues.push({ name, arguments: { ...quorum, 'x-dead-letter-exchange': EXCHANGES.dlx } })
  }
  for (const [step, contract] of Object.entries(STEP_CATALOG)) {
    spec.bindings.push({ source: EXCHANGES.cmd, destination: poolQueue(contract.pool), routingKey: stepRoutingKey(step), arguments: {} })
  }
  spec.queues.push({ name: ORCHESTRATOR_QUEUE, arguments: { ...quorum, 'x-dead-letter-exchange': EXCHANGES.dlx } })
  spec.bindings.push({ source: EXCHANGES.evt, destination: ORCHESTRATOR_QUEUE, routingKey: 'work_item.#', arguments: {} })
  spec.queues.push({ name: PARKING_QUEUE, arguments: quorum })
  spec.bindings.push({ source: EXCHANGES.dlx, destination: PARKING_QUEUE, routingKey: '', arguments: {} })
  for (const tier of tiers) {
    spec.queues.push({
      name: retryQueue(tier),
      arguments: { ...quorum, 'x-message-ttl': tier.delayMs, 'x-dead-letter-exchange': EXCHANGES.cmd },
    })
    spec.bindings.push({
      source: EXCHANGES.retry,
      destination: retryQueue(tier),
      routingKey: '',
      arguments: { 'x-match': 'all', [RETRY_HEADER]: tier.label },
    })
  }
  return spec
}

export async function assertTopology(channel: Channel, spec: TopologySpec = buildTopology()): Promise<void> {
  for (const ex of spec.exchanges) await channel.assertExchange(ex.name, ex.type, { durable: true })
  for (const q of spec.queues) await channel.assertQueue(q.name, { durable: true, arguments: q.arguments })
  for (const b of spec.bindings) await channel.bindQueue(b.destination, b.source, b.routingKey, b.arguments)
}

/** RabbitMQ definitions JSON (yönetim arayüzünden içe aktarılabilir). */
export function topologyDefinitions(vhost: string, spec: TopologySpec = buildTopology()) {
  return {
    exchanges: spec.exchanges.map((e) => ({ name: e.name, vhost, type: e.type, durable: true, auto_delete: false, internal: false, arguments: {} })),
    queues: spec.queues.map((q) => ({ name: q.name, vhost, durable: true, auto_delete: false, arguments: q.arguments })),
    bindings: spec.bindings.map((b) => ({
      source: b.source,
      vhost,
      destination: b.destination,
      destination_type: 'queue',
      routing_key: b.routingKey,
      arguments: b.arguments,
    })),
  }
}
