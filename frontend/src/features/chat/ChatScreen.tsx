import { useState } from 'react'

export function ChatScreen() {
  const [messages, setMessages] = useState<string>('')
  const [isStreaming, setIsStreaming] = useState(false)

  const startStream = () => {
    setMessages('')
    setIsStreaming(true)

    // Yerel SSE bağlantısı (Vite Proxy üzerinden 3001'e gider)
    const eventSource = new EventSource('/api/chat/stream')

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      
      if (data.done) {
        eventSource.close()
        setIsStreaming(false)
        return
      }

      if (data.word) {
        // Kelimeleri peş peşe ekliyoruz
        setMessages(prev => prev + data.word)
      }
    }

    eventSource.onerror = (err) => {
      console.error('SSE Bağlantı Hatası:', err)
      eventSource.close()
      setIsStreaming(false)
    }
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>💬 Sohbet Akışı (SSE) Testi</h1>
      <p style={{ marginBottom: '2rem' }}>
        Next.js proxy'si kaldırıldığı için bu yayın bufferlanmadan (kesintisiz) doğrudan Fastify'dan tarayıcıya akar.
      </p>

      <button 
        onClick={startStream} 
        disabled={isStreaming}
        style={{ padding: '10px 20px', cursor: 'pointer', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px' }}
      >
        {isStreaming ? 'Yazıyor...' : 'Yapay Zekaya Sor'}
      </button>

      <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#f4f4f5', borderRadius: '8px', minHeight: '100px', fontSize: '1.1rem', lineHeight: '1.6' }}>
        {messages || 'Mesaj bekleniyor...'}
      </div>
      
      <div style={{ marginTop: '2rem' }}>
        <a href="/" style={{ color: '#2563eb' }}>Ana Sayfaya Dön</a>
      </div>
    </div>
  )
}
