// Private local environment loader. Never prints secrets, connection strings or account passwords.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { parse } = require('dotenv')
const root = path.resolve(__dirname, '../..')
const read = file => { try { return parse(fs.readFileSync(file)) } catch { return {} } }
const saved = { ...read(path.join(root, 'backend/.env')), ...read(path.join(root, '.env')), ...read(path.join(root, '.local/auth/auth.env')) }
if (saved.AUTH_PROFILE !== 'local') throw new Error('Explicit local authentication profile required.')
const target = saved.LOCAL_DATABASE_URL ?? 'postgresql://atez:atezpassword@127.0.0.1:5432/atez_db?schema=public'
const parsed = new URL(target)
if (parsed.hostname !== '127.0.0.1' || parsed.port !== '5432' || parsed.pathname !== '/atez_db') throw new Error('Unexpected database target.')
const env = { ...process.env, ...saved, DATABASE_URL: target, S3_ENDPOINT: 'http://127.0.0.1:9000', S3_BUCKET: saved.S3_BUCKET ?? 'resmi-gazete', S3_REGION: saved.S3_REGION ?? 'eu-central-1', S3_ACCESS_KEY_ID: saved.S3_ACCESS_KEY_ID ?? 'atez-local-access', S3_SECRET_ACCESS_KEY: saved.S3_SECRET_ACCESS_KEY ?? 'atez-local-secret-change-me', S3_FORCE_PATH_STYLE: 'true' }
const command = process.argv[2]
const bin = name => path.join(root, 'backend/node_modules/.bin', name)
if (command === 'stats') {
  const db = new (require('@prisma/client').PrismaClient)({ datasources: { db: { url: target } } })
  ;(async () => {
    const names = ['user','scanRun','chatSession','generalChatMessage','document','documentVersion','topicReport','reportRevision','reportDraft']
    const counts = Object.fromEntries(await Promise.all(names.map(async name => [name, await db[name].count()])))
    if (process.argv[3]) {
      if (!['before','after'].includes(process.argv[3])) throw new Error('Unknown snapshot.')
      fs.writeFileSync(path.join(root, `.local/auth/${process.argv[3]}-counts.json`), JSON.stringify(counts), { mode: 0o600 })
    }
    console.log(JSON.stringify(counts)); await db.$disconnect()
  })().catch(() => { console.error('Local count verification failed.'); process.exitCode = 1 })
} else {
  const commands = {
    migrate: [bin('prisma'), ['migrate','deploy']],
    provision: [process.execPath, [path.join(root, 'backend/scripts/provision-local-auth.cjs')]],
    assign: [bin('tsx'), [path.join(root, 'backend/scripts/assign-legacy-workspace.ts'), ...process.argv.slice(3)]],
  }
  const selected = commands[command]
  if (!selected) throw new Error('Use stats, migrate, provision or assign.')
  const child = spawnSync(selected[0], selected[1], { cwd: path.join(root, 'backend'), env, stdio: 'inherit' })
  process.exitCode = child.status ?? 1
}
