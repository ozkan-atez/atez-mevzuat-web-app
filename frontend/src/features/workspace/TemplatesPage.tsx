import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Form, Input, Modal, Popconfirm, Popover, Skeleton, Spin, Tag, Tooltip, message } from 'antd'
import { ArrowLeftOutlined, CheckOutlined, DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, StarFilled, ThunderboltOutlined } from '@ant-design/icons'
import { Can } from '../auth/Can'
import { studioApi, StudioRequestError } from './studioApi'
import { CATEGORY_LABELS, MISSING_RULE_LABELS, type ComponentCategory, type StudioComponent, type TemplateDefinitionV2, type TemplateFullV2, type TemplateRowV2, type TemplateSectionV2 } from './studio-types'
import { StudioHeader } from './StudioHeader'
import './template-studio.css'

/** Sunucu jsonb anahtarlarını yeniden sıralar; kirli/temiz karşılaştırması sıradan bağımsız. */
const stable = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x))
const sorted = (d: TemplateDefinitionV2) => [...d.sections].sort((a, b) => a.order - b.order)
/** Çevirinin girdisi: tarif + seçili bileşenler. Değişirse kaydederken yeniden çevrilir. */
const compileKey = (d: TemplateDefinitionV2) => stable({ r: (d.request ?? '').trim(), on: sorted(d).filter((s) => s.enabled).map((s) => s.id) })
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as ComponentCategory[]
const REQUEST_PLACEHOLDER = `Raporun nasıl olmasını istediğinizi kendi cümlelerinizle yazın. Örneğin:

Hedef kitle: Otomotiv ithalatçıları ve gümrük müşavirleri. Dil resmi ve kısa olsun.

1. Bugün ne değişti — en başta 3-4 maddelik özet, karar gerektirenler önce.
2. GTİP etkisi — değişen vergi oranları eski/yeni karşılaştırmalı tablo halinde.
3. Yürürlük — hangi tarihte başlıyor, geçiş süresi var mı.
4. Kimler etkilenir — sektör ve firma tipi bazında.
5. Ne yapmalı — firmaların atması gereken adımlar, son tarihleriyle.`

const newSection = (c: StudioComponent, order: number): TemplateSectionV2 => ({ id: c.key, componentKey: c.key, componentVersion: c.currentVersion, enabled: true, order, heading: c.name, sectionDescription: '', required: false, missingDataRule: 'OMIT' })

export function TemplatesPage() {
  const [rows, setRows] = useState<TemplateRowV2[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm<{ title: string; description?: string }>()
  const [feedback, holder] = message.useMessage()
  const load = useCallback(async () => {
    setError('')
    try {
      setRows(await studioApi.templates())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const create = async () => {
    const v = await form.validateFields()
    try {
      const t = await studioApi.createTemplate(v)
      setCreating(false)
      form.resetFields()
      await load()
      setOpen(t.id)
    } catch (e) {
      void feedback.error((e as Error).message)
    }
  }
  const remove = async (t: TemplateRowV2) => {
    try {
      await studioApi.removeTemplate(t.id)
      void feedback.success(`“${t.title}” silindi.`)
      await load()
    } catch (e) {
      void feedback.error((e as Error).message)
    }
  }
  if (open) return <TemplateDetail id={open} onBack={() => { setOpen(null); void load() }} />
  const q = query.trim().toLocaleLowerCase('tr-TR')
  const visible = rows.filter((t) => !q || `${t.title} ${t.description ?? ''}`.toLocaleLowerCase('tr-TR').includes(q))
  const def = rows.find((t) => t.isDefault)
  return (
    <div className="atez-demo-page connectors-page">
      {holder}
      <StudioHeader
        title="Şablonlar"
        subtitle="Raporun neyi, hangi bileşenlerle ve nasıl anlatacağını tarif edin."
        search={query}
        onSearch={setQuery}
        searchLabel="Şablon ara"
        action={
          <Can permission="config.manage">
            <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              Şablon oluştur
            </Button>
          </Can>
        }
        counts={
          <>
            <span>{rows.length} şablon</span>
            {def && (
              <span>
                <i className="status-dot good" />
                Varsayılan · {def.title}
              </span>
            )}
          </>
        }
      />
      {error && <Alert type="error" title="Şablonlar yüklenemedi" description={error} action={<Button onClick={() => void load()}>Yeniden dene</Button>} />}
      <Spin spinning={loading}>
        {visible.length > 0 && (
          <section className="connector-section" aria-label="Rapor şablonları">
            <div className="connector-section-heading">
              <h2>
                Rapor şablonları <span>{visible.length}</span>
              </h2>
              <p>Otomasyonlar ve raporlar seçtikleri şablonun kayıtlı sürümünü kullanır.</p>
            </div>
            <div className="connector-list">
              <div className="connector-column-head tpl-columns" aria-hidden="true">
                <span>Şablon</span>
                <span>Bileşen</span>
                <span>Durum</span>
                <span />
              </div>
              {visible.map((t) => (
                <article key={t.id} className="connector-row tpl-columns">
                  <div className="connector-identity">
                    <h3>{t.title}</h3>
                    <p>{t.description || 'Açıklama yok'}</p>
                  </div>
                  <span className="connector-kind">{t.sectionCount ?? '—'} bileşen</span>
                  <div className="connector-health">
                    <span className={`connector-status ${t.isDefault ? 'good' : ''}`}>
                      <i className="status-dot" />
                      {t.isDefault ? 'Varsayılan' : 'Kullanıma hazır'}
                    </span>
                    <small>
                      Sürüm {t.currentVersion} · {new Date(t.updatedAt).toLocaleDateString('tr-TR')}
                    </small>
                  </div>
                  <div className="tpl-row-actions">
                    <Button className="connector-test" icon={<EditOutlined />} aria-label={`${t.title} düzenle`} onClick={() => setOpen(t.id)}>
                      Düzenle
                    </Button>
                    <Can permission="config.manage">
                      {t.isDefault ? (
                        <Tooltip title="Varsayılan şablon silinemez. Önce başka bir şablonu varsayılan yapın.">
                          <Button className="connector-test" type="text" icon={<DeleteOutlined />} aria-label={`${t.title} sil`} disabled />
                        </Tooltip>
                      ) : (
                        <Popconfirm title="Şablon silinsin mi?" description="Bu şablonla üretilmiş raporlar etkilenmez." okText="Sil" okButtonProps={{ danger: true }} cancelText="Vazgeç" onConfirm={() => remove(t)}>
                          <Button className="connector-test" type="text" danger icon={<DeleteOutlined />} aria-label={`${t.title} sil`} />
                        </Popconfirm>
                      )}
                    </Can>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {!loading && !visible.length && (
          <div className="connector-empty">
            <Empty description={query ? 'Aramanızla eşleşen şablon yok.' : 'Henüz şablon oluşturulmadı.'} />
          </div>
        )}
      </Spin>
      <Modal
        className="connector-add-modal"
        width={560}
        title={
          <div className="connector-modal-title">
            <span className="connector-eyebrow">RAPOR ŞABLONU</span>
            <h2>Yeni şablon</h2>
            <p>Havuzdaki bütün aktif bileşenler seçili gelir. Raporu sonraki adımda tarif edersiniz.</p>
          </div>
        }
        open={creating}
        onCancel={() => setCreating(false)}
        onOk={() => void create()}
        okText="Oluştur"
        cancelText="Vazgeç"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="title" label="Şablon adı" rules={[{ required: true, message: 'Şablon adı gerekli' }]}>
            <Input size="large" maxLength={160} placeholder="ör. Müşteri bülteni — otomotiv" />
          </Form.Item>
          <Form.Item name="description" label="Kısa açıklama">
            <Input size="large" maxLength={1000} placeholder="Listede görünür" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

/** Bileşen kutucuğu: küçük canlı önizleme (üzerine gelince büyür) + isim uzunluğunda aç/kapa. */
function ComponentTile({ c, selected, onToggle }: { c: StudioComponent; selected: boolean; onToggle: () => void }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void studioApi.componentPreview(c.id).then((r) => live && setHtml(r.html)).catch(() => {})
    return () => {
      live = false
    }
  }, [c.id, c.currentVersion])
  return (
    <div className={`tpl-tile ${selected ? 'is-on' : ''}`}>
      <Popover
        placement="right"
        mouseEnterDelay={0.35}
        title={c.name}
        content={
          <div className="tpl-peek">
            <p>{c.description}</p>
            {html && <iframe title={`${c.name} önizleme`} sandbox="" srcDoc={html} />}
          </div>
        }
      >
        <button type="button" className="tpl-thumb" onClick={onToggle} tabIndex={-1} aria-hidden="true">
          {html ? <iframe title={`${c.name} küçük önizleme`} sandbox="" srcDoc={html} loading="lazy" tabIndex={-1} /> : <Skeleton.Node active className="tpl-thumb-skeleton" />}
          {selected && <span className="tpl-thumb-check"><CheckOutlined /></span>}
        </button>
      </Popover>
      <button type="button" role="switch" aria-checked={selected} aria-label={c.name} className={`tpl-pill ${selected ? 'is-on' : ''}`} onClick={onToggle}>
        <span className="tpl-pill-track"><span /></span>
        <span className="tpl-pill-name">{c.name}</span>
      </button>
    </div>
  )
}

function TemplateDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [base, setBase] = useState<TemplateFullV2 | null>(null)
  const [draft, setDraft] = useState<TemplateDefinitionV2 | null>(null)
  const [compiledKey, setCompiledKey] = useState('')
  const [components, setComponents] = useState<StudioComponent[]>([])
  const [busy, setBusy] = useState<'save' | 'compile' | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [feedback, holder] = message.useMessage()

  const reload = useCallback(async () => {
    const [t, c] = await Promise.all([studioApi.template(id), studioApi.components()])
    setBase(t)
    setDraft(t.definition)
    setCompiledKey(compileKey(t.definition))
    setComponents(c)
  }, [id])
  useEffect(() => {
    void reload().catch((e) => void feedback.error((e as Error).message))
  }, [reload, feedback])

  const sections = useMemo(() => (draft ? sorted(draft) : []), [draft])
  const enabledKeys = new Set(sections.filter((s) => s.enabled).map((s) => s.componentKey))
  // Havuzdaki aktif bileşenler + şablonda olup artık pasif/arşiv olanlar; kategoriye göre gruplu.
  const groups = useMemo(() => {
    const inTemplate = new Set(sections.map((s) => s.componentKey))
    const list = components.filter((c) => c.status === 'ACTIVE' || inTemplate.has(c.key))
    return CATEGORY_ORDER.map((cat) => ({ cat, items: list.filter((c) => c.category === cat) })).filter((g) => g.items.length)
  }, [components, sections])
  const all = groups.flatMap((g) => g.items)
  const selectedCount = all.filter((c) => enabledKeys.has(c.key)).length

  if (!draft || !base)
    return (
      <div className="atez-demo-page studio-page">
        <Skeleton active paragraph={{ rows: 10 }} />
      </div>
    )

  const dirty = stable(draft) !== stable(base.definition)
  const hasRequest = !!draft.request?.trim()
  const stale = hasRequest && compileKey(draft) !== compiledKey
  const update = (fn: (d: TemplateDefinitionV2) => TemplateDefinitionV2) => setDraft((d) => (d ? fn(d) : d))
  const setOn = (keys: StudioComponent[], on: boolean) =>
    update((d) => {
      const list = sorted(d)
      for (const c of keys) {
        const s = list.find((x) => x.componentKey === c.key)
        if (s) s.enabled = on
        else if (on) list.push(newSection(c, list.length))
      }
      return { ...d, sections: list.map((s, i) => ({ ...s, order: i })) }
    })

  /** Tarifi sistem biçimine çevirir; başarısızsa null döner (hata gösterildi). */
  const compile = async (d: TemplateDefinitionV2) => {
    setBusy('compile')
    try {
      const r = await studioApi.compile(d)
      setDraft(r.definition)
      setCompiledKey(compileKey(r.definition))
      return r.definition
    } catch (e) {
      void feedback.error(`Tarif çevrilemedi: ${(e as Error).message}`)
      return null
    } finally {
      setBusy(null)
    }
  }
  const save = async () => {
    if (!draft.title.trim()) return void feedback.error('Şablon adı gerekli.')
    if (!selectedCount) return void feedback.error('En az bir bileşen seçin.')
    const next = stale ? await compile(draft) : draft
    if (!next) return
    setBusy('save')
    try {
      const r = await studioApi.saveTemplate(id, next)
      await reload()
      void feedback.success(`Şablon kaydedildi (sürüm ${r.version}).`)
    } catch (e) {
      const err = e as StudioRequestError
      Modal.error({ title: err.message, content: err.issues?.length ? <ul className="studio-issues">{err.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null })
    } finally {
      setBusy(null)
    }
  }
  const openPreview = async () => {
    setPreviewOpen(true)
    setPreview(null)
    try {
      setPreview((await studioApi.previewTemplate(draft)).html)
    } catch (e) {
      void feedback.error((e as Error).message)
    }
  }
  const back = () => {
    if (dirty) Modal.confirm({ title: 'Kaydedilmemiş değişiklikler var', content: 'Çıkarsanız bu değişiklikler kaybolur.', okText: 'Kaydetmeden çık', cancelText: 'Devam et', onOk: onBack })
    else onBack()
  }
  const enabledSections = sections.filter((s) => s.enabled)
  const nameOf = (key: string) => components.find((c) => c.key === key)?.name ?? key

  return (
    <div className="atez-demo-page studio-page tpl-detail">
      {holder}
      <div className="tpl-bar">
        <div className="tpl-bar-left">
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={back} aria-label="Şablonlara dön" />
          <div className="tpl-bar-title">
            <strong>
              {draft.title || 'Adsız şablon'} {base.isDefault && <Tag color="success" icon={<StarFilled />}>Varsayılan</Tag>}
            </strong>
            <span>
              Sürüm {base.version} · {selectedCount} bileşen {dirty && <em>· kaydedilmemiş değişiklik</em>}
            </span>
          </div>
        </div>
        <div className="tpl-bar-actions">
          <Button icon={<EyeOutlined />} onClick={() => void openPreview()}>
            Önizle
          </Button>
          {!base.isDefault && <Button onClick={() => void studioApi.setDefault(id).then(reload)}>Varsayılan yap</Button>}
          {!base.isDefault && (
            <Can permission="config.manage">
              <Popconfirm title="Şablon silinsin mi?" description="Bu şablonla üretilmiş raporlar etkilenmez." okText="Sil" okButtonProps={{ danger: true }} cancelText="Vazgeç" onConfirm={() => studioApi.removeTemplate(id).then(onBack, (e: Error) => void feedback.error(e.message))}>
                <Button danger type="text" icon={<DeleteOutlined />} aria-label="Şablonu sil" />
              </Popconfirm>
            </Can>
          )}
          {dirty && <Button onClick={() => { setDraft(base.definition); setCompiledKey(compileKey(base.definition)) }}>Vazgeç</Button>}
          <Can permission="config.manage">
            <Button type="primary" loading={!!busy} disabled={!dirty || !!busy} onClick={() => void save()}>
              {busy === 'compile' ? 'Tarif çevriliyor…' : 'Kaydet'}
            </Button>
          </Can>
        </div>
      </div>

      <div className="tpl-name-row">
        <Input variant="borderless" className="tpl-name" aria-label="Şablon adı" value={draft.title} maxLength={160} placeholder="Şablon adı" onChange={(e) => update((d) => ({ ...d, title: e.target.value }))} />
        <Input variant="borderless" className="tpl-desc" aria-label="Kısa açıklama" value={draft.description} maxLength={1000} placeholder="Kısa açıklama (listede görünür)" onChange={(e) => update((d) => ({ ...d, description: e.target.value }))} />
      </div>

      <section className="tpl-block">
        <div className="tpl-block-head">
          <div>
            <span className="tpl-step">1</span>
            <h2>Rapor tarifi</h2>
            <p>Raporun kime, hangi tonda, hangi başlıklarla ve her başlıkta ne anlatacağını yazın. Kaydettiğinizde tarif, analiz ve rapor yazımının kullandığı biçime çevrilir.</p>
          </div>
        </div>
        <Input.TextArea
          className="tpl-request"
          aria-label="Rapor tarifi"
          autoSize={{ minRows: 9, maxRows: 22 }}
          maxLength={12000}
          showCount
          placeholder={REQUEST_PLACEHOLDER}
          value={draft.request ?? ''}
          onChange={(e) => update((d) => ({ ...d, request: e.target.value }))}
        />
        <details className="tpl-compiled">
          <summary>
            <span>
              <ThunderboltOutlined /> Sistemin kullandığı biçim
            </span>
            <span className={`tpl-compiled-state ${stale ? 'is-stale' : ''}`}>
              {stale ? 'Tarif veya seçim değişti · kaydederken yeniden çevrilecek' : hasRequest ? 'Tarifle güncel' : 'Tarif yazılmadı · mevcut açıklamalar kullanılıyor'}
            </span>
            {stale && (
              <Button size="small" loading={busy === 'compile'} onClick={(e) => { e.preventDefault(); void compile(draft) }}>
                Şimdi çevir
              </Button>
            )}
          </summary>
          <div className="tpl-compiled-body">
            <div className="tpl-compiled-brief">
              <label>Genel yönlendirme</label>
              <p>{draft.brief || '—'}</p>
            </div>
            <ol>
              {enabledSections.map((s) => (
                <li key={s.id}>
                  <div>
                    <strong>{s.heading || nameOf(s.componentKey)}</strong>
                    <small>
                      {nameOf(s.componentKey)} · veri yoksa: {MISSING_RULE_LABELS[s.missingDataRule].toLocaleLowerCase('tr-TR')}
                    </small>
                  </div>
                  <p>{s.sectionDescription || 'Açıklama yok'}</p>
                </li>
              ))}
            </ol>
          </div>
        </details>
      </section>

      <section className="tpl-block">
        <div className="tpl-block-head">
          <div>
            <span className="tpl-step">2</span>
            <h2>Bileşenler</h2>
            <p>Raporda yer alacak yapı taşlarını seçin. Önizlemenin üzerine gelince büyür.</p>
          </div>
          <div className="tpl-select-all">
            <span>
              <strong>{selectedCount}</strong> / {all.length} seçili
            </span>
            <Button size="small" onClick={() => setOn(all, selectedCount !== all.length)}>
              {selectedCount === all.length ? 'Hiçbiri' : 'Tümünü seç'}
            </Button>
          </div>
        </div>
        <div className="tpl-groups" role="group" aria-label="Bileşen seçimi">
          {groups.map((g) => {
            const on = g.items.filter((c) => enabledKeys.has(c.key)).length
            return (
              <div key={g.cat} className="tpl-group">
                <div className="tpl-group-head">
                  <span>{CATEGORY_LABELS[g.cat]}</span>
                  <small>
                    {on}/{g.items.length}
                  </small>
                </div>
                <div className="tpl-tiles">
                  {g.items.map((c) => (
                    <ComponentTile key={c.id} c={c} selected={enabledKeys.has(c.key)} onToggle={() => setOn([c], !enabledKeys.has(c.key))} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <Modal title="Rapor önizlemesi · örnek analiz" open={previewOpen} onCancel={() => setPreviewOpen(false)} footer={null} width={960}>
        {preview ? <iframe className="tpl-preview-frame" title="Rapor önizlemesi" sandbox="" srcDoc={preview} /> : <Skeleton active paragraph={{ rows: 12 }} />}
      </Modal>
    </div>
  )
}
