import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Menu,
  X,
  Mail,
  History,
  LayoutDashboard,
} from 'lucide-react';
import { ChatHistoryDrawer } from '../../features/chat/ChatHistoryDrawer';

export function GlobalNavMenu() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  // Dışarı tıklandığında menüyü kapat
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  // Sayfa değiştiğinde menüyü kapat
  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  const buttonClasses = isMenuOpen
    ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-900/40 rotate-90 scale-105'
    : 'bg-[#0a1628] hover:bg-[#132747] text-slate-200 hover:text-white border-[#1e3252] hover:border-slate-500 shadow-sm hover:scale-105 active:scale-95';

  return (
    <>
      <div ref={menuRef} className="relative inline-flex items-center">
        {/* Yuvarlak Hamburger Butonu */}
        <button
          type="button"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer border ${buttonClasses}`}
          title="Hızlı Menü"
        >
          {isMenuOpen ? (
            <X className="w-4 h-4" />
          ) : (
            <Menu className="w-4 h-4" />
          )}
        </button>

        {/* Yalnızca İkonlardan Oluşan Kapsül Menü (Koyu Marka Teması) */}
        {isMenuOpen && (
          <div className="absolute right-0 top-full mt-2.5 p-1.5 bg-[#0d1d36]/98 backdrop-blur-2xl border border-[#1e3252] rounded-2xl shadow-2xl flex flex-col items-center gap-1.5 z-50 animate-in fade-in zoom-in-95 duration-150 origin-top-right">
            {/* 1. Ana Sayfa (Dashboard) */}
            <Link
              to="/"
              title="Mevzuat Masası (Ana Sayfa)"
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                location.pathname === '/'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/40 scale-105'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
            </Link>

            {/* 2. Mail Grupları */}
            <Link
              to="/groups"
              title="Müşteri & Mail Dağıtım Grupları"
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                location.pathname === '/groups'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/40 scale-105'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`}
            >
              <Mail className="w-4 h-4" />
            </Link>

            {/* 3. Sohbet Geçmişi */}
            <button
              type="button"
              title="Sohbet Geçmişi (AI Oturumları)"
              onClick={() => {
                setIsMenuOpen(false);
                setIsHistoryDrawerOpen(true);
              }}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
            >
              <History className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Sohbet Geçmişi Slide-Over Çekmecesi */}
      <ChatHistoryDrawer
        isOpen={isHistoryDrawerOpen}
        onClose={() => setIsHistoryDrawerOpen(false)}
      />
    </>
  );
}
