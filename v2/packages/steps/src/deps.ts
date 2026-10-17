import { SafeHttpFetcher, type AiGateway, type Db, type HttpFetcher, type ObjectStore, type Runtime } from '@atez/platform'
import { RG_HOSTS, SingleWindowTariffApi, TariffClient, tariffCredentialsFromEnv } from '@atez/modules'
import type { DemoDeps } from './demo'

/** Adımların ihtiyaç duyduğu servisler; worker süreci bir kez kurar. */
export interface StepDeps {
  db: Db
  store: ObjectStore
  http: HttpFetcher
  /** Vertex yapılandırılmamışsa yok; AI adımları kalıcı hata verir. */
  ai: AiGateway | null
  configDir: string
  /** TARIFF araç adaptörü; kimlik bilgisi yoksa `configured === false`. */
  tariff: TariffClient
  demo?: DemoDeps
}

/** Süreçler (worker, run-once) için tek kurulum noktası. TARIFF kimlik bilgisi yalnızca env'den. */
export function createStepDeps(rt: Runtime): StepDeps {
  const creds = tariffCredentialsFromEnv()
  return {
    db: rt.db.db,
    store: rt.store,
    ai: rt.ai,
    configDir: rt.configDir,
    http: new SafeHttpFetcher({ allowedHosts: [...RG_HOSTS], minIntervalMs: 750, timeoutMs: 180_000 }),
    tariff: new TariffClient(rt.db.db, rt.store, creds ? new SingleWindowTariffApi(rt.db.db, creds) : null),
  }
}
