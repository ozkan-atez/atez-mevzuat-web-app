import { Link, useLocation } from 'react-router-dom'
import { Home, FileText, Activity, Users, Settings } from 'lucide-react'

export function Sidebar() {
  const location = useLocation()
  
  const navItems = [
    { name: 'Dashboard', path: '/', icon: Home },
    { name: 'Onay Bekleyenler', path: '/pending', icon: Activity },
    { name: 'Raporlar', path: '/reports', icon: FileText },
    { name: 'Görevler', path: '/workflows', icon: Settings },
    { name: 'Gruplar', path: '/groups', icon: Users },
  ]

  return (
    <aside className="w-64 bg-slate-900 text-white flex flex-col h-screen fixed left-0 top-0">
      <div className="p-4 border-b border-slate-800">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <span className="text-blue-500">ATEZ</span> Mevzuat
        </h1>
      </div>
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map(item => {
          const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path))
          return (
            <Link 
              key={item.path} 
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              <item.icon size={20} />
              {item.name}
            </Link>
          )
        })}
      </nav>
      <div className="p-4 border-t border-slate-800 text-sm text-slate-500">
        v1.0.0
      </div>
    </aside>
  )
}
