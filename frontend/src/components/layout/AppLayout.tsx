import { Outlet } from 'react-router-dom';
import { DockedAiAssistant } from '../../features/chat/DockedAiAssistant';
import { GlobalNavMenu } from './GlobalNavMenu';

export function AppLayout() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-36 text-slate-800 antialiased selection:bg-blue-600 selection:text-white relative">
      {/* Üst Dış Bar - Sayfa/Hero kartlarının dışında, container ile kusursuz simetrik hizalı */}
      <header className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-1 flex items-center justify-end">
        <GlobalNavMenu />
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-2">
        <Outlet />
      </main>
      <DockedAiAssistant />
    </div>
  );
}
