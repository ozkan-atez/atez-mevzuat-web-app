import { FastifyInstance } from 'fastify'

export async function chatRoutes(app: FastifyInstance) {
  app.get('/stream', async (request, reply) => {
    // SSE (Server-Sent Events) HTTP Başlıkları
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    
    // Tarayıcı bağlantıyı açar açmaz ilk mesaj
    reply.raw.write('data: {"status": "connected"}\n\n')

    // AI'ın ChatGPT gibi kelime kelime dönmesini simüle ediyoruz
    const words = ["Bu,", "bir", "gerçek", "zamanlı", "sohbet", "yayını", "(SSE)", "testidir.", "Sistem", "Vite", "proxy'si", "üzerinden", "başarıyla", "çalışıyor! 🚀"]
    let index = 0

    const interval = setInterval(() => {
      if (index >= words.length) {
        clearInterval(interval)
        reply.raw.write('data: {"done": true}\n\n')
        reply.raw.end()
        return
      }

      // Kelimeleri chunk olarak yolluyoruz
      const chunk = { word: words[index] + " " }
      reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)
      index++
    }, 400) // Her kelime arası 400ms

    // Kullanıcı sekmeyi kapatırsa yayını kes
    request.raw.on('close', () => {
      clearInterval(interval)
    })
  })
}
