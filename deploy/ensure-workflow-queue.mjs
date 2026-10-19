import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const {parse}=createRequire(resolve(root,'backend/package.json'))('dotenv')
const read=p=>{try{return parse(readFileSync(p))}catch{return {}}}
const saved={...read(resolve(root,'backend/.env')),...read(resolve(root,'.env'))}
const main=new URL(saved.LOCAL_RABBITMQ_URL??saved.RABBITMQ_URL??`amqp://${encodeURIComponent(saved.RABBITMQ_USER??'atez')}:${encodeURIComponent(saved.RABBITMQ_PASSWORD??'atezpassword')}@127.0.0.1:5672`)
const pipeline=new URL(saved.V2_AMQP_URL??main.href)
if(!saved.V2_AMQP_URL)pipeline.pathname='/atez-v2'
if(pipeline.pathname===main.pathname)throw new Error('V2 must use a separate queue virtual host.')
const management=saved.RABBITMQ_MANAGEMENT_URL??'http://127.0.0.1:15672'
const headers={authorization:`Basic ${Buffer.from(`${decodeURIComponent(main.username)}:${decodeURIComponent(main.password)}`).toString('base64')}`,'content-type':'application/json'}
const vhost=encodeURIComponent(decodeURIComponent(pipeline.pathname.slice(1)))
for(const [path,body] of [[`vhosts/${vhost}`,{}],[`permissions/${vhost}/${encodeURIComponent(decodeURIComponent(pipeline.username))}`,{configure:'.*',write:'.*',read:'.*'}]]){
 const response=await fetch(`${management.replace(/\/$/,'')}/api/${path}`,{method:'PUT',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000)})
 if(!response.ok)throw new Error(`V2 queue setup failed (${response.status}).`)
}
console.log('V2 queue virtual host ready; existing queues retained.')
