import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { Dashboard } from './features/dashboard/Dashboard'
import { ChatScreen } from './features/chat/ChatScreen'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/chat" element={<ChatScreen />} />
          <Route path="/pending" element={<div className="p-4 font-medium text-slate-500">Yakında: Onay Bekleyenler Sayfası</div>} />
          <Route path="/reports" element={<div className="p-4 font-medium text-slate-500">Yakında: Tüm Raporlar</div>} />
          <Route path="/workflows" element={<div className="p-4 font-medium text-slate-500">Yakında: Geçmiş Görevler (Runs)</div>} />
          <Route path="/groups" element={<div className="p-4 font-medium text-slate-500">Yakında: Kullanıcı ve Mail Grupları</div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
