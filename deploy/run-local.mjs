import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'backend/package.json'))
const { parse } = require('dotenv')
function config(path) { try { return parse(readFileSync(path)) } catch { return {} } }
const baseConfig = { ...config(resolve(root, 'backend/.env')), ...config(resolve(root, '.env')) }
const explicitAuthProfile = process.env.AUTH_PROFILE ?? baseConfig.AUTH_PROFILE
const saved = { ...baseConfig, ...(explicitAuthProfile === 'company' ? {} : config(resolve(root, '.local/auth/auth.env'))), ...(explicitAuthProfile ? { AUTH_PROFILE: explicitAuthProfile } : {}) }
const mode = process.argv[2]
if (!['api', 'worker', 'web'].includes(mode)) throw new Error('api, worker veya web modu gereklidir.')
const env = {
  ...process.env, ...saved,
  NODE_ENV: 'production',
  COMPONENT_STUDIO_URL: saved.COMPONENT_STUDIO_URL ?? 'http://127.0.0.1:3101',
  SOURCE_CREDENTIAL_KEY_FILE: saved.SOURCE_CREDENTIAL_KEY_FILE ?? resolve(homedir(), '.config/atez/source-credentials.key'),
  DATABASE_URL: saved.LOCAL_DATABASE_URL ?? 'postgresql://atez:atezpassword@127.0.0.1:5432/atez_db?schema=public',
  RABBITMQ_URL: saved.LOCAL_RABBITMQ_URL ?? saved.RABBITMQ_URL ?? `amqp://${encodeURIComponent(saved.RABBITMQ_USER ?? 'atez')}:${encodeURIComponent(saved.RABBITMQ_PASSWORD ?? 'atezpassword')}@127.0.0.1:5672`,
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: saved.S3_REGION ?? 'eu-central-1',
  S3_BUCKET: saved.S3_BUCKET ?? 'resmi-gazete',
  S3_ACCESS_KEY_ID: saved.S3_ACCESS_KEY_ID ?? 'atez-local-access',
  S3_SECRET_ACCESS_KEY: saved.S3_SECRET_ACCESS_KEY ?? 'atez-local-secret-change-me',
  S3_FORCE_PATH_STYLE: 'true',
  GOTENBERG_URL: 'http://127.0.0.1:3002',
  PORT: '3001', API_HOST: '127.0.0.1',
  NODE_EXTRA_CA_CERTS: resolve(root, 'backend/certs/GeoTrustTLSRSACAG1.pem'),
}
const args = mode === 'web' ? [resolve(root, 'deploy/serve-web.mjs')] : ['--import', 'tsx', `src/${mode === 'api' ? 'server' : 'worker'}.ts`]
const child = spawn(process.execPath, args, { cwd: resolve(root, 'backend'), env, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', code => process.exit(code ?? 1))
