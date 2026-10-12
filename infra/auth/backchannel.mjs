import { createServer } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdir, writeFile, rename, readdir, readFile, unlink } from 'node:fs/promises'
import { createRemoteJWKSet, jwtVerify } from '/deps/jose/dist/webapi/index.js'

// Local Docker notification transport only. Identity/application authorization stays in Fastify.
// The provider's signature is checked before a durable file is admitted; no token is logged.
const directory = '/mailbox'
await mkdir(directory, { recursive: true, mode: 0o700 })
const issuer = 'http://localhost:45881/realms/atez-web-local'
const jwks = createRemoteJWKSet(new URL('http://keycloak:8080/realms/atez-web-local/protocol/openid-connect/certs'))
const key = process.env.AUTH_RELAY_KEY
if (!key || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Local transport key required.')
const authorized = request => {
  const actual = request.headers['x-local-relay-key']
  return typeof actual === 'string' && actual.length === key.length && timingSafeEqual(Buffer.from(actual), Buffer.from(key))
}
const json = (response, status, value) => { response.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}); response.end(JSON.stringify(value)) }
createServer(async (request, response) => {
  try {
    if (request.method === 'POST' && request.url === '/api/auth/backchannel-logout') {
      if (!String(request.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) return json(response,415,{})
      const chunks=[];let size=0
      for await(const chunk of request) {size+=chunk.length;if(size>20000)return json(response,413,{});chunks.push(chunk)}
      const token=new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('logout_token')
      if(!token)return json(response,400,{})
      const {payload}=await jwtVerify(token,jwks,{issuer,audience:'atez-mevzuat-web',algorithms:['RS256'],requiredClaims:['iat','jti','events'],maxTokenAge:300,clockTolerance:5})
      if(payload.nonce!==undefined || !payload.events?.['http://schemas.openid.net/event/backchannel-logout'] || (!payload.sub&&!payload.sid))return json(response,400,{})
      const files=await readdir(directory);if(files.length>=1000)return json(response,503,{})
      const id=createHash('sha256').update(token).digest('hex')
      const temp=`${directory}/${id}.tmp`
      await writeFile(temp,JSON.stringify({id,token}),{mode:0o600});await rename(temp,`${directory}/${id}.json`)
      response.writeHead(204);response.end();return
    }
    if(!authorized(request))return json(response,401,{})
    if(request.method==='GET'&&request.url==='/pending') {
      const file=(await readdir(directory)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).sort()[0]
      return json(response,200,file?JSON.parse(await readFile(`${directory}/${file}`,'utf8')):null)
    }
    const match=request.url?.match(/^\/pending\/([a-f0-9]{64})$/)
    if(request.method==='DELETE'&&match){await unlink(`${directory}/${match[1]}.json`).catch(()=>undefined);response.writeHead(204);response.end();return}
    json(response,404,{})
  } catch {json(response,400,{})}
}).listen(8080,'0.0.0.0')
