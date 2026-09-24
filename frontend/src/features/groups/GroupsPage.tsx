import { useCallback, useEffect, useState } from 'react'
import { Check, LoaderCircle, Mail, Pencil, Plus, Trash2, UsersRound, X } from 'lucide-react'
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
    <div className="space-y-5 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dağıtım grupları</h1>
          <p className="mt-1 text-sm text-slate-500">Bültenlerin iletileceği alıcı listelerini yönetin.</p>
        </div>
        <button type="button" onClick={startCreate} disabled={editingId === 'new'} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
          <Plus className="h-4 w-4" />Yeni grup
        </button>
      </header>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}

      {editingId === 'new' && <GroupForm title="Yeni grup" form={form} setForm={setForm} onSave={() => void save()} onCancel={cancel} isSaving={isSaving} />}

      {(isLoading || groups.length > 0 || editingId !== 'new') && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-bold text-slate-900">Kayıtlı gruplar</h2>
          {!isLoading && <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{groups.length} grup</span>}
        </div>
        {isLoading && <p className="flex items-center gap-2 px-6 py-8 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />Gruplar yükleniyor…</p>}
        {!isLoading && groups.length === 0 && (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><UsersRound className="h-5 w-5" /></div>
            <p className="mt-4 text-sm font-semibold text-slate-800">Henüz dağıtım grubu yok</p>
            <p className="mt-1 text-sm text-slate-500">Bülten alıcılarını eklemek için yeni bir grup oluşturun.</p>
          </div>
        )}
        <div className="divide-y divide-slate-100">
          {groups.map((group) => editingId === group.id
          ? <div key={group.id} className="p-4 sm:p-5"><GroupForm title="Grubu düzenle" form={form} setForm={setForm} onSave={() => void save()} onCancel={cancel} isSaving={isSaving} /></div>
          : (
            <article key={group.id} className="flex flex-wrap items-start justify-between gap-4 px-6 py-5">
              <div className="min-w-0 flex-1">
                <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                  {group.name}
                  <span className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold ${group.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {group.isActive ? 'Aktif' : 'Pasif'}
                  </span>
                </h3>
                {group.description && <p className="mt-1 text-sm text-slate-500">{group.description}</p>}
                <div className="mt-3 flex flex-wrap items-start gap-2 text-xs text-slate-600">
                  <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-slate-500"><Mail className="h-3.5 w-3.5" />{group.emails.length} alıcı</span>
                  <span className="min-w-0 break-all">{group.emails.join(', ')}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => void toggleActive(group)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">
                  {group.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                </button>
                <button type="button" onClick={() => startEdit(group)} aria-label={`${group.name} grubunu düzenle`} className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50"><Pencil className="h-4 w-4" /></button>
                <button type="button" onClick={() => void remove(group)} aria-label={`${group.name} grubunu sil`} className="rounded-xl border border-slate-200 p-2 text-red-500 transition hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
              </div>
            </article>
          ))}
        </div>
      </section>}
    </div>
  )
}

function GroupForm({ title, form, setForm, onSave, onCancel, isSaving }: {
  title: string
  form: FormState
  setForm: (value: FormState) => void
  onSave: () => void
  onCancel: () => void
  isSaving: boolean
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4"><h2 className="text-base font-bold text-slate-900">{title}</h2><p className="mt-0.5 text-xs text-slate-500">Alıcı listesini ve grup bilgilerini düzenleyin.</p></div>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-slate-700">Grup adı</span>
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-700">Açıklama</span>
          <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-semibold text-slate-700">E-posta adresleri</span>
          <textarea value={form.emails} onChange={(event) => setForm({ ...form, emails: event.target.value })} placeholder="ornek@firma.com, ekip@firma.com" className="mt-1.5 min-h-24 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          <span className="mt-1 block text-xs text-slate-500">Adresleri virgülle ayırın.</span>
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
        <button type="button" onClick={onCancel} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600"><X className="h-3.5 w-3.5" />Vazgeç</button>
        <button type="button" onClick={onSave} disabled={isSaving || !form.name.trim() || !form.emails.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {isSaving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Kaydet
        </button>
      </div>
    </section>
  )
}
