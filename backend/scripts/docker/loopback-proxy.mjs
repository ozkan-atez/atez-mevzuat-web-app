// Docker yerel profili: tarayıcı Keycloak'ı http://localhost:<port> adresinde görür ve OIDC issuer bu
// adrestir. Container içinde localhost container'ın kendisidir; bu köprü 127.0.0.1:<issuer portu>
// trafiğini OIDC_LOOPBACK_TARGET'a (ör. keycloak:8080) iletir. Şirket profilinde kullanılmaz.
import net from 'node:net'

const issuer = new URL(process.env.OIDC_ISSUER_URL)
if (!['localhost', '127.0.0.1'].includes(issuer.hostname)) process.exit(0)
const [host, port] = process.env.OIDC_LOOPBACK_TARGET.split(':')
const listenPort = Number(issuer.port || 80)
net
  .createServer((client) => {
    const upstream = net.connect(Number(port), host)
    client.pipe(upstream).pipe(client)
    const close = () => { client.destroy(); upstream.destroy() }
    client.on('error', close)
    upstream.on('error', close)
  })
  .listen(listenPort, '127.0.0.1')
