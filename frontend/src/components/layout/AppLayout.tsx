import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { DockedAiAssistant } from '../../features/chat/DockedAiAssistant'
import { ActiveReportProvider } from '../../features/revision/ActiveReportContext'

export function AppLayout() {
  const [isAssistantOpen, setIsAssistantOpen] = useState(false)
  // The workspace has its own composer and fills the viewport; the dock would be a
  // second place to type the same thing.
  const isChatRoute = useLocation().pathname.startsWith('/chat')

  if (isChatRoute) {
    return (
      <ActiveReportProvider>
        <div className="min-h-screen bg-slate-50 text-slate-800 antialiased selection:bg-blue-600 selection:text-white">
          <Outlet />
        </div>
      </ActiveReportProvider>
    )
  }

  return (
    <ActiveReportProvider>
      <div className={`min-h-screen bg-slate-50 flex flex-col ${isAssistantOpen ? 'pb-36' : 'pb-20'} text-slate-800 antialiased selection:bg-blue-600 selection:text-white relative transition-[padding] duration-300`}>
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10">
          <Outlet />
        </main>
        <DockedAiAssistant isOpen={isAssistantOpen} onOpenChange={setIsAssistantOpen} />
      </div>
    </ActiveReportProvider>
  )
}
