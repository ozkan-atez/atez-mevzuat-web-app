import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, CATEGORY_LABELS, ORIGIN_LABELS, STATUS_LABELS, type Component } from '../api'
import { Chip, Drawer, Toggle } from '../ui/kit'
import { Preview } from '../ui/Preview'
import { AiComposer } from './AiComposer'

const originTone = { BUILTIN: 'gray', USER: 'blue', AI: 'violet' } as const

function Card({ c, onOpen }: { c: Component; onOpen: () => void }) {
  const qc = useQueryClient()
  const preview = useQuery({ queryKey: ['component-preview', c.id, c.currentVersion], queryFn: () => api.componentPreview(c.id) })
  const toggle = useMutation({ mutationFn: (on: boolean) => api.setStatus(c.id, on ? 'ACTIVE' : 'INACTIVE'), onSuccess: () => qc.invalidateQueries({ queryKey: ['components'] }) })
  return (
    <article className={`card ${c.status !== 'ACTIVE' ? 'muted' : ''}`}>
      <button className="card-preview" onClick={onOpen} aria-label={`${c.name} ayrıntıları`}>
        <Preview html={preview.data?.html} height={210} scale={0.8} title={c.name} />
      </button>
      <div className="card-body">
        <div className="card-title-row">
          <h3>{c.name}</h3>
          {c.status !== 'ARCHIVED' && <Toggle checked={c.status === 'ACTIVE'} onChange={(v) => toggle.mutate(v)} label={`${c.name} aktif`} />}
        </div>
        <p className="card-desc">{c.description}</p>
        <div className="chips">
          <Chip>{CATEGORY_LABELS[c.category]}</Chip>
          <Chip tone={originTone[c.origin]}>{ORIGIN_LABELS[c.origin]}</Chip>
          <Chip tone={c.status === 'ACTIVE' ? 'green' : c.status === 'ARCHIVED' ? 'amber' : 'gray'}>{STATUS_LABELS[c.status]}</Chip>
          <Chip tone="gray">v{c.currentVersion}</Chip>
          {c.usage > 0 && <Chip tone="gray">{c.usage} şablon sürümünde</Chip>}
        </div>
      </div>
    </article>
  )
}

function Detail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const detail = useQuery({ queryKey: ['component', id], queryFn: () => api.component(id!), enabled: !!id })
  const [version, setVersion] = useState<number | null>(null)
  const v = version ?? detail.data?.currentVersion
  const preview = useQuery({ queryKey: ['component-preview', id, v], queryFn: () => api.componentPreview(id!, v), enabled: !!id && !!v })
  const remove = useMutation({
    mutationFn: () => api.removeComponent(id!),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['components'] })
      alert(r.result === 'DELETED' ? 'Bileşen silindi.' : `Bileşen ${r.usage} şablon sürümünde kullanıldığı için arşivlendi; eski raporlar kendi sürümüyle render edilmeye devam eder.`)
      onClose()
    },
  })
  const d = detail.data
  return (
    <Drawer open={!!id} onClose={onClose} title={d?.name ?? 'Bileşen'} wide>
      {d && (
        <div className="detail">
          <div className="detail-main">
            <Preview html={preview.data?.html} height={420} title={d.name} />
            <p className="card-desc">{d.description}</p>
            <div className="meta-line">
              Görünme kuralı: <code>{d.definition.appliesWhen || 'her zaman'}</code>
            </div>
            <div className="meta-line">Veri bağları: {d.definition.bindings.length ? d.definition.bindings.map((b) => <code key={b}>{b}</code>) : '—'}</div>
            <div className="meta-line">Yazılacak alanlar: {d.definition.slots.length ? d.definition.slots.map((s) => <code key={s.key} title={s.instruction}>{s.key}</code>) : '—'}</div>
            <details className="json">
              <summary>Tanım (JSON)</summary>
              <pre>{JSON.stringify(d.versions.find((x) => x.version === v)?.definition ?? d.definition, null, 2)}</pre>
            </details>
          </div>
          <aside className="detail-side">
            <h4>Sürüm geçmişi</h4>
            <ol className="versions">
              {d.versions.map((x) => (
                <li key={x.version}>
                  <button className={x.version === v ? 'active' : ''} onClick={() => setVersion(x.version)}>
                    <strong>v{x.version}</strong>
                    <span>{new Date(x.createdAt).toLocaleString('tr-TR')}</span>
                    {x.note && <em>{x.note}</em>}
                  </button>
                </li>
              ))}
            </ol>
            <h4>Kullanım</h4>
            <p className="small">{d.usage ? `${d.usage} şablon sürümünde kullanılıyor.` : 'Hiçbir şablonda kullanılmıyor.'}</p>
            {d.origin !== 'BUILTIN' && d.status !== 'ARCHIVED' && (
              <button className="btn danger" onClick={() => confirm(d.usage ? 'Kullanımda olduğu için arşivlenecek. Devam?' : 'Kalıcı olarak silinecek. Devam?') && remove.mutate()}>
                {d.usage ? 'Arşivle' : 'Sil'}
              </button>
            )}
          </aside>
        </div>
      )}
    </Drawer>
  )
}

export function ComponentPool({ openAi }: { openAi: boolean }) {
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [origin, setOrigin] = useState('')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [ai, setAi] = useState(openAi)
  const list = useQuery({ queryKey: ['components', category, status, origin], queryFn: () => api.components({ category, status, origin }) })
  const items = useMemo(() => (list.data ?? []).filter((c) => !q || `${c.name} ${c.description}`.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'))), [list.data, q])

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Bileşen havuzu</h1>
          <p className="sub">Raporların yapı taşları. Örnek analizle canlı render edilir; pasif bileşenler yeni şablonlarda listelenmez.</p>
        </div>
        <button className="btn primary" onClick={() => setAi(true)}>
          ✦ AI ile yeni bileşen
        </button>
      </header>
      <div className="filters">
        <input className="search" placeholder="Ara…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategori">
          <option value="">Tüm kategoriler</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <div className="segmented" role="group" aria-label="Durum">
          {[['', 'Tümü'], ['ACTIVE', 'Aktif'], ['INACTIVE', 'Pasif'], ['ARCHIVED', 'Arşiv']].map(([k, v]) => (
            <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k!)}>
              {v}
            </button>
          ))}
        </div>
        <select value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Kaynak">
          <option value="">Tüm kaynaklar</option>
          {Object.entries(ORIGIN_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <span className="count">{items.length} bileşen</span>
      </div>
      {list.isLoading && <p className="sub">Yükleniyor…</p>}
      {list.error && <p className="error-text">{String(list.error)}</p>}
      <div className="grid">
        {items.map((c) => (
          <Card key={c.id} c={c} onOpen={() => setOpenId(c.id)} />
        ))}
      </div>
      <Detail id={openId} onClose={() => setOpenId(null)} />
      <AiComposer open={ai} onClose={() => setAi(false)} />
    </div>
  )
}
