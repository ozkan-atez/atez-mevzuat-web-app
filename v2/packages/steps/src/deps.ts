import type { AiGateway, Db, HttpFetcher, ObjectStore } from '@atez/platform'
import type { DemoDeps } from './demo'

/** Adımların ihtiyaç duyduğu servisler; worker süreci bir kez kurar. */
export interface StepDeps {
  db: Db
  store: ObjectStore
  http: HttpFetcher
  /** Vertex yapılandırılmamışsa yok; AI adımları kalıcı hata verir. */
  ai: AiGateway | null
  configDir: string
  demo?: DemoDeps
}
