import { createServer, request as proxyRequest } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../frontend/dist')
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }
async function handle(req, res) {
  const origin = process.env.APP_PUBLIC_ORIGIN
  if (origin && process.env.AUTH_PROFILE === 'local') {
    const canonical = new URL(origin)
    const host = req.headers.host ?? ''
    const aliases = ['localhost:8888', '127.0.0.1:8888', '127.0.0.1:5173']
    if (host !== canonical.host && aliases.includes(host) && !req.url?.startsWith('/api/')) {
      if (!['GET','HEAD'].includes(req.method ?? 'GET')) { res.writeHead(409); res.end('Canonical uygulama adresini kullanın.'); return }
      res.writeHead(308, { Location: `${canonical.origin}${req.url ?? '/'}` }); res.end(); return
    }
    if (host !== canonical.host && !aliases.includes(host)) { res.writeHead(400); res.end('Host doğrulanamadı.'); return }
  }
  if (req.url?.startsWith('/api/')) {
    const upstream = proxyRequest({ hostname: '127.0.0.1', port: 3001, path: req.url, method: req.method, headers: { ...req.headers, host: '127.0.0.1:3001' } }, response => {
      res.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(res)
    })
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'Uygulama servisi başlatılıyor. Biraz sonra yeniden deneyin.' })) })
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
    return
  }
  try {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    let path = resolve(dist, `.${pathname}`)
    if (path !== dist && !path.startsWith(`${dist}${sep}`)) { res.writeHead(403); res.end(); return }
    try { if (!(await stat(path)).isFile()) path = resolve(dist, 'index.html') }
    catch { if (extname(path)) { res.writeHead(404); res.end(); return } path = resolve(dist, 'index.html') }
    const data = await readFile(path)
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': extname(path) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' })
    res.end(req.method === 'HEAD' ? undefined : data)
  } catch { res.writeHead(500); res.end('Arayüz yüklenemedi.') }
}
for (const port of [5173, 8888]) createServer(handle).listen(port, '127.0.0.1', () => console.log(`ATEZ arayüzü http://127.0.0.1:${port}`))

// Local Docker-to-native bridge uses an authenticated durable mailbox so the API stays loopback-only.
if (process.env.AUTH_PROFILE === 'local' && process.env.AUTH_RELAY_KEY) {
  let relaying = false
  const relay = async () => {
    if (relaying) return
    relaying = true
    const headers = { 'X-Local-Relay-Key': process.env.AUTH_RELAY_KEY }
    try {
      const pending = await fetch('http://127.0.0.1:45882/pending', { headers, signal: AbortSignal.timeout(5000) })
      if (!pending.ok) return
      const message = await pending.json()
      if (!message || !/^[a-f0-9]{64}$/.test(message.id) || typeof message.token !== 'string') return
      const result = await fetch('http://127.0.0.1:3001/api/auth/backchannel-logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({logout_token: message.token}), signal: AbortSignal.timeout(15000) })
      // Invalid/replayed signed messages cannot block later notifications; service outages retry durably.
      if (result.ok || result.status === 400) await fetch(`http://127.0.0.1:45882/pending/${message.id}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(5000) })
    } catch { /* Local API/transport outage preserves the durable pending notification. */ }
    finally { relaying = false }
  }
  setInterval(() => void relay(), 1000).unref()
}
