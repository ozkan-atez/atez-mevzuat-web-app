import { studioFetch } from '../../../platform/studio-transport'
/**
 * Sohbetten bileşen oluşturma: v2 şablon stüdyosuna (bileşen havuzu + AI bileşen servisi) köprü.
 *
 * Model yalnızca taslak ister; taslak mesaja kart olarak eklenir ve havuza kaydetme kullanıcının
 * kart üzerindeki butonuyla, doğrudan v2 API'si üzerinden yapılır (§10.1-5: kaydı API yapar, model yapmaz).
 */
export interface StudioComponentSummary {
  id: string
  key: string
  name: string
  description: string
  category: string
  status: string
  origin: string
  currentVersion: number
}

export interface StudioDraft {
  ok: boolean
  reply?: string
  name: string
  description: string
  category: string
  definition: unknown
  issues: string[]
  previewHtml: string | null
}

/** Mesaj bağlamında saklanan taslak kartı; sohbet geçmişiyle birlikte yeniden yüklenir. */
export interface ComponentDraftCard {
  id: string
  /** Mevcut bir bileşenin değişikliğiyse o bileşen: kart "yeni sürüm olarak kaydet" der. */
  target?: { id: string; key: string; name: string; version: number; origin: string }
  ok: boolean
  name: string
  description: string
  category: string
  definition: unknown
  issues: string[]
  previewHtml: string | null
}

export interface ComponentStudio {
  listComponents(): Promise<StudioComponentSummary[]>
  getComponent(id: string): Promise<(StudioComponentSummary & { definition: unknown }) | null>
  draft(input: { request: string; base: { name: string; description: string; category: string; definition: unknown } | null }): Promise<StudioDraft>
}

export class ComponentStudioUnavailableError extends Error {
  override name = 'ComponentStudioUnavailableError'
}

/** v2 API istemcisi (`/api/components…`). Taslak üretimi Gemini çağrısı içerdiği için uzun sürebilir. */
export class HttpComponentStudio implements ComponentStudio {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetcher: typeof fetch
  constructor(options: { baseUrl: string; timeoutMs?: number; fetcher?: typeof fetch }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.fetcher = options.fetcher ?? studioFetch
  }

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    let response: Response
    try {
      response = await this.fetcher(`${this.baseUrl}/api${path}`, {
        method: init?.method ?? 'GET',
        headers: init?.body ? { 'content-type': 'application/json' } : {},
        ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new ComponentStudioUnavailableError('Bileşen stüdyosuna ulaşılamadı.')
    }
    if (response.status === 404) return null as T
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null
      throw new ComponentStudioUnavailableError(body?.message ?? `Bileşen stüdyosu hata döndürdü (${response.status}).`)
    }
    return (await response.json()) as T
  }

  listComponents() {
    return this.request<StudioComponentSummary[]>('/components')
  }
  getComponent(id: string) {
    return this.request<(StudioComponentSummary & { definition: unknown }) | null>(`/components/${encodeURIComponent(id)}`)
  }
  draft(input: { request: string; base: { name: string; description: string; category: string; definition: unknown } | null }) {
    return this.request<StudioDraft>('/components/ai/draft', { method: 'POST', body: { request: input.request, base: input.base } })
  }
}

/** Modele dönen kısa özet: tanım ve HTML modele gitmez (token), kart kullanıcıya gösterilir. */
export function draftSummaryForModel(card: ComponentDraftCard, reply: string | undefined) {
  return {
    taslakId: card.id,
    ad: card.name,
    kategori: card.category,
    dogrulandi: card.ok,
    ...(card.issues.length ? { sorunlar: card.issues } : {}),
    ...(card.target ? { degistirilenBilesen: card.target.name } : {}),
    tasarimNotu: reply ?? '',
    not: 'Taslak kullanıcıya önizleme kartıyla gösterildi. Havuza kaydetmek için kullanıcı kart üzerindeki butonu kullanır; kaydedildi deme.',
  }
}
