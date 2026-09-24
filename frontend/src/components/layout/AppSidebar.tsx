import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { BookOpenText, ChevronLeft, ChevronRight, FileCode2, House, Menu, MessageSquareText, Play, UsersRound, X } from 'lucide-react'

interface Props {
  onNewRun: () => void
}

const items = [
  { to: '/chat', label: 'Sohbet geçmişi', icon: MessageSquareText, end: false },
  { to: '/groups', label: 'Dağıtım grupları', icon: UsersRound, end: true },
  { to: '/sources', label: 'Kaynaklar', icon: BookOpenText, end: true },
  { to: '/templates', label: 'Rapor şablonları', icon: FileCode2, end: true },
] as const

export function AppSidebar({ onNewRun }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = useLocation().pathname

  useEffect(() => {
    if (pathname.startsWith('/chat')) setExpanded(false)
  }, [pathname])

  // Keep icon columns and labels mounted at a fixed size while the rail resizes.
  const rowClass = 'flex h-12 w-full shrink-0 items-center overflow-hidden whitespace-nowrap rounded-2xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300'
  const iconClass = 'flex h-12 w-[52px] shrink-0 items-center justify-center'
  const labelClass = (visible: boolean) => `shrink-0 whitespace-nowrap pr-3 transition-opacity duration-150 motion-reduce:transition-none ${visible ? 'opacity-100 delay-75' : 'opacity-0'}`

  const navigation = (showLabels: boolean) => (
    <>
      <button
        type="button"
        onClick={() => { setMobileOpen(false); onNewRun() }}
        aria-label="Yeni tarama başlat"
        title={!showLabels ? 'Yeni tarama başlat' : undefined}
        className={`${rowClass} bg-blue-400/15 text-blue-100 hover:bg-blue-400/25 hover:text-white`}
      >
        <span className={iconClass}><Play className="h-5 w-5" /></span>
        <span aria-hidden={!showLabels} className={labelClass(showLabels)}>Yeni tarama</span>
      </button>

      <nav aria-label="Ana gezinme" className="mt-5 space-y-2">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setMobileOpen(false)}
            title={!showLabels ? label : undefined}
            aria-label={label}
            className={({ isActive }) => `${rowClass} ${isActive ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}
          >
            <span className={iconClass}><Icon className="h-5 w-5" /></span>
            <span aria-hidden={!showLabels} className={labelClass(showLabels)}>{label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  )

  return (
    <>
      <div className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
        <Link to="/" className="text-sm font-bold text-slate-900">Ana sayfa</Link>
        <button type="button" onClick={() => setMobileOpen(true)} aria-label="Menüyü aç" className="rounded-xl border border-slate-200 p-2 text-slate-700"><Menu className="h-5 w-5" /></button>
      </div>

      <aside className={`sticky top-0 hidden h-dvh shrink-0 p-3 pr-0 pt-10 transition-[width] duration-200 ease-out motion-reduce:transition-none lg:block ${expanded ? 'w-60' : 'w-[88px]'}`}>
        <div className="flex h-full flex-col rounded-[28px] bg-[#111a34] p-3 shadow-xl shadow-slate-900/15">
          {navigation(expanded)}
          <div className="mt-auto space-y-2 border-t border-white/10 pt-3">
            <NavLink to="/" end aria-label="Ana sayfa" title={!expanded ? 'Ana sayfa' : undefined} className={({ isActive }) => `${rowClass} hover:bg-white/10 ${isActive ? 'bg-white/15 text-white' : 'text-slate-300'}`}>
              <span className={iconClass}><House className="h-5 w-5" /></span>
              <span aria-hidden={!expanded} className={labelClass(expanded)}>Ana sayfa</span>
            </NavLink>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-label={expanded ? 'Menüyü daralt' : 'Menüyü genişlet'}
              aria-expanded={expanded}
              className={`${rowClass} text-slate-300 hover:bg-white/10 hover:text-white`}
            >
              <span className={iconClass}>{expanded ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}</span>
              <span aria-hidden={!expanded} className={labelClass(expanded)}>Menüyü daralt</span>
            </button>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Menüyü kapat" onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-slate-950/50" />
          <aside className="relative flex h-full w-64 flex-col bg-[#111a34] p-4 shadow-2xl">
            <button type="button" onClick={() => setMobileOpen(false)} aria-label="Menüyü kapat" className="mb-3 self-end rounded-lg p-2 text-slate-300 hover:bg-white/10"><X className="h-5 w-5" /></button>
            {navigation(true)}
            <NavLink to="/" end onClick={() => setMobileOpen(false)} className="mt-auto flex min-h-12 items-center gap-3 rounded-2xl px-3 text-sm text-slate-300 hover:bg-white/10 hover:text-white"><House className="h-5 w-5" />Ana sayfa</NavLink>
          </aside>
        </div>
      )}
    </>
  )
}
