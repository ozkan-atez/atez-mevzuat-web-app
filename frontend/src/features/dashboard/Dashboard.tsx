import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { TriggerWorkflowModal } from './TriggerWorkflowModal';
import { RecentScanRuns } from './RecentScanRuns';
import { ScanScheduleStatus, ScanScheduleTimeline } from './ScanScheduleTimeline';
import { useScanSchedule } from './useScanSchedule';
import atezLogo from '../../assets/atez-logo.png';

export function Dashboard() {
  const navigate = useNavigate();
  const [isTriggerOpen, setIsTriggerOpen] = useState(false);
  const schedule = useScanSchedule();

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <section className="hero-gradient rounded-3xl p-6 sm:p-10 lg:p-12 text-white shadow-2xl border border-[#1a2e4d] relative overflow-hidden" data-purpose="hero-banner">
        {/* Ambient light effect */}
        <div className="absolute -right-20 -top-20 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
        
        {/* Top Row: Brand, Live Schedule Status & Header Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 relative z-10">
          {/* Brand + live schedule status */}
          <div className="flex flex-wrap items-center gap-4 sm:gap-5">
            <img
              src={atezLogo}
              alt="ATEZ Yazılım Teknolojileri"
              className="h-7 sm:h-8 w-auto shrink-0"
            />
            <span className="hidden sm:block h-9 w-px bg-slate-700/70" aria-hidden="true"></span>
            <ScanScheduleStatus schedule={schedule} />
          </div>
          
          {/* Hero Actions */}
          <div className="flex items-center gap-3 relative z-10">
            <Link
              to="/groups"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-slate-200 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 transition duration-150 active:scale-95 shadow-sm"
            >
              <Users className="w-4 h-4 text-slate-300" />
              <span>Dağıtım Grupları</span>
            </Link>
            <button
              onClick={() => setIsTriggerOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 border border-blue-400/30 transition duration-150 active:scale-95 shadow-lg shadow-blue-900/40 cursor-pointer"
              type="button"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"></path>
              </svg>
              <span>Yeni Tarama Başlat</span>
            </button>
          </div>
        </div>
        
        {/* Main Title and Description */}
        <div className="max-w-4xl space-y-4 mb-10 relative z-10">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Resmi Gazete Gümrük & Dış Ticaret Takip Otomasyonu
          </h1>
          <p className="text-base sm:text-lg text-slate-300 leading-relaxed font-normal">
            Günlük T.C. Resmi Gazete yayınlarını tarar, gümrük, tarife, ithalat/ihracat ve dış ticaret mevzuat değişikliklerini yapay zeka ajanları ile analiz ederek yönetici bülteni oluşturur ve Microsoft Graph üzerinden e-posta iletir.
          </p>
        </div>
        
        <ScanScheduleTimeline schedule={schedule} />
      </section>

      {/* KPI Metrics Section */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6" data-purpose="kpi-overview">
        {/* KPI 1: Toplam Tarama */}
        <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/80 p-6 shadow-sm hover:shadow-xl hover:shadow-blue-500/10 hover:border-blue-400/40 transition-all duration-300 relative overflow-hidden group hover:-translate-y-1">
          <div className="absolute -top-10 -right-10 w-28 h-28 bg-gradient-to-br from-blue-500/15 to-indigo-500/0 rounded-full blur-2xl pointer-events-none group-hover:scale-125 transition-transform duration-500"></div>
          <div className="flex items-center justify-between mb-4 relative z-10">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[11px] font-mono font-bold tracking-wider text-slate-500 uppercase">TOPLAM TARAMA</span>
            </div>
            <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 group-hover:text-blue-600 group-hover:bg-blue-50/50 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M12 21a9 9 0 100-18 9 9 0 000 18z" strokeLinecap="round" strokeLinejoin="round"></path>
                <path d="M12 7a5 5 0 015 5" strokeLinecap="round" strokeLinejoin="round"></path>
                <circle cx="12" cy="12" fill="currentColor" r="2"></circle>
              </svg>
            </div>
          </div>
          <div className="flex items-baseline justify-between mb-3 relative z-10">
            <div className="text-4xl font-extrabold tracking-tight text-slate-900 font-sans">7</div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
              <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" strokeLinecap="round" strokeLinejoin="round"></path>
              </svg>
              +2 bugün
            </span>
          </div>
          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden flex gap-0.5 mb-3 relative z-10">
            <div className="bg-blue-600 h-full rounded-l-full" style={{ width: '57.1%' }} title="4 Otomatik"></div>
            <div className="bg-indigo-600 h-full rounded-r-full" style={{ width: '42.9%' }} title="3 Manuel"></div>
          </div>
          <div className="border-t border-slate-100 pt-3 flex items-center justify-between text-[11px] font-mono text-slate-500 relative z-10">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>4 Otomatik</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>3 Manuel</span>
            </div>
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold text-[10px]">
              %100 Başarı
            </span>
          </div>
        </div>

        {/* KPI 2: Onay Bekleyenler */}
        <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/80 p-6 shadow-sm hover:shadow-xl hover:shadow-amber-500/10 hover:border-amber-400/40 transition-all duration-300 relative overflow-hidden group hover:-translate-y-1">
          <div className="absolute -top-10 -right-10 w-28 h-28 bg-gradient-to-br from-amber-500/15 to-orange-500/0 rounded-full blur-2xl pointer-events-none group-hover:scale-125 transition-transform duration-500"></div>
          <div className="flex items-center justify-between mb-4 relative z-10">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
              <span className="text-[11px] font-mono font-bold tracking-wider text-slate-500 uppercase">ONAY BEKLEYENLER</span>
            </div>
            <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 group-hover:text-amber-600 group-hover:bg-amber-50/50 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round"></path>
              </svg>
            </div>
          </div>
          <div className="flex items-baseline justify-between mb-3 relative z-10">
            <div className="text-4xl font-extrabold tracking-tight text-slate-900 font-sans">2</div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
              +1 yeni tebliğ
            </span>
          </div>
          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden flex gap-0.5 mb-3 relative z-10">
            <div className="bg-amber-500 h-full rounded-l-full" style={{ width: '50%' }} title="1 Tebliğ"></div>
            <div className="bg-orange-500 h-full rounded-r-full" style={{ width: '50%' }} title="1 Karar"></div>
          </div>
          <div className="border-t border-slate-100 pt-3 flex items-center justify-between text-[11px] font-mono text-slate-500 relative z-10">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>1 Tebliğ</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>1 Karar</span>
            </div>
            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200/60 font-semibold text-[10px]">
              Kritik İnceleme
            </span>
          </div>
        </div>

        {/* KPI 3: Hazırlanan Bülten */}
        <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/80 p-6 shadow-sm hover:shadow-xl hover:shadow-emerald-500/10 hover:border-emerald-400/40 transition-all duration-300 relative overflow-hidden group hover:-translate-y-1">
          <div className="absolute -top-10 -right-10 w-28 h-28 bg-gradient-to-br from-emerald-500/15 to-teal-500/0 rounded-full blur-2xl pointer-events-none group-hover:scale-125 transition-transform duration-500"></div>
          <div className="flex items-center justify-between mb-4 relative z-10">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="text-[11px] font-mono font-bold tracking-wider text-slate-500 uppercase">HAZIRLANAN BÜLTEN</span>
            </div>
            <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 group-hover:text-emerald-600 group-hover:bg-emerald-50/50 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" strokeLinecap="round" strokeLinejoin="round"></path>
              </svg>
            </div>
          </div>
          <div className="flex items-baseline justify-between mb-3 relative z-10">
            <div className="text-4xl font-extrabold tracking-tight text-slate-900 font-sans">9</div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
              <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" strokeLinecap="round" strokeLinejoin="round"></path>
              </svg>
              +4 bugün
            </span>
          </div>
          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden flex gap-0.5 mb-3 relative z-10">
            <div className="bg-emerald-500 h-full rounded-l-full" style={{ width: '77.8%' }} title="7 Otomatik Dağıtım"></div>
            <div className="bg-teal-500 h-full rounded-r-full" style={{ width: '22.2%' }} title="2 Manuel Dağıtım"></div>
          </div>
          <div className="border-t border-slate-100 pt-3 flex items-center justify-between text-[11px] font-mono text-slate-500 relative z-10">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>7 Otomatik</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-teal-500"></span>2 Manuel</span>
            </div>
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold text-[10px]">
              Yönetici Özeti
            </span>
          </div>
        </div>

        {/* KPI 4: İletilen Bildirim */}
        <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/80 p-6 shadow-sm hover:shadow-xl hover:shadow-indigo-500/10 hover:border-indigo-400/40 transition-all duration-300 relative overflow-hidden group hover:-translate-y-1">
          <div className="absolute -top-10 -right-10 w-28 h-28 bg-gradient-to-br from-indigo-500/15 to-purple-500/0 rounded-full blur-2xl pointer-events-none group-hover:scale-125 transition-transform duration-500"></div>
          <div className="flex items-center justify-between mb-4 relative z-10">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
              <span className="text-[11px] font-mono font-bold tracking-wider text-slate-500 uppercase">İLETİLEN BİLDİRİM</span>
            </div>
            <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 group-hover:text-indigo-600 group-hover:bg-indigo-50/50 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" strokeLinecap="round" strokeLinejoin="round"></path>
              </svg>
            </div>
          </div>
          <div className="flex items-baseline justify-between mb-3 relative z-10">
            <div className="text-4xl font-extrabold tracking-tight text-slate-900 font-sans">9</div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              %100 İletildi
            </span>
          </div>
          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden flex gap-0.5 mb-3 relative z-10">
            <div className="bg-indigo-600 h-full rounded-l-full" style={{ width: '66.7%' }} title="6 Yönetici Grubu"></div>
            <div className="bg-purple-500 h-full rounded-r-full" style={{ width: '33.3%' }} title="3 Operasyon Ekibi"></div>
          </div>
          <div className="border-t border-slate-100 pt-3 flex items-center justify-between text-[11px] font-mono text-slate-500 relative z-10">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>6 Yönetici</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>3 Operasyon</span>
            </div>
            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/60 font-semibold text-[10px]">
              MS Graph Aktif
            </span>
          </div>
        </div>
      </section>

      <RecentScanRuns />

      {isTriggerOpen && (
        <TriggerWorkflowModal
          onClose={() => setIsTriggerOpen(false)}
          onTriggered={(runId) => navigate(`/runs/${runId}`)}
        />
      )}
    </div>
  )
}
