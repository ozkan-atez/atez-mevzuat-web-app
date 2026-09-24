import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { DockedAiAssistant } from '../../features/chat/DockedAiAssistant'
import { TriggerWorkflowModal } from '../../features/dashboard/TriggerWorkflowModal'
import { ActiveReportProvider } from '../../features/revision/ActiveReportContext'
import { ActiveTemplateProvider } from '../../features/templates/ActiveTemplateContext'
import { AppSidebar } from './AppSidebar'

export function AppLayout() {
  const [isAssistantOpen, setIsAssistantOpen] = useState(false)
  const [isTriggerOpen, setIsTriggerOpen] = useState(false)
  const navigate = useNavigate()
  const pathname = useLocation().pathname
  // The chat page owns the dock so it can send into the selected conversation.
  const isChatRoute = pathname.startsWith('/chat')

  return (
    <ActiveReportProvider>
    <ActiveTemplateProvider>
      <div className="min-h-screen bg-slate-50 text-slate-800 antialiased selection:bg-blue-600 selection:text-white lg:flex">
        <AppSidebar onNewRun={() => setIsTriggerOpen(true)} />
        {isChatRoute ? (
          <div className="min-w-0 flex-1"><Outlet /></div>
        ) : (
          <div className={`relative flex min-w-0 flex-1 flex-col transition-[padding] duration-300 ${isAssistantOpen ? 'pb-36' : 'pb-20'}`}>
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 sm:px-6 sm:pt-10 lg:px-8">
              <Outlet />
            </main>
            <DockedAiAssistant isOpen={isAssistantOpen} onOpenChange={setIsAssistantOpen} />
          </div>
        )}
        {isTriggerOpen && (
          <TriggerWorkflowModal
            onClose={() => setIsTriggerOpen(false)}
            onTriggered={(runId) => { setIsTriggerOpen(false); navigate(`/runs/${runId}`) }}
          />
        )}
      </div>
    </ActiveTemplateProvider>
    </ActiveReportProvider>
  )
}
