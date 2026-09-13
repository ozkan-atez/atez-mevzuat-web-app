import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  SCAN_TIMEZONE: z.string().default('Europe/Istanbul'),
  SOURCE_HOSTS: z.string().default('resmigazete.gov.tr,www.resmigazete.gov.tr'),
  SOURCE_DELAY_MS: z.coerce.number().int().min(750).default(750),
  SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  SOURCE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(3).default(3),
  MAX_FILE_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
  MAX_RUN_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024 * 1024),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('eu-central-1'),
  S3_BUCKET: z.string().default('resmi-gazete'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
})

export interface AppEnv {
  databaseUrl: string
  port: number
  timezone: string
  sourceHosts: string[]
  sourceDelayMs: number
  sourceTimeoutMs: number
  sourceMaxAttempts: number
  maxFileBytes: number
  maxRunBytes: number
  s3: {
    endpoint: string
    region: string
    bucket: string
    accessKeyId: string
    secretAccessKey: string
    forcePathStyle: boolean
  }
}

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const value = schema.parse(input)
  return {
    databaseUrl: value.DATABASE_URL,
    port: value.PORT,
    timezone: value.SCAN_TIMEZONE,
    sourceHosts: value.SOURCE_HOSTS.split(',').map((host) => host.trim()).filter(Boolean),
    sourceDelayMs: value.SOURCE_DELAY_MS,
    sourceTimeoutMs: value.SOURCE_TIMEOUT_MS,
    sourceMaxAttempts: value.SOURCE_MAX_ATTEMPTS,
    maxFileBytes: value.MAX_FILE_BYTES,
    maxRunBytes: value.MAX_RUN_BYTES,
    s3: {
      endpoint: value.S3_ENDPOINT,
      region: value.S3_REGION,
      bucket: value.S3_BUCKET,
      accessKeyId: value.S3_ACCESS_KEY_ID,
      secretAccessKey: value.S3_SECRET_ACCESS_KEY,
      forcePathStyle: value.S3_FORCE_PATH_STYLE === 'true',
    },
  }
}
