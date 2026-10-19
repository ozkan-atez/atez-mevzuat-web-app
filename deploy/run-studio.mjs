import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn} from 'node:child_process'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const require=createRequire(resolve(root,'backend/package.json'))
const {parse}=require('dotenv')
const read=p=>{try{return parse(readFileSync(p))}catch{return {}}}
const saved={...read(resolve(root,'backend/.env')),...read(resolve(root,'.env')),...read(resolve(root,'.local/auth/auth.env'))}
const db=new URL(saved.LOCAL_DATABASE_URL??'postgresql://atez:atezpassword@127.0.0.1:5432/atez_db')
db.pathname='/atez_studio_v2';db.search=''
const env={...process.env,...saved,DATABASE_URL:db.toString(),AMQP_URL:saved.LOCAL_RABBITMQ_URL??'amqp://localhost:5672',S3_ENDPOINT:'http://127.0.0.1:9000',S3_BUCKET:saved.S3_BUCKET??'resmi-gazete',S3_ACCESS_KEY_ID:saved.S3_ACCESS_KEY_ID??'atez-local-access',S3_SECRET_ACCESS_KEY:saved.S3_SECRET_ACCESS_KEY??'atez-local-secret-change-me',S3_FORCE_PATH_STYLE:'true',PORT:'3101',HOST:'127.0.0.1',CONFIG_DIR:resolve(root,'backend/workflow/config'),NODE_EXTRA_CA_CERTS:resolve(root,'backend/certs/GeoTrustTLSRSACAG1.pem')}
const script=process.argv[2]==='migrate'?'packages/platform/src/db/migrate-cli.ts':'apps/studio/src/main.ts'
const child=spawn(process.execPath,['--import','tsx',script],{cwd:resolve(root,'backend/workflow'),env,stdio:'inherit'})
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal))
child.on('exit',code=>process.exit(code??1))
