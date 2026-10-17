import type { AiProvider, ProviderRequest, ProviderResponse } from './provider'

/** Testler için betiklenmiş sağlayıcı: her çağrıda sıradaki yanıtı ya da işleyicinin çıktısını verir. */
export class FakeProvider implements AiProvider {
  readonly name = 'fake'
  readonly location = null
  readonly calls: ProviderRequest[] = []
  constructor(private readonly respond: (req: ProviderRequest, index: number) => unknown | Promise<unknown>) {}

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    const index = this.calls.push(req) - 1
    const out = await this.respond(req, index)
    if (out instanceof Error) throw out
    return {
      text: typeof out === 'string' ? out : JSON.stringify(out),
      usage: { inputTokens: 100, outputTokens: 20, cachedTokens: null, thinkingTokens: null },
      finishReason: 'STOP',
    }
  }
}
