import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, CATEGORY_LABELS, type Draft } from '../api'
import { Issues, Drawer } from '../ui/kit'
import { Preview } from '../ui/Preview'

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

const EXAMPLES = ['Yürürlük tarihini büyük gösteren, altında kısa açıklama olan bir kart', 'Değişen GTİP’leri yalnızca önceki/yeni/değişim sütunlarıyla gösteren sade tablo', 'Firmaların yapması gerekenleri madde madde listeleyen eylem kutusu']

/**
 * "AI ile yeni bileşen" paneli: sohbet + canlı önizleme + kaydet. Her istek bir taslak üretir;
 * takip istekleri ("tabloyu zebra yap") son taslağı temel alır. Kayıt yalnızca kullanıcı butonuyla.
 */
export function AiComposer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saved, setSaved] = useState<string | null>(null)

  const gen = useMutation({
    mutationFn: (request: string) =>
      api.draft({
        request,
        base: draft?.definition ? { name: draft.name, description: draft.description, category: draft.category, definition: draft.definition } : null,
        conversation: turns,
      }),
    onSuccess: (d, request) => {
      setDraft(d)
      setName(d.name)
      setDescription(d.description)
      setSaved(null)
      setTurns((t) => [...t, { role: 'user', content: request }, { role: 'assistant', content: d.ok ? `“${d.name}” taslağı hazır${d.repairRounds ? ' (bir onarım turuyla)' : ''}.` : `Taslak doğrulamadan geçmedi: ${d.issues.slice(0, 2).join('; ')}` }])
    },
  })
  const save = useMutation({
    mutationFn: (activate: boolean) => api.createComponent({ name, description, category: draft!.category, origin: 'AI', definition: draft!.definition, activate }),
    onSuccess: (c, activate) => {
      setSaved(`“${c.name}” kaydedildi${activate ? ' ve aktifleştirildi' : ' (pasif)'}.`)
      qc.invalidateQueries({ queryKey: ['components'] })
    },
  })

  const submit = () => {
    const v = input.trim()
    if (!v || gen.isPending) return
    setInput('')
    gen.mutate(v)
  }
  const reset = () => {
    setTurns([])
    setDraft(null)
    setSaved(null)
  }

  return (
    <Drawer open={open} onClose={onClose} title="AI ile yeni bileşen" wide>
      <div className="composer">
        <section className="composer-chat">
          <div className="turns">
            {turns.length === 0 && (
              <div className="hint">
                <p>Bileşeni tarif edin; AI yalnızca izinli node’lar, tema sınıfları ve analizdeki veri bağlarıyla bir taslak üretir. Sayılar analizden kodla gelir.</p>
                <div className="examples">
                  {EXAMPLES.map((e) => (
                    <button key={e} className="example" onClick={() => setInput(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`turn ${t.role}`}>
                {t.content}
              </div>
            ))}
            {gen.isPending && <div className="turn assistant pending">Taslak hazırlanıyor…</div>}
            {gen.error && <div className="turn error">{gen.error instanceof ApiError ? gen.error.message : String(gen.error)}</div>}
          </div>
          <div className="composer-input">
            <textarea
              value={input}
              placeholder={draft ? 'Düzeltme isteyin: “tabloyu sadeleştir”, “başlığa rozet ekle”…' : 'Ne tür bir bileşen istiyorsunuz?'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
              }}
            />
            <div className="row">
              <button className="btn ghost" onClick={reset} disabled={!turns.length}>
                Yeni sohbet
              </button>
              <button className="btn primary" onClick={submit} disabled={!input.trim() || gen.isPending}>
                {draft ? 'Düzelt' : 'Oluştur'}
              </button>
            </div>
          </div>
        </section>
        <section className="composer-preview">
          <div className="label-row">
            <span className="eyebrow">Taslak önizleme</span>
            {draft && <span className={`status-dot ${draft.ok ? 'ok' : 'bad'}`}>{draft.ok ? 'Doğrulandı' : 'Doğrulama hatası'}</span>}
          </div>
          <Preview html={draft?.previewHtml} height={340} title="Taslak önizleme" />
          {draft && (
            <>
              <Issues issues={draft.issues} />
              <label className="field">
                <span>Ad</span>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">
                <span>Açıklama (hangi analizlerde kullanılır?)</span>
                <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
              <div className="meta-line">
                Kategori: <strong>{CATEGORY_LABELS[draft.category]}</strong> · Görünme kuralı: <code>{draft.definition?.appliesWhen || 'her zaman'}</code>
              </div>
              <div className="meta-line">
                Veri bağları: {draft.definition?.bindings.length ? draft.definition.bindings.map((b) => <code key={b}>{b}</code>) : '—'}
              </div>
              <div className="row end">
                <button className="btn" disabled={!draft.ok || save.isPending} onClick={() => save.mutate(false)}>
                  Kaydet (pasif)
                </button>
                <button className="btn primary" disabled={!draft.ok || save.isPending} onClick={() => save.mutate(true)}>
                  Kaydet ve aktifleştir
                </button>
              </div>
              {saved && <p className="success">{saved}</p>}
              {save.error && <Issues issues={save.error instanceof ApiError ? [save.error.message, ...save.error.issues] : [String(save.error)]} />}
            </>
          )}
        </section>
      </div>
    </Drawer>
  )
}
