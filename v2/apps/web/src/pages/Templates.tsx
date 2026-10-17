import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TemplateDefinition, TemplateSection } from '@atez/contracts'
import { api, ApiError, CATEGORY_LABELS } from '../api'
import { Chip, Issues, Modal, Toggle } from '../ui/kit'
import { Preview, useDebounced } from '../ui/Preview'

/** Anahtar sırasından bağımsız karşılaştırma (sunucu jsonb anahtarları yeniden sıralar). */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x))

const RULE_LABELS = { NOTE: 'Not göster', OMIT: 'Bölümü atla', BLOCK: 'Raporu durdur' } as const
const STATE_LABELS: Record<string, string> = { RENDERED: 'görünür', OMITTED: 'veri yok · atlanır', NOTE: 'veri yok · not', BLOCKED: 'veri yok · durdurur' }

export function TemplateList({ go }: { go: (hash: string) => void }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['templates'], queryFn: api.templates })
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [brief, setBrief] = useState('')
  const create = useMutation({
    mutationFn: () => api.createTemplate({ title, description, brief }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      go(`#/templates/${t.id}`)
    },
  })
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Şablonlar</h1>
          <p className="sub">Raporun hangi bölümlerden, hangi sırayla ve hangi vurguyla oluşacağı. Yeni şablonda havuzdaki bütün aktif bileşenler açık gelir.</p>
        </div>
        <button className="btn primary" onClick={() => setOpen(true)}>
          + Yeni şablon
        </button>
      </header>
      <div className="template-list">
        {(list.data ?? []).map((t) => (
          <button key={t.id} className="template-row" onClick={() => go(`#/templates/${t.id}`)}>
            <div>
              <h3>{t.title}</h3>
              <span className="small">Güncellendi: {new Date(t.updatedAt).toLocaleString('tr-TR')}</span>
            </div>
            <div className="chips">
              {t.isDefault && <Chip tone="green">Varsayılan</Chip>}
              <Chip tone="gray">v{t.currentVersion}</Chip>
            </div>
          </button>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Yeni şablon">
        <label className="field">
          <span>Başlık</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ör. Müşteri bülteni — otomotiv" />
        </label>
        <label className="field">
          <span>Açıklama</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          <span>Brief — raporun amacı, hedef kitle, ton, genel vurgu</span>
          <textarea rows={5} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="ör. Otomotiv ithalatçıları için; kısa, uygulamaya dönük; önce maliyet etkisini, sonra belge yükümlülüklerini öne çıkar." />
        </label>
        <div className="row end">
          <button className="btn primary" disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
            Oluştur
          </button>
        </div>
      </Modal>
    </div>
  )
}

export function TemplateEditor({ id, go }: { id: string; go: (hash: string) => void }) {
  const qc = useQueryClient()
  const tpl = useQuery({ queryKey: ['template', id], queryFn: () => api.template(id) })
  const comps = useQuery({ queryKey: ['components', '', '', ''], queryFn: () => api.components({}) })
  const [draft, setDraft] = useState<TemplateDefinition | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<'section' | 'template'>('section')
  const [dragId, setDragId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [suggestions, setSuggestions] = useState<{ sectionId: string; sectionDescription: string }[] | null>(null)

  useEffect(() => {
    if (tpl.data && !draft) {
      setDraft(tpl.data.definition)
      setSelected([...tpl.data.definition.sections].sort((a, b) => a.order - b.order)[0]?.id ?? null)
    }
  }, [tpl.data, draft])

  const debounced = useDebounced(draft, 350)
  const preview = useQuery({ queryKey: ['template-preview', debounced], queryFn: () => api.previewTemplate(debounced!), enabled: !!debounced, placeholderData: (p) => p })
  const dirty = !!draft && !!tpl.data && stable(draft) !== stable(tpl.data.definition)
  const save = useMutation({
    mutationFn: () => api.saveTemplate(id, draft!),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      const fresh = await qc.fetchQuery({ queryKey: ['template', id], queryFn: () => api.template(id), staleTime: 0 })
      setDraft(fresh.definition)
    },
  })
  const makeDefault = useMutation({ mutationFn: () => api.setDefault(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }) })
  const describe = useMutation({ mutationFn: () => api.describe(draft!), onSuccess: (r) => setSuggestions(r.suggestions) })

  const sections = useMemo(() => [...(draft?.sections ?? [])].sort((a, b) => a.order - b.order), [draft])
  const compByKey = useMemo(() => new Map((comps.data ?? []).map((c) => [c.key, c])), [comps.data])
  const sel = sections.find((s) => s.id === selected) ?? null
  const states = new Map((preview.data?.sections ?? []).map((s) => [s.id, s.state]))

  const update = (fn: (d: TemplateDefinition) => TemplateDefinition) => setDraft((d) => (d ? fn(d) : d))
  const patchSection = (sid: string, patch: Partial<TemplateSection>) => update((d) => ({ ...d, sections: d.sections.map((s) => (s.id === sid ? { ...s, ...patch } : s)) }))
  const reorder = (from: string, to: string) =>
    update((d) => {
      const list = [...d.sections].sort((a, b) => a.order - b.order)
      const i = list.findIndex((s) => s.id === from)
      const j = list.findIndex((s) => s.id === to)
      const [m] = list.splice(i, 1)
      list.splice(j, 0, m!)
      return { ...d, sections: list.map((s, k) => ({ ...s, order: k })) }
    })
  const addFromPool = (key: string) => {
    const c = compByKey.get(key)!
    update((d) => {
      let sid = c.key
      for (let n = 2; d.sections.some((s) => s.id === sid); n++) sid = `${c.key}-${n}`
      return {
        ...d,
        sections: [...d.sections, { id: sid, componentKey: c.key, componentVersion: c.currentVersion, enabled: true, order: d.sections.length, heading: c.name, sectionDescription: '', required: false, missingDataRule: 'OMIT' }],
      }
    })
    setAdding(false)
  }
  const removeSection = (sid: string) => update((d) => ({ ...d, sections: d.sections.filter((s) => s.id !== sid).map((s, k) => ({ ...s, order: k })) }))

  if (!draft || !tpl.data) return <div className="page">{tpl.error ? String(tpl.error) : 'Yükleniyor…'}</div>
  const saveIssues = save.error instanceof ApiError ? [save.error.message, ...save.error.issues] : save.error ? [String(save.error)] : []

  return (
    <div className="editor">
      <header className="editor-head">
        <button className="btn ghost" onClick={() => go('#/templates')}>
          ← Şablonlar
        </button>
        <div className="editor-title">
          <h1>{draft.title}</h1>
          <span className="small">
            v{tpl.data.version}
            {dirty ? ' · kaydedilmemiş değişiklik' : ''}
          </span>
        </div>
        <div className="row">
          {!tpl.data.isDefault && (
            <button className="btn" onClick={() => makeDefault.mutate()}>
              Varsayılan yap
            </button>
          )}
          <button className="btn" disabled={!dirty} onClick={() => setDraft(tpl.data!.definition)}>
            Geri al
          </button>
          <button className="btn primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Kaydediliyor…' : 'Kaydet (yeni sürüm)'}
          </button>
        </div>
      </header>
      <Issues issues={saveIssues} />
      <div className="editor-cols">
        <aside className="col-left">
          <div className="col-head">
            <h2>Bölümler</h2>
            <span className="small">{sections.filter((s) => s.enabled).length}/{sections.length} açık</span>
          </div>
          <ol className="sections">
            {sections.map((s) => {
              const c = compByKey.get(s.componentKey)
              const st = states.get(s.id)
              return (
                <li
                  key={s.id}
                  draggable
                  onDragStart={() => setDragId(s.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dragId && dragId !== s.id && reorder(dragId, s.id)}
                  className={`${selected === s.id ? 'selected' : ''} ${s.enabled ? '' : 'off'} ${dragId === s.id ? 'dragging' : ''}`}
                  onClick={() => {
                    setSelected(s.id)
                    setTab('section')
                  }}
                >
                  <span className="grip" aria-hidden>
                    ⋮⋮
                  </span>
                  <div className="sec-text">
                    <strong>{s.heading || c?.name}</strong>
                    <span className="small">
                      {c ? CATEGORY_LABELS[c.category] : s.componentKey} · v{s.componentVersion}
                      {s.enabled && st ? ` · ${STATE_LABELS[st]}` : ''}
                    </span>
                  </div>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Toggle checked={s.enabled} onChange={(v) => patchSection(s.id, { enabled: v })} label={`${s.heading} açık`} />
                  </span>
                </li>
              )
            })}
          </ol>
          <div className="col-actions">
            <button className="btn" onClick={() => setAdding(true)}>
              + Havuzdan ekle
            </button>
            <a className="link" href="#/components?ai=1">
              Yeni bileşen oluştur →
            </a>
          </div>
        </aside>
        <main className="col-center">
          <div className="label-row">
            <span className="eyebrow">Örnek analizle önizleme</span>
            {preview.isFetching && <span className="small">güncelleniyor…</span>}
          </div>
          <Preview html={preview.data?.html} height={900} title="Rapor önizlemesi" />
        </main>
        <aside className="col-right">
          <div className="tabs">
            <button className={tab === 'section' ? 'on' : ''} onClick={() => setTab('section')}>
              Bölüm
            </button>
            <button className={tab === 'template' ? 'on' : ''} onClick={() => setTab('template')}>
              Şablon
            </button>
          </div>
          {tab === 'section' && sel && (
            <div className="form">
              <div className="meta-line">
                Bileşen: <strong>{compByKey.get(sel.componentKey)?.name ?? sel.componentKey}</strong> <Chip tone="gray">v{sel.componentVersion}</Chip>
              </div>
              <label className="field">
                <span>Başlık</span>
                <input value={sel.heading} onChange={(e) => patchSection(sel.id, { heading: e.target.value })} />
              </label>
              <label className="field emph">
                <span>Bölüm açıklaması</span>
                <small>Bu bölümde nelere önem verilsin, içerikte ne istensin? Rapor yazarı (AI) bunu en önemli yönlendirme olarak uygular; analize yeni bilgi ekletmez.</small>
                <textarea
                  rows={9}
                  value={sel.sectionDescription}
                  placeholder={'ör. Gümrük müşavirinin beyannamede ne değiştirmesi gerektiğini öne çıkar.\nSayısal artışı tek cümlede yorumla; belge yükümlülüklerini madde madde ver.\nSektör adı geçiyorsa otomotivi vurgula.'}
                  onChange={(e) => patchSection(sel.id, { sectionDescription: e.target.value })}
                />
              </label>
              <label className="check">
                <input type="checkbox" checked={sel.required} onChange={(e) => patchSection(sel.id, { required: e.target.checked, ...(e.target.checked && sel.missingDataRule === 'OMIT' ? { missingDataRule: 'NOTE' as const } : {}) })} />
                Zorunlu bölüm
              </label>
              <fieldset className="field">
                <span>Analizde veri yoksa</span>
                <div className="segmented">
                  {(Object.keys(RULE_LABELS) as (keyof typeof RULE_LABELS)[]).map((k) => (
                    <button key={k} disabled={sel.required && k === 'OMIT'} className={sel.missingDataRule === k ? 'on' : ''} onClick={() => patchSection(sel.id, { missingDataRule: k })}>
                      {RULE_LABELS[k]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <button className="btn danger ghost" onClick={() => removeSection(sel.id)}>
                Bölümü şablondan çıkar
              </button>
            </div>
          )}
          {tab === 'template' && (
            <div className="form">
              <label className="field">
                <span>Başlık</span>
                <input value={draft.title} onChange={(e) => update((d) => ({ ...d, title: e.target.value }))} />
              </label>
              <label className="field">
                <span>Açıklama</span>
                <input value={draft.description} onChange={(e) => update((d) => ({ ...d, description: e.target.value }))} />
              </label>
              <label className="field emph">
                <span>Brief</span>
                <small>Raporun amacı, hedef kitle, ton ve genel vurgu. Bütün bölümler için prompt’a girer.</small>
                <textarea rows={7} value={draft.brief} onChange={(e) => update((d) => ({ ...d, brief: e.target.value }))} />
              </label>
              <label className="field">
                <span>Rapor üst başlığı</span>
                <input value={draft.shell.heading} onChange={(e) => update((d) => ({ ...d, shell: { ...d.shell, heading: e.target.value } }))} />
              </label>
              <label className="check">
                <input type="checkbox" checked={draft.shell.showFooter} onChange={(e) => update((d) => ({ ...d, shell: { ...d.shell, showFooter: e.target.checked } }))} />
                Alt bilgi ve yasal uyarı
              </label>
              <label className="field">
                <span>Vurgu rengi</span>
                <input type="color" value={draft.theme.tokens.navy ?? '#1b2a4a'} onChange={(e) => update((d) => ({ ...d, theme: { tokens: { ...d.theme.tokens, navy: e.target.value } } }))} />
              </label>
              <div className="ai-box">
                <strong>AI ile bölüm açıklamaları</strong>
                <p className="small">Brief’ten her açık bölüm için açıklama önerir; bölüm yapısı değişmez.</p>
                <button className="btn" disabled={!draft.brief.trim() || describe.isPending} onClick={() => describe.mutate()}>
                  {describe.isPending ? 'Öneriliyor…' : '✦ Öner'}
                </button>
                {describe.error && <Issues issues={[describe.error instanceof ApiError ? describe.error.message : String(describe.error)]} />}
                {suggestions && (
                  <div className="suggestions">
                    {suggestions.map((s) => (
                      <div key={s.sectionId} className="suggestion">
                        <strong>{sections.find((x) => x.id === s.sectionId)?.heading}</strong>
                        <p>{s.sectionDescription}</p>
                      </div>
                    ))}
                    <div className="row end">
                      <button className="btn ghost" onClick={() => setSuggestions(null)}>
                        Vazgeç
                      </button>
                      <button
                        className="btn primary"
                        onClick={() => {
                          const m = new Map(suggestions.map((s) => [s.sectionId, s.sectionDescription]))
                          update((d) => ({ ...d, sections: d.sections.map((s) => (m.has(s.id) ? { ...s, sectionDescription: m.get(s.id)! } : s)) }))
                          setSuggestions(null)
                        }}
                      >
                        Uygula
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
      <Modal open={adding} onClose={() => setAdding(false)} title="Havuzdan ekle">
        <p className="small">Yalnızca aktif bileşenler listelenir. Yeni bileşen oluşturmak için bileşen stüdyosunu kullanın.</p>
        <div className="pool-pick">
          {(comps.data ?? [])
            .filter((c) => c.status === 'ACTIVE')
            .map((c) => (
              <button key={c.id} className="pick" onClick={() => addFromPool(c.key)}>
                <strong>{c.name}</strong>
                <span className="small">
                  {CATEGORY_LABELS[c.category]} · v{c.currentVersion}
                  {sections.some((s) => s.componentKey === c.key) ? ' · şablonda var' : ''}
                </span>
              </button>
            ))}
        </div>
      </Modal>
    </div>
  )
}
