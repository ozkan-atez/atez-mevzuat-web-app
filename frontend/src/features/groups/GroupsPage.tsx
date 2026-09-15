import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Check, LoaderCircle, Pencil, Plus, Trash2, Users, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { createCustomerGroup, deleteCustomerGroup, listCustomerGroups, parseEmailList, updateCustomerGroup } from '../delivery/api'
import type { CustomerGroup } from '../delivery/types'

interface FormState {
  name: string
  description: string
  emails: string
}

const EMPTY_FORM: FormState = { name: '', description: '', emails: '' }

export function GroupsPage() {
  const [groups, setGroups] = useState<CustomerGroup[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [isSaving, setIsSaving] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      setGroups(await listCustomerGroups())
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Müşteri grupları alınamadı')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const startCreate = () => { setEditingId('new'); setForm(EMPTY_FORM) }
  const startEdit = (group: CustomerGroup) => {
    setEditingId(group.id)
    setForm({ name: group.name, description: group.description ?? '', emails: group.emails.join(', ') })
  }
  const cancel = () => { setEditingId(null); setForm(EMPTY_FORM) }

  const save = async () => {
    const emails = parseEmailList(form.emails)
    if (!form.name.trim() || emails.length === 0 || isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      const payload = { name: form.name.trim(), description: form.description.trim() || null, emails }
      if (editingId === 'new') await createCustomerGroup(payload)
      else if (editingId) await updateCustomerGroup(editingId, payload)
      cancel()
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Grup kaydedilemedi')
    } finally {
      setIsSaving(false)
    }
  }

  const remove = async (group: CustomerGroup) => {
    if (!window.confirm(`"${group.name}" grubu silinsin mi?`)) return
    setError(null)
    try {
      await deleteCustomerGroup(group.id)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Grup silinemedi')
    }
  }

  const toggleActive = async (group: CustomerGroup) => {
    setError(null)
    try {
      await updateCustomerGroup(group.id, { isActive: !group.isActive })
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Grup güncellenemedi')
    }
  }

  return (
    <div className="space-y-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link to="/" aria-label="Ana sayfaya dön" className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" /></Link>
          <div>
            <h1 className="flex items-center gap-2 text-base font-bold text-slate-900"><Users className="h-4 w-4" />Müşteri Grupları</h1>
            <p className="mt-0.5 text-xs text-slate-500">Bülten dağıtımında kullanılacak e-posta listeleri.</p>
          </div>
        </div>
        <button type="button" onClick={startCreate} disabled={editingId === 'new'} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          <Plus className="h-4 w-4" />Yeni Grup
        </button>
      </header>

      {error && <p className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-medium text-red-700">{error}</p>}

      {editingId === 'new' && <GroupForm form={form} setForm={setForm} onSave={() => void save()} onCancel={cancel} isSaving={isSaving} />}

      {isLoading && <p className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />Gruplar yükleniyor…</p>}

      {!isLoading && groups.length === 0 && editingId !== 'new' && (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Henüz müşteri grubu yok. &lsquo;Yeni Grup&rsquo; ile ekleyebilirsiniz.</p>
      )}

      <div className="space-y-3">
        {groups.map((group) => editingId === group.id
          ? <GroupForm key={group.id} form={form} setForm={setForm} onSave={() => void save()} onCancel={cancel} isSaving={isSaving} />
          : (
            <article key={group.id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  {group.name}
                  <span className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold ${group.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {group.isActive ? 'Aktif' : 'Pasif'}
                  </span>
                </h2>
                {group.description && <p className="mt-1 text-xs text-slate-500">{group.description}</p>}
                <p className="mt-2 break-words text-xs text-slate-600">{group.emails.join(', ')}</p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => void toggleActive(group)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                  {group.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                </button>
                <button type="button" onClick={() => startEdit(group)} aria-label={`${group.name} grubunu düzenle`} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => void remove(group)} aria-label={`${group.name} grubunu sil`} className="rounded-xl border border-slate-200 p-2 text-red-500 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </article>
          ))}
      </div>
    </div>
  )
}

function GroupForm({ form, setForm, onSave, onCancel, isSaving }: {
  form: FormState
  setForm: (value: FormState) => void
  onSave: () => void
  onCancel: () => void
  isSaving: boolean
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-blue-200 bg-white px-5 py-4 shadow-sm">
      <label className="block">
        <span className="text-xs font-bold text-slate-700">Grup adı</span>
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-500" />
      </label>
      <label className="block">
        <span className="text-xs font-bold text-slate-700">Açıklama</span>
        <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-500" />
      </label>
      <label className="block">
        <span className="text-xs font-bold text-slate-700">E-postalar (virgülle ayırın)</span>
        <textarea value={form.emails} onChange={(event) => setForm({ ...form, emails: event.target.value })} className="mt-1.5 min-h-20 w-full resize-none rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-500" />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600"><X className="h-3.5 w-3.5" />Vazgeç</button>
        <button type="button" onClick={onSave} disabled={isSaving || !form.name.trim() || !form.emails.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {isSaving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Kaydet
        </button>
      </div>
    </section>
  )
}
