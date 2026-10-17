import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Checkbox, Collapse, Empty, Form, Input, Modal, Segmented, Skeleton, Space, Tag, Tooltip, Typography, message } from 'antd'
import { ArrowDownOutlined, ArrowLeftOutlined, ArrowUpOutlined, CheckOutlined, EyeOutlined, PlusOutlined, RobotOutlined, StarFilled } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { Can } from '../auth/Can'
import { studioApi, StudioRequestError } from './studioApi'
import { CATEGORY_LABELS, MISSING_RULE_LABELS, type StudioComponent, type TemplateDefinitionV2, type TemplateFullV2, type TemplateRowV2, type TemplateSectionV2 } from './studio-types'
import { StudioNav } from './StudioNav'
import './template-studio.css'

/** Sunucu jsonb anahtarlarını yeniden sıralar; kirli/temiz karşılaştırması sıradan bağımsız. */
const stable = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x))
const sorted = (d: TemplateDefinitionV2) => [...d.sections].sort((a, b) => a.order - b.order)
const renumber = (list: TemplateSectionV2[]) => list.map((s, i) => ({ ...s, order: i }))

export function TemplatesPage() {
  const [rows, setRows] = useState<TemplateRowV2[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm<{ title: string; description?: string; brief?: string }>()
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
  if (open) return <TemplateDetail id={open} onBack={() => { setOpen(null); void load() }} />
  return (
    <div className="atez-demo-page studio-page">
      {holder}
      <div className="atez-demo-heading">
        <div>
          <Typography.Title level={1}>Rapor şablonları</Typography.Title>
          <Typography.Paragraph type="secondary">Her şablon, rapora girecek bileşenlerin seçimidir. Bileşenler “Bileşen havuzu”nda oluşturulur ve yönetilir.</Typography.Paragraph>
        </div>
        <Can permission="config.manage">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            Şablon oluştur
          </Button>
        </Can>
      </div>
      <div className="studio-toolbar">
        <StudioNav />
      </div>
      {error && <Alert type="error" showIcon title="Şablonlar yüklenemedi" description={error} action={<Button onClick={() => void load()}>Yeniden dene</Button>} />}
      {loading ? (
        <div className="tpl-list">{[0, 1].map((i) => <Card key={i}><Skeleton active /></Card>)}</div>
      ) : rows.length ? (
        <div className="tpl-list">
          {rows.map((t) => (
            <button key={t.id} className="tpl-row" onClick={() => setOpen(t.id)}>
              <div>
                <strong>{t.title}</strong>
                <span>Güncellendi {new Date(t.updatedAt).toLocaleString('tr-TR')} · sürüm {t.currentVersion}</span>
              </div>
              <Space size={6}>
                {t.isDefault && <Tag color="success" icon={<StarFilled />}>Varsayılan</Tag>}
                <span className="tpl-row-open">Aç →</span>
              </Space>
            </button>
          ))}
        </div>
      ) : (
        <Empty description="İlk rapor şablonunuzu oluşturun." />
      )}
      <Modal title="Yeni şablon" open={creating} onCancel={() => setCreating(false)} onOk={() => void create()} okText="Oluştur" cancelText="Vazgeç">
        <Typography.Paragraph type="secondary">Havuzdaki bütün aktif bileşenler seçili gelir; istemediklerinizi kapatırsınız.</Typography.Paragraph>
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="title" label="Şablon adı" rules={[{ required: true, message: 'Şablon adı gerekli' }]}>
            <Input maxLength={160} placeholder="ör. Müşteri bülteni — otomotiv" />
          </Form.Item>
          <Form.Item name="description" label="Açıklama">
            <Input maxLength={1000} />
          </Form.Item>
          <Form.Item name="brief" label="Brief" tooltip="Raporun amacı, hedef kitle, ton ve genel vurgu. Analiz ve rapor yazımı bu metni görür.">
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} maxLength={4000} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

/** Bileşen kutucuğu: küçük canlı önizleme + isim uzunluğunda aç/kapa. */
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
      <button type="button" className="tpl-thumb" onClick={onToggle} tabIndex={-1} aria-hidden="true">
        {html ? <iframe title={`${c.name} küçük önizleme`} sandbox="" srcDoc={html} loading="lazy" tabIndex={-1} /> : <Skeleton.Node active className="tpl-thumb-skeleton" />}
      </button>
      <Tooltip title={c.description} mouseEnterDelay={0.6}>
        <button type="button" role="switch" aria-checked={selected} aria-label={c.name} className={`tpl-pill ${selected ? 'is-on' : ''}`} onClick={onToggle}>
          <span className="tpl-pill-dot">{selected && <CheckOutlined />}</span>
          <span className="tpl-pill-name">{c.name}</span>
        </button>
      </Tooltip>
      <span className="tpl-tile-cat">{CATEGORY_LABELS[c.category]}{c.status !== 'ACTIVE' ? ' · pasif' : ''}</span>
    </div>
  )
}

function TemplateDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [base, setBase] = useState<TemplateFullV2 | null>(null)
  const [draft, setDraft] = useState<TemplateDefinitionV2 | null>(null)
  const [components, setComponents] = useState<StudioComponent[]>([])
  const [category, setCategory] = useState<string>('ALL')
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [feedback, holder] = message.useMessage()

  const reload = useCallback(async () => {
    const [t, c] = await Promise.all([studioApi.template(id), studioApi.components()])
    setBase(t)
    setDraft(t.definition)
    setComponents(c)
  }, [id])
  useEffect(() => {
    void reload().catch((e) => void feedback.error((e as Error).message))
  }, [reload, feedback])

  const dirty = !!draft && !!base && stable(draft) !== stable(base.definition)
  const sections = draft ? sorted(draft) : []
  const selected = sections.filter((s) => s.enabled)
  const isOn = (key: string) => sections.some((s) => s.componentKey === key && s.enabled)
  // Havuzdaki aktif bileşenler + şablonda olup artık pasif/arşiv olanlar.
  const tiles = useMemo(() => {
    const inTemplate = new Set(sections.map((s) => s.componentKey))
    return components.filter((c) => c.status === 'ACTIVE' || inTemplate.has(c.key))
  }, [components, sections])
  const categories = useMemo(() => [...new Set(tiles.map((c) => c.category))], [tiles])
  const shown = tiles.filter((c) => category === 'ALL' || c.category === category)
  const byKey = useMemo(() => new Map(components.map((c) => [c.key, c])), [components])

  const update = (fn: (d: TemplateDefinitionV2) => TemplateDefinitionV2) => setDraft((d) => (d ? fn(d) : d))
  const toggle = (c: StudioComponent) =>
    update((d) => {
      const list = sorted(d)
      const existing = list.find((s) => s.componentKey === c.key)
      if (existing) return { ...d, sections: list.map((s) => (s.componentKey === c.key ? { ...s, enabled: !s.enabled } : s)) }
      return { ...d, sections: renumber([...list, { id: c.key, componentKey: c.key, componentVersion: c.currentVersion, enabled: true, order: list.length, heading: c.name, sectionDescription: '', required: false, missingDataRule: 'OMIT' }]) }
    })
  const setAll = (on: boolean) =>
    update((d) => {
      const list = sorted(d).map((s) => ({ ...s, enabled: on }))
      if (on) for (const c of tiles) if (!list.some((s) => s.componentKey === c.key)) list.push({ id: c.key, componentKey: c.key, componentVersion: c.currentVersion, enabled: true, order: list.length, heading: c.name, sectionDescription: '', required: false, missingDataRule: 'OMIT' })
      return { ...d, sections: renumber(list) }
    })
  const patch = (sid: string, p: Partial<TemplateSectionV2>) => update((d) => ({ ...d, sections: d.sections.map((s) => (s.id === sid ? { ...s, ...p } : s)) }))
  const move = (sid: string, delta: number) =>
    update((d) => {
      const list = sorted(d)
      const on = list.filter((s) => s.enabled)
      const i = on.findIndex((s) => s.id === sid)
      const target = on[i + delta]
      if (!target) return d
      const a = list.findIndex((s) => s.id === sid)
      const b = list.findIndex((s) => s.id === target.id)
      ;[list[a], list[b]] = [list[b]!, list[a]!]
      return { ...d, sections: renumber(list) }
    })

  const save = async () => {
    if (!draft) return
    if (!draft.title.trim()) return void feedback.error('Şablon adı gerekli.')
    if (!selected.length) return void feedback.error('En az bir bileşen seçin.')
    setSaving(true)
    try {
      const r = await studioApi.saveTemplate(id, draft)
      await reload()
      void feedback.success(`Şablon kaydedildi (sürüm ${r.version}).`)
    } catch (e) {
      const err = e as StudioRequestError
      Modal.error({ title: err.message, content: err.issues?.length ? <ul className="studio-issues">{err.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null })
    } finally {
      setSaving(false)
    }
  }
  const openPreview = async () => {
    if (!draft) return
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

  if (!draft || !base) return <div className="atez-demo-page studio-page"><Skeleton active paragraph={{ rows: 10 }} /></div>
  return (
    <div className="atez-demo-page studio-page tpl-detail">
      {holder}
      <div className="tpl-bar">
        <Space size={12} wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={back}>
            Şablonlar
          </Button>
          <div className="tpl-bar-title">
            <strong>{draft.title || 'Adsız şablon'}</strong>
            <span>
              Sürüm {base.version} · {selected.length} bileşen seçili {dirty && <em>· kaydedilmemiş değişiklik</em>}
            </span>
          </div>
          {base.isDefault && <Tag color="success" icon={<StarFilled />}>Varsayılan</Tag>}
        </Space>
        <Space size={8} wrap>
          <Button icon={<EyeOutlined />} onClick={() => void openPreview()}>
            Önizle
          </Button>
          {!base.isDefault && <Button onClick={() => void studioApi.setDefault(id).then(reload)}>Varsayılan yap</Button>}
          {dirty && <Button onClick={() => setDraft(base.definition)}>Vazgeç</Button>}
          <Can permission="config.manage">
            <Button type="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
              Kaydet
            </Button>
          </Can>
        </Space>
      </div>

      <section className="tpl-block">
        <div className="tpl-fields">
          <label>
            <span>Şablon adı</span>
            <Input value={draft.title} maxLength={160} onChange={(e) => update((d) => ({ ...d, title: e.target.value }))} />
          </label>
          <label>
            <span>Açıklama</span>
            <Input value={draft.description} maxLength={1000} onChange={(e) => update((d) => ({ ...d, description: e.target.value }))} />
          </label>
          <label className="wide">
            <span>Brief — raporun amacı, hedef kitle, ton, genel vurgu</span>
            <Input.TextArea aria-label="Şablon brief" autoSize={{ minRows: 2, maxRows: 5 }} maxLength={4000} value={draft.brief} onChange={(e) => update((d) => ({ ...d, brief: e.target.value }))} />
          </label>
        </div>
      </section>

      <section className="tpl-block">
        <div className="tpl-block-head">
          <div>
            <h2>Bileşenler</h2>
            <p>Raporda yer alacak bileşenleri seçin. Küçük önizleme, bileşenin raporda nasıl görüneceğini gösterir.</p>
          </div>
          <Space size={8} wrap>
            <Button size="small" type="text" onClick={() => setAll(true)}>
              Tümünü seç
            </Button>
            <Button size="small" type="text" onClick={() => setAll(false)}>
              Hiçbiri
            </Button>
            <Link to="/templates/components?ai=1" className="tpl-link">
              <RobotOutlined /> Yeni bileşen oluştur
            </Link>
          </Space>
        </div>
        {categories.length > 1 && (
          <Segmented className="tpl-cats" size="small" value={category} onChange={(v) => setCategory(String(v))} options={[{ value: 'ALL', label: 'Tümü' }, ...categories.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))]} />
        )}
        <div className="tpl-tiles" role="group" aria-label="Bileşen seçimi">
          {shown.map((c) => (
            <ComponentTile key={c.id} c={c} selected={isOn(c.key)} onToggle={() => toggle(c)} />
          ))}
        </div>
      </section>

      <section className="tpl-block">
        <div className="tpl-block-head">
          <div>
            <h2>Seçili bölümler</h2>
            <p>Sıra rapordaki sıradır. Her bölümün açıklaması, analizin neyi arayacağını ve raporda neyin öne çıkacağını yönlendirir.</p>
          </div>
        </div>
        {selected.length ? (
          <Collapse
            className="tpl-sections"
            accordion
            defaultActiveKey={selected[0]?.id}
            items={selected.map((s, i) => ({
              key: s.id,
              label: (
                <div className="tpl-sec-label">
                  <span className="tpl-sec-no">{i + 1}</span>
                  <strong>{s.heading || byKey.get(s.componentKey)?.name}</strong>
                  <span className="tpl-sec-meta">
                    {byKey.get(s.componentKey)?.name}
                    {s.sectionDescription.trim() ? '' : ' · açıklama yok'}
                  </span>
                </div>
              ),
              extra: (
                <span className="tpl-sec-move" onClick={(e) => e.stopPropagation()}>
                  <Button size="small" type="text" aria-label={`${s.heading} yukarı`} icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(s.id, -1)} />
                  <Button size="small" type="text" aria-label={`${s.heading} aşağı`} icon={<ArrowDownOutlined />} disabled={i === selected.length - 1} onClick={() => move(s.id, 1)} />
                </span>
              ),
              children: (
                <div className="tpl-sec-form">
                  <label>
                    <span>Başlık</span>
                    <Input aria-label="Bölüm başlığı" value={s.heading} maxLength={160} onChange={(e) => patch(s.id, { heading: e.target.value })} />
                  </label>
                  <label className="wide">
                    <span>Bölüm açıklaması</span>
                    <Input.TextArea
                      aria-label="Bölüm açıklaması"
                      autoSize={{ minRows: 3, maxRows: 8 }}
                      maxLength={4000}
                      value={s.sectionDescription}
                      placeholder="ör. Gümrük müşavirinin beyannamede neyi değiştirmesi gerektiğini öne çıkar."
                      onChange={(e) => patch(s.id, { sectionDescription: e.target.value })}
                    />
                  </label>
                  <div className="tpl-sec-rules">
                    <span>Kaynakta veri yoksa</span>
                    <Segmented
                      size="small"
                      value={s.missingDataRule}
                      onChange={(v) => patch(s.id, { missingDataRule: v as 'NOTE' | 'OMIT' })}
                      options={(['NOTE', 'OMIT'] as const).map((k) => ({ value: k, label: MISSING_RULE_LABELS[k], disabled: s.required && k === 'OMIT' }))}
                    />
                    <Checkbox checked={s.required} onChange={(e) => patch(s.id, { required: e.target.checked, ...(e.target.checked && s.missingDataRule === 'OMIT' ? { missingDataRule: 'NOTE' as const } : {}) })}>
                      Zorunlu
                    </Checkbox>
                  </div>
                </div>
              ),
            }))}
          />
        ) : (
          <Empty description="Henüz bileşen seçilmedi." />
        )}
      </section>

      <Modal title="Rapor önizlemesi · örnek analiz" open={previewOpen} onCancel={() => setPreviewOpen(false)} footer={null} width={960}>
        {preview ? <iframe className="tpl-preview-frame" title="Rapor önizlemesi" sandbox="" srcDoc={preview} /> : <Skeleton active paragraph={{ rows: 12 }} />}
      </Modal>
    </div>
  )
}
