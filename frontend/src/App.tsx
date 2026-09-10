import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from './lib/api'

// --- Test Bileşenleri ---
function Dashboard() {
  const [health, setHealth] = useState<any>(null)
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    // Vite proxy üzerinden Fastify backendine istekler
    api.get('/health').then(res => setHealth(res.data)).catch(console.error)
    api.get('/auth/me').then(res => setUser(res.data.user)).catch(console.error)
  }, [])

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>⚖️ ATEZ Mevzuat Web App</h1>
      <nav style={{ marginBottom: '2rem' }}>
        <Link to="/reports/123" style={{ marginRight: '1rem', color: '#2563eb' }}>Rapor 123 (SPA Yönlendirme Testi)</Link>
        <Link to="/chat" style={{ color: '#2563eb' }}>Sohbet (SSE Stream Testi)</Link>
      </nav>
      
      <div style={{ border: '1px solid #ccc', padding: '1rem', marginBottom: '1rem', borderRadius: '8px' }}>
        <h3>🟢 API Durumu (Health Check)</h3>
        <pre style={{ background: '#f4f4f5', padding: '1rem' }}>{JSON.stringify(health, null, 2) || 'Yükleniyor...'}</pre>
      </div>

      <div style={{ border: '1px solid #ccc', padding: '1rem', borderRadius: '8px' }}>
        <h3>👤 Giriş Yapan Kullanıcı (/auth/me)</h3>
        <pre style={{ background: '#f4f4f5', padding: '1rem' }}>{JSON.stringify(user, null, 2) || 'Yükleniyor...'}</pre>
      </div>
    </div>
  )
}

function ReportDetail() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>📄 Rapor Detayı</h1>
      <p>Burası Rapor 123 sayfası. SPA Routing başarılı bir şekilde çalışıyor ve sayfa yenilenmedi.</p>
      <Link to="/" style={{ color: '#2563eb' }}>Ana Sayfaya Dön</Link>
    </div>
  )
}

function NotFound() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>❌ 404 Sayfa Bulunamadı</h1>
      <Link to="/" style={{ color: '#2563eb' }}>Ana Sayfaya Dön</Link>
    </div>
  )
}

import { ChatScreen } from './features/chat/ChatScreen'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/chat" element={<ChatScreen />} />
        <Route path="/reports/:id" element={<ReportDetail />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
