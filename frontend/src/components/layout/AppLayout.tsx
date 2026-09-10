import { Outlet } from 'react-router-dom'
import { DockedAiAssistant } from '../features/chat/DockedAiAssistant'

export function AppLayout() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-36 text-slate-800 antialiased selection:bg-blue-600 selection:text-white relative">
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10">
        <Outlet />
      </main>
      <DockedAiAssistant />
    </div>
  )
}
