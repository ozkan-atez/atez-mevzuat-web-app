import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Navbar } from './Navbar'

export function AppLayout() {
  const isChatRoute = useLocation().pathname.startsWith('/chat')

  return <>
    <div className="atez-shell">
      <Sidebar />
      <div className="atez-main-column">
        <Navbar />
        <div className={`atez-page-content ${isChatRoute ? 'atez-chat-page' : 'pb-20'}`}>
          <main className={isChatRoute ? 'atez-workspace-main' : 'atez-content-main'}><Outlet /></main>
        </div>
      </div>
    </div>
  </>
}
