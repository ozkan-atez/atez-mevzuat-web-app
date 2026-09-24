import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Code2, FileText, LoaderCircle, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { createReportTemplate, getReportTemplate, getTemplateCatalog, insertComponent, listPlacedComponents, listReportTemplates, movePlacedComponent, removePlacedComponent, suggestReportTemplate, updateReportTemplate } from './api'
import type { ReportTemplate, ReportTemplateSummary, TemplateCatalog, TemplateInput } from './api'
import { useRegisterActiveTemplate } from './ActiveTemplateContext'

const STARTER_HTML = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ATEZ Mevzuat Bülteni</title>
  <style>
    body { margin: 0; background: #f5f7fa; color: #1a2436; font: 14px/1.6 Arial, sans-serif; }
    .report { max-width: 760px; min-height: 100vh; margin: auto; background: white; }
    .topbar { padding: 24px 40px; background: #1b2a4a; color: white; font-weight: 700; }
    .content { display: grid; gap: 18px; padding: 40px; }
    h1 { margin: 0 0 24px; font-size: 24px; }
    .card { padding: 24px; border: 1px solid #e8ecf0; border-radius: 10px; }
  </style>
</head>
<body>
  <main class="report">
    <header class="topbar">ATEZ Mevzuat Radarı</header>
    <section class="content">
      <h1>Günlük Mevzuat Bülteni</h1>
      <article class="card">Hazır bileşen ekleyin veya AI’dan bu taslağı düzenlemesini isteyin.</article>
      <!-- ATEZ_COMPONENTS -->
    </section>
  </main>
</body>
</html>`

const EMPTY_FORM: TemplateInput = { name: '', description: null, html: STARTER_HTML }

export function TemplatesPage() {
  const [templates, setTemplates] = useState<ReportTemplateSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [revision, setRevision] = useState<number | null>(null)
  const [form, setForm] = useState<TemplateInput>(EMPTY_FORM)
  const [savedForm, setSavedForm] = useState<TemplateInput>(EMPTY_FORM)
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const formRef = useRef(form)
  formRef.current = form

  const dirty = JSON.stringify(form) !== JSON.stringify(savedForm)
  const placedComponents = listPlacedComponents(form.html)

  const refresh = useCallback(async () => {
    setTemplates(await listReportTemplates())
  }, [])

  useEffect(() => {
    void refresh().catch((caught) => setError(caught instanceof Error ? caught.message : 'Şablonlar alınamadı'))
      .finally(() => setLoading(false))
    void getTemplateCatalog().then(setCatalog).catch(() => setError('Hazır bileşenler yüklenemedi.'))
    const requestedId = new URLSearchParams(window.location.search).get('id')
    if (requestedId) void getReportTemplate(requestedId).then((template) => {
      const next = { name: template.name, description: template.description, html: template.html }
      setSelectedId(template.id); setRevision(template.revision); setForm(next); setSavedForm(next); setView('preview')
    }).catch(() => setError('Bağlantıdaki şablon açılamadı.'))
  }, [refresh])

  const addComponent = (key: string) => {
    const component = catalog?.components.find((item) => item.key === key)
    if (!component) return
    setForm((current) => ({ ...current, html: insertComponent(current.html, component) }))
    setView('preview')
    setNotice(`${component.name} taslağa eklendi.`)
  }

  const applyPreset = (key: string) => {
    const preset = catalog?.presets.find((item) => item.key === key)
    if (!preset || !catalog || (dirty && !window.confirm('Mevcut taslağı hazır düzenle değiştirmek istiyor musunuz?'))) return
    const html = preset.components.reduce((value, componentKey) => {
      const component = catalog.components.find((item) => item.key === componentKey)
      return component ? insertComponent(value, component) : value
    }, catalog.baseHtml)
    setForm((current) => ({ ...current, name: current.name || preset.name, description: current.description || preset.description, html }))
    setView('preview')
    setNotice(`${preset.name} düzeni taslağa uygulandı.`)
  }

  const applyAi = useCallback(async (request: string) => {
    if (aiBusy || !request.trim()) return
    setAiBusy(true); setError(null); setNotice(null)
    try {
      const result = await suggestReportTemplate({ ...form, message: request.trim() })
      if (JSON.stringify(formRef.current) !== JSON.stringify(form)) {
        setError('AI çalışırken taslak değişti. Son düzenlemenizi koruduk; isteği yeniden uygulayın.')
        return
      }
      setForm({ name: result.name, description: result.description, html: result.html })
      setView('preview')
      setNotice(`${result.summary} Değişiklikler taslakta; kaydetmek için “Taslağı kaydet”e basın.`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'AI şablonu düzenleyemedi.') }
    finally { setAiBusy(false) }
  }, [aiBusy, form])
  const activeTemplate = useMemo(() => ({ submitPrompt: applyAi, isPrompting: aiBusy }), [applyAi, aiBusy])
  useRegisterActiveTemplate(activeTemplate)

  const canLeave = () => !dirty || window.confirm('Kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?')

  const select = async (id: string) => {
    if (id === selectedId || !canLeave()) return
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const template: ReportTemplate = await getReportTemplate(id)
      const next = { name: template.name, description: template.description, html: template.html }
      setSelectedId(template.id)
      setRevision(template.revision)
      setForm(next)
      setSavedForm(next)
      setView('preview')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Şablon açılamadı')
    } finally {
      setLoading(false)
    }
  }

  const create = () => {
    if (!canLeave()) return
    setSelectedId(null)
    setRevision(null)
    setForm(EMPTY_FORM)
    setSavedForm(EMPTY_FORM)
    setView('preview')
    setError(null)
    setNotice(null)
  }

  const save = async () => {
    if (saving || !form.name.trim() || !form.html.trim()) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const input = { name: form.name.trim(), description: form.description?.trim() || null, html: form.html }
      const template = selectedId && revision !== null
        ? await updateReportTemplate(selectedId, { ...input, revision })
        : await createReportTemplate(input)
      const next = { name: template.name, description: template.description, html: template.html }
      setSelectedId(template.id)
      setRevision(template.revision)
      setForm(next)
      setSavedForm(next)
      setNotice('Şablon taslağı kaydedildi.')
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Şablon kaydedilemedi')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Rapor şablonları</h1>
          <p className="mt-1 text-sm text-slate-500">Alttaki asistanla tasarlayın, hazır bileşen ekleyin ve sonucu burada önizleyin.</p>
        </div>
        <button type="button" onClick={create} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700">
          <Plus className="h-4 w-4" />Yeni şablon
        </button>
      </header>

      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Şablonlar burada taslak olarak saklanır. Mevcut raporlar ve otomatik bülten üretimi, sistemin Bülten v2 şablonunu kullanmaya devam eder.
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}

      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="self-start rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <h2 className="px-3 pb-3 pt-2 text-xs font-bold uppercase tracking-widest text-slate-500">Şablonlar</h2>
          <div className="mb-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">Bülten v2</span>
              <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">Sistem</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">Güncel bültenlerin kullandığı şablon</p>
          </div>
          {loading && <p className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Yükleniyor…</p>}
          {!loading && templates.length === 0 && <p className="px-3 py-3 text-xs text-slate-500">Henüz kayıtlı taslak yok.</p>}
          <div className="space-y-1">
            {templates.map((template) => (
              <button key={template.id} type="button" onClick={() => void select(template.id)} aria-current={selectedId === template.id ? 'page' : undefined}
                className={`flex w-full items-start gap-2 rounded-xl px-3 py-3 text-left transition ${selectedId === template.id ? 'bg-[#eaf0fa] text-[#1b2a4a]' : 'text-slate-700 hover:bg-slate-50'}`}>
                <FileText className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0"><span className="block truncate text-sm font-semibold">{template.name}</span><span className="mt-0.5 block text-xs opacity-70">Taslak · s{template.revision}</span></span>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">{selectedId ? 'Şablonu düzenle' : 'Yeni şablon'}</h2>
              <p className="mt-0.5 text-xs text-slate-500">{selectedId ? `Taslak sürümü ${revision}` : 'Yeni bir HTML taslağı oluşturun'}</p>
            </div>
            <button type="button" onClick={() => void save()} disabled={saving || !form.name.trim() || !form.html.trim() || (!!selectedId && !dirty)}
              className="inline-flex items-center gap-2 rounded-xl bg-[#1b2a4a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2b406a] disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? 'Kaydediliyor…' : 'Taslağı kaydet'}
            </button>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-700">Şablon adı
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={120} placeholder="Örn. Yönetici bülteni"
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500" />
            </label>
            <label className="block text-xs font-semibold text-slate-700">Açıklama
              <input value={form.description ?? ''} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={500} placeholder="Bu şablonun kullanım amacı"
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500" />
            </label>
          </div>
          <div className="space-y-4 border-t border-slate-200 px-5 py-5">
            <p className="flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2.5 text-xs text-indigo-900"><Sparkles className="h-4 w-4 shrink-0" />Şablonu AI ile değiştirmek için alttaki asistanı kullanın. Sonuç önizlemede görünür.</p>
            <div><h3 className="text-sm font-bold text-slate-900">Hazır düzenler</h3><div className="mt-2 flex flex-wrap gap-2">{catalog?.presets.map((preset) => <button key={preset.key} type="button" onClick={() => applyPreset(preset.key)} title={preset.description} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50">{preset.name}</button>)}</div></div>
            <details className="rounded-xl border border-slate-200 bg-white px-4 py-3"><summary className="cursor-pointer text-sm font-bold text-slate-900">Hazır bileşenler · {catalog?.components.length ?? 0}</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{catalog?.components.map((component) => <button key={component.key} type="button" onClick={() => addComponent(component.key)} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-left hover:border-indigo-300 hover:bg-indigo-50"><span><span className="block text-xs font-semibold text-slate-800">{component.name}</span><span className="mt-0.5 block text-[11px] text-slate-500">{component.description}</span></span><Plus className="h-4 w-4 shrink-0 text-indigo-600" /></button>)}</div></details>
            {placedComponents.length > 0 && <div><h3 className="text-sm font-bold text-slate-900">Taslağa eklenen bileşenler</h3><ol className="mt-2 space-y-1.5">{placedComponents.map((placed, index) => <li key={placed.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"><span className="min-w-0 truncate font-medium text-slate-700">{index + 1}. {catalog?.components.find((item) => item.key === placed.key)?.name ?? placed.key}</span><div className="flex shrink-0 items-center gap-1"><button type="button" aria-label={`${index + 1}. bileşeni yukarı taşı`} disabled={index === 0} onClick={() => setForm((current) => ({ ...current, html: movePlacedComponent(current.html, placed.id, -1) }))} className="rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" aria-label={`${index + 1}. bileşeni aşağı taşı`} disabled={index === placedComponents.length - 1} onClick={() => setForm((current) => ({ ...current, html: movePlacedComponent(current.html, placed.id, 1) }))} className="rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button><button type="button" aria-label={`${index + 1}. bileşeni kaldır`} onClick={() => setForm((current) => ({ ...current, html: removePlacedComponent(current.html, placed.id) }))} className="rounded p-1 text-rose-600 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /></button></div></li>)}</ol></div>}
          </div>
          <div className="flex items-center gap-1 border-y border-slate-200 bg-slate-50 px-5 py-2" role="tablist" aria-label="Şablon görünümü">
            <button type="button" role="tab" aria-selected={view === 'code'} onClick={() => setView('code')} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${view === 'code' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}><Code2 className="h-4 w-4" />HTML</button>
            <button type="button" role="tab" aria-selected={view === 'preview'} onClick={() => setView('preview')} className={`rounded-lg px-3 py-2 text-xs font-semibold ${view === 'preview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Önizleme</button>
          </div>
          {view === 'code' ? (
            <label className="block p-5 text-xs font-semibold text-slate-700">HTML içeriği
              <textarea value={form.html} onChange={(event) => setForm({ ...form, html: event.target.value })} spellCheck={false} aria-label="HTML içeriği"
                className="mt-2 h-[560px] w-full resize-y rounded-xl border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-blue-500" />
            </label>
          ) : (
            <div className="bg-slate-100 p-4 sm:p-6">
              <iframe title="Şablon önizlemesi" sandbox="" srcDoc={form.html} className="h-[560px] w-full rounded-xl border border-slate-200 bg-white" />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
