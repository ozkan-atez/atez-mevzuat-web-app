import { useEffect, useState } from 'react'
import { Check, LoaderCircle, Search, X } from 'lucide-react'
import { addSourceSite, decideSourceEndpoint, discoverSourceSite, listSourceSites } from './discoveryApi'
import type { SourceSite } from './discoveryApi'
import { defaultSourceSites } from './defaultSourceSites'

function siteName(site: SourceSite): string {
  return site.name ?? defaultSourceSites.find((item) => item.url === site.baseUrl)?.name ?? new URL(site.baseUrl).hostname
}

export function DiscoveryPanel({ onActivate }: { onActivate: () => void }) {
  const [sites, setSites] = useState<SourceSite[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const selected = sites.find((site) => site.id === selectedId)

  const reload = async () => {
    const result = await listSourceSites()
    setSites(result)
    setSelectedId((current) => current ?? result[0]?.id ?? null)
  }
  useEffect(() => { void reload().catch((caught) => setError(caught instanceof Error ? caught.message : 'Siteler yüklenemedi.')) }, [])

  const discover = async () => {
    if (!selected || busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = await discoverSourceSite(selected.id)
      await reload()
      setNotice(`${result.examined} bağlantı incelendi, ${result.suggested} öneri bulundu. ${result.aiUsed ? 'Gemini değerlendirdi.' : 'Anahtar kelime eşleşmesi kullanıldı.'}`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Keşif tamamlanamadı.') }
    finally { setBusy(false) }
  }

  const add = async () => {
    if (!title.trim() || !url.trim() || busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const site = await addSourceSite({ title: title.trim(), url: url.trim() })
      await reload(); setSelectedId(site.id); setTitle(''); setUrl('')
      setNotice('Site eklendi; bağlantıları inceleniyor.')
      try {
        const result = await discoverSourceSite(site.id)
        await reload()
        setNotice(`${result.examined} bağlantı incelendi, ${result.suggested} öneri bulundu. ${result.aiUsed ? 'Gemini değerlendirdi.' : 'Anahtar kelime eşleşmesi kullanıldı.'}`)
      } catch (caught) { setError(`Site eklendi, ancak bağlantı keşfi tamamlanamadı: ${caught instanceof Error ? caught.message : 'Yeniden deneyin.'}`) }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Site eklenemedi.') }
    finally { setBusy(false) }
  }

  const decide = async (endpointId: string, decision: 'activate' | 'reject') => {
    if (!selected || busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      await decideSourceEndpoint(selected.id, endpointId, decision)
      await reload()
      if (decision === 'activate') { onActivate(); setNotice('Bağlantı sohbet ve tarama kaynaklarına eklendi.') }
      else setNotice('Öneri reddedildi.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Öneri işlenemedi.') }
    finally { setBusy(false) }
  }

  return <section aria-label="Kaynak keşfi" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-sm font-bold text-slate-900">Kaynak bağlantılarını keşfet</h2><p className="mt-1 text-xs text-slate-500">Öneriler onaylanana kadar sohbet ve taramada kullanılmaz.</p></div>
      <button type="button" onClick={() => void discover()} disabled={!selected || busy} className="inline-flex items-center gap-2 rounded-xl bg-[#1b2a4a] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Keşfet</button>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700">{notice}</p>}
    <div className="mt-4 flex flex-wrap gap-2">{sites.map((site) => <button key={site.id} type="button" onClick={() => setSelectedId(site.id)} aria-pressed={selectedId === site.id} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${selectedId === site.id ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{siteName(site)}</button>)}</div>
    {selected && <div className="mt-4 space-y-2">
      <p className="text-xs text-slate-500">{selected.baseUrl} · {selected.authorityType === 'OFFICIAL' ? 'Resmî kaynak' : selected.authorityType === 'PROFESSIONAL' ? 'Meslek kuruluşu' : selected.authorityType === 'UNVERIFIED' ? 'Doğrulanmamış kaynak' : 'Diğer kaynak'}</p>
      {selected.endpoints.filter((item) => item.status !== 'REJECTED').length === 0 && <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Henüz bağlantı önerisi yok.</p>}
      {selected.endpoints.filter((item) => item.status !== 'REJECTED').map((endpoint) => <div key={endpoint.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
        <div className="min-w-0 flex-1"><a href={endpoint.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs font-semibold text-blue-700 hover:underline">{endpoint.title}</a><span className="block truncate text-[11px] text-slate-500">{endpoint.url}</span></div>
        {endpoint.status === 'ACTIVE' ? <span className="text-xs font-semibold text-emerald-700">Etkin</span> : <div className="flex gap-1"><button type="button" onClick={() => void decide(endpoint.id, 'activate')} disabled={busy} aria-label={`${endpoint.title} bağlantısını etkinleştir`} className="rounded-lg bg-emerald-50 p-2 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"><Check className="h-4 w-4" /></button><button type="button" onClick={() => void decide(endpoint.id, 'reject')} disabled={busy} aria-label={`${endpoint.title} önerisini reddet`} className="rounded-lg bg-slate-50 p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X className="h-4 w-4" /></button></div>}
      </div>)}
    </div>}
    <div className="mt-4 grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_2fr_auto]">
      <input aria-label="Yeni site adı" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Yeni site adı" className="min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-xs" />
      <input aria-label="Yeni site adresi" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." className="min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-xs" />
      <button type="button" onClick={() => void add()} disabled={busy || !title.trim() || !url.trim()} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Site ekle</button>
    </div>
  </section>
}
