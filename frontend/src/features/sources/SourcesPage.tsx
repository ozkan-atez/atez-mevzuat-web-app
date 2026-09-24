import { useEffect, useMemo, useState } from 'react'
import { BookOpenText, ExternalLink, LoaderCircle, Plus, RefreshCw, Save, Search, Trash2 } from 'lucide-react'
import { createManagedSource, deactivateManagedSource, listManagedSources, refreshManagedSource, updateManagedSource } from './api'
import type { ManagedSource, ManagedSourceInput } from './api'
import { DiscoveryPanel } from './DiscoveryPanel'

const empty: ManagedSourceInput = { url: '', title: '', description: null, keywords: null, useInChat: true, useInRuns: true, isActive: true }

function inputFrom(source: ManagedSource): ManagedSourceInput {
  return {
    url: source.url, title: source.title, description: source.description, keywords: source.keywords,
    useInChat: source.useInChat, useInRuns: source.useInRuns, isActive: source.isActive,
  }
}

export function SourcesPage() {
  const [sources, setSources] = useState<ManagedSource[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<ManagedSourceInput>(empty)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const selected = sources.find((source) => source.id === selectedId) ?? null
  const filtered = useMemo(() => sources.filter((source) => `${source.title} ${source.url} ${source.description ?? ''} ${source.keywords ?? ''}`.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR'))), [sources, query])

  useEffect(() => {
    void listManagedSources().then(setSources).catch((caught) => setError(caught instanceof Error ? caught.message : 'Kaynaklar yüklenemedi.')).finally(() => setLoading(false))
  }, [])

  const replace = (source: ManagedSource) => {
    setSources((items) => [source, ...items.filter((item) => item.id !== source.id)])
    setSelectedId(source.id)
    setForm(inputFrom(source))
  }

  const save = async () => {
    if (busy || !form.url.trim() || !form.title.trim()) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const payload = { ...form, url: form.url.trim(), title: form.title.trim(), description: form.description?.trim() || null, keywords: form.keywords?.trim() || null }
      const saved = selectedId ? await updateManagedSource(selectedId, payload) : await createManagedSource(payload)
      replace(saved)
      setNotice(saved.fetchError ? 'Bağlantı kaydedildi; içeriği henüz okunamadı.' : 'Kaynak kaydedildi ve içeriği kullanıma hazır.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Kaynak kaydedilemedi.') }
    finally { setBusy(false) }
  }

  const refresh = async () => {
    if (!selectedId || busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const source = await refreshManagedSource(selectedId)
      replace(source)
      setNotice(source.fetchError ? 'Kaynak bağlantısına erişildi ancak içerik okunamadı.' : 'Kaynak içeriği yenilendi.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Kaynak yenilenemedi.') }
    finally { setBusy(false) }
  }

  const deactivate = async () => {
    if (!selectedId || busy || !window.confirm('Bu kaynağı sohbet ve tarama kullanımından kaldırmak istiyor musunuz?')) return
    setBusy(true); setError(null); setNotice(null)
    try {
      await deactivateManagedSource(selectedId)
      setSources((items) => items.map((item) => item.id === selectedId ? { ...item, isActive: false, useInChat: false, useInRuns: false } : item))
      setForm((value) => ({ ...value, isActive: false, useInChat: false, useInRuns: false }))
      setNotice('Kaynak devre dışı bırakıldı.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Kaynak kaldırılamadı.') }
    finally { setBusy(false) }
  }

  return <div className="space-y-5 pb-10">
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Kaynaklar</h1>
        <p className="mt-1 text-sm text-slate-500">Bağlantıları ekleyin; okunabilen içerikleri sohbet ve tarama analizlerinde kullanın.</p>
      </div>
      <button type="button" onClick={() => { setSelectedId(null); setForm(empty); setError(null); setNotice(null) }} className="inline-flex items-center gap-2 rounded-xl bg-[#1b2a4a] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2b406a]"><Plus className="h-4 w-4" />Yeni kaynak</button>
    </header>

    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}

    <DiscoveryPanel onActivate={() => { void listManagedSources().then(setSources).catch(() => undefined) }} />

    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="self-start rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-500"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kaynak ara" aria-label="Kaynak ara" className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none" /></label>
        {loading && <p className="flex items-center gap-2 px-3 py-5 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />Yükleniyor…</p>}
        {!loading && filtered.length === 0 && <p className="px-3 py-5 text-sm text-slate-500">{query ? 'Eşleşen kaynak yok.' : 'Henüz kaynak eklenmedi.'}</p>}
        <div className="mt-2 space-y-1">{filtered.map((source) => <button key={source.id} type="button" onClick={() => { setSelectedId(source.id); setForm(inputFrom(source)); setError(null); setNotice(null) }} aria-current={selectedId === source.id ? 'page' : undefined} className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition ${selectedId === source.id ? 'bg-[#eaf0fa] text-[#1b2a4a]' : 'text-slate-700 hover:bg-slate-50'}`}>
          <BookOpenText className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0"><span className="block truncate text-sm font-semibold">{source.title}</span><span className="mt-1 block truncate text-xs opacity-70">{new URL(source.url).hostname}</span><span className={`mt-1 block text-[11px] ${!source.isActive ? 'text-slate-400' : source.contentText ? 'text-emerald-700' : 'text-amber-700'}`}>{!source.isActive ? 'Devre dışı' : source.contentText ? 'İçerik hazır' : 'İçerik okunamadı'}</span></span>
        </button>)}</div>
      </aside>

      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div><h2 className="font-bold text-slate-900">{selected ? 'Kaynağı düzenle' : 'Yeni kaynak ekle'}</h2><p className="mt-1 text-xs text-slate-500">Bağlantıdaki HTML veya PDF metni okunur; kaynak metni dışında bir işlem yapılmaz.</p></div>
          <div className="flex items-center gap-2">
            {selected && <button type="button" onClick={() => void refresh()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className="h-4 w-4" />İçeriği yenile</button>}
            <button type="button" onClick={() => void save()} disabled={busy || !form.title.trim() || !form.url.trim()} className="inline-flex items-center gap-2 rounded-xl bg-[#1b2a4a] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2b406a] disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{busy ? 'İşleniyor…' : 'Kaydet'}</button>
          </div>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Kaynak bağlantısı<input type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://..." maxLength={2000} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500" /></label>
          <label className="text-xs font-semibold text-slate-700">Kaynak adı<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Örn. Ticaret Bakanlığı duyuruları" maxLength={200} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500" /></label>
          <label className="text-xs font-semibold text-slate-700">Anahtar kelimeler<input value={form.keywords ?? ''} onChange={(event) => setForm({ ...form, keywords: event.target.value })} placeholder="Örn. ithalat, gümrük" maxLength={500} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500" /><span className="mt-1 block font-normal text-slate-500">Virgülle ayırın. Boşsa tüm tarama analizlerinde kullanılabilir.</span></label>
          <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Açıklama<textarea value={form.description ?? ''} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={2} maxLength={1000} placeholder="Kaynağın kapsamı" className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500" /></label>
          <div className="flex flex-wrap gap-4 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />Etkin</label>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.useInChat} onChange={(event) => setForm({ ...form, useInChat: event.target.checked })} />Sohbette kullan</label>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.useInRuns} onChange={(event) => setForm({ ...form, useInRuns: event.target.checked })} />Taramalarda kullan</label>
          </div>
        </div>
        {selected && <div className="border-t border-slate-200 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-bold text-slate-900">Okunan içerik</h3><div className="flex items-center gap-3"><a href={selected.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"><ExternalLink className="h-3.5 w-3.5" />Bağlantıyı aç</a>{selected.isActive && <button type="button" onClick={() => void deactivate()} disabled={busy} className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:underline disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Devre dışı bırak</button>}</div></div>
          {selected.fetchError && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{selected.fetchError}</p>}
          {selected.contentText ? <p className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-700">{selected.contentText}</p> : <p className="mt-3 text-sm text-slate-500">Okunabilir metin bulunamadı. Bağlantıyı kontrol edip içeriği yenileyin.</p>}
          {selected.fetchedAt && <p className="mt-2 text-xs text-slate-500">Son okuma: {new Date(selected.fetchedAt).toLocaleString('tr-TR')}</p>}
        </div>}
      </section>
    </div>
  </div>
}
