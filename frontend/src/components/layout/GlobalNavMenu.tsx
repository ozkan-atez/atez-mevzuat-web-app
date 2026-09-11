import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Menu,
  X,
  Mail,
  History,
  LayoutDashboard,
  ShieldCheck,
  ChevronRight,
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

  return (
    <>
      <div ref={menuRef} className="fixed top-5 right-6 z-40">
        {/* Yuvarlak Hamburger Butonu */}
        <button
          type="button"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="relative w-11 h-11 rounded-full bg-slate-900/90 hover:bg-slate-900 text-white shadow-xl shadow-slate-950/20 border border-slate-700/60 backdrop-blur-md flex items-center justify-center cursor-pointer transition-all hover:scale-105 active:scale-95 group focus:outline-none"
          title="Menü"
        >
          {isMenuOpen ? (
            <X className="w-5 h-5 text-slate-200 transition-transform duration-200 rotate-90" />
          ) : (
            <>
              <Menu className="w-5 h-5 text-slate-200 group-hover:text-white transition-colors" />
              {/* Canlı Sistem Bildirim Noktası */}
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-900 animate-pulse" />
            </>
          )}
        </button>

        {/* Aşağıya Doğru Açılan Menü Dropdown */}
        {isMenuOpen && (
          <div className="absolute right-0 mt-3 w-72 bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-2xl shadow-2xl p-2.5 space-y-1 animate-in fade-in zoom-in-95 duration-150 origin-top-right">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                ATEZ MEVZUAT RADARI
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Çevrimiçi
              </span>
            </div>

            {/* 1. Ana Sayfa */}
            <Link
              to="/"
              className={`flex items-center justify-between p-2.5 rounded-xl text-xs font-semibold transition-all group ${
                location.pathname === '/'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-blue-100/70 text-blue-600 flex items-center justify-center">
                  <LayoutDashboard className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold">Mevzuat Masası</div>
                  <div className="text-[10px] text-slate-400 font-normal">Canlı takip ve bültenler</div>
                </div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
            </Link>

            {/* 2. Mail Grupları */}
            <Link
              to="/groups"
              className={`flex items-center justify-between p-2.5 rounded-xl text-xs font-semibold transition-all group ${
                location.pathname === '/groups'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-100/70 text-emerald-600 flex items-center justify-center">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold">Müşteri & Mail Grupları</div>
                  <div className="text-[10px] text-slate-400 font-normal">Dağıtım listelerini yönet</div>
                </div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
            </Link>

            {/* 3. Sohbet Geçmişi */}
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                setIsHistoryDrawerOpen(true);
              }}
              className="w-full flex items-center justify-between p-2.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100/80 hover:text-slate-900 transition-all cursor-pointer group text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-indigo-100/70 text-indigo-600 flex items-center justify-center">
                  <History className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold">Sohbet Geçmişi</div>
                  <div className="text-[10px] text-slate-400 font-normal">Önceki AI oturumları & loglar</div>
                </div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
            </button>

            {/* Footer Bilgisi */}
            <div className="pt-2 border-t border-slate-100 px-3 pb-1 flex items-center justify-between text-[10px] text-slate-400">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-slate-400" />
                <span>4x Günlük Cron Aktif</span>
              </span>
              <span>v2.0.4</span>
            </div>
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
