import { z } from 'zod'

const Env = z.object({
  DATABASE_URL: z.string().url(),
  AMQP_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('eu-central-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /** Vertex AI; boşsa AI geçidi kurulmaz ve AI adımları kalıcı hata verir. */
  VERTEX_PROJECT: z.string().optional().transform((v) => v || undefined),
  VERTEX_LOCATION: z.string().optional().transform((v) => v || undefined),
  /** Servis hesabı anahtar dosyası (repoya girmez; yalnızca .env). */
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional().transform((v) => v || undefined),
  GOTENBERG_URL: z.string().optional().transform((v) => v || undefined),
  CONFIG_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})
export type Env = z.infer<typeof Env>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source)
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
    throw new Error(`Ortam değişkenleri eksik/geçersiz: ${fields}`)
  }
  return parsed.data
}
