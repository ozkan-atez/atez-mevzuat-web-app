import { Bell, User } from 'lucide-react'

export function Navbar() {
  return (
    <header className="h-16 bg-white border-b flex items-center justify-between px-6 sticky top-0 z-10">
      <div className="text-slate-600 font-medium">
        Hoşgeldiniz, Admin
      </div>
      <div className="flex items-center gap-4">
        <button className="p-2 text-slate-400 hover:bg-slate-100 rounded-full">
          <Bell size={20} />
        </button>
        <button className="flex items-center gap-2 p-2 hover:bg-slate-100 rounded-md">
          <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">
            <User size={16} />
          </div>
        </button>
      </div>
    </header>
  )
}
