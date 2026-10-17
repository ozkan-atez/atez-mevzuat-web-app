import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, Checkbox, Empty, Form, Input, List, Modal, Segmented, Skeleton, Space, Switch, Tabs, Tag, Tooltip, Typography, message } from 'antd'
import { AppstoreAddOutlined, ArrowDownOutlined, ArrowLeftOutlined, ArrowUpOutlined, DeleteOutlined, HolderOutlined, PlusOutlined, RedoOutlined, RobotOutlined, StarFilled, UndoOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { Can } from '../auth/Can'
import { studioApi, StudioRequestError } from './studioApi'
import { CATEGORY_LABELS, MISSING_RULE_LABELS, type StudioComponent, type TemplateDefinitionV2, type TemplateFullV2, type TemplateRowV2, type TemplateSectionV2 } from './studio-types'
import { StudioNav } from './StudioNav'
import { StudioPreview } from './StudioPreview'
import './template-studio.css'

const STATE_LABELS: Record<string, { text: string; color: string }> = {
  RENDERED: { text: 'görünür', color: 'success' },
  OMITTED: { text: 'kaynakta yok · gizlenir', color: 'default' },
  NOTE: { text: 'kaynakta yok · not', color: 'warning' },
}
/** Sunucu jsonb anahtarlarını yeniden sıralar; kirli/temiz karşılaştırması sıradan bağımsız. */
const stable = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x))
const sorted = (d: TemplateDefinitionV2) => [...d.sections].sort((a, b) => a.order - b.order)

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function TemplatesPage() {
  const [rows, setRows] = useState<TemplateRowV2[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
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
      setEditing(t.id)
    } catch (e) {
      void feedback.error((e as Error).message)
    }
  }
  if (editing) return <TemplateEditor id={editing} onBack={() => { setEditing(null); void load() }} />
  return (
    <div className="atez-demo-page studio-page">
      {holder}
      <div className="atez-demo-heading">
        <div>
          <Typography.Title level={1}>Rapor şablonları</Typography.Title>
          <Typography.Paragraph type="secondary">Raporun hangi bölümlerden, hangi sırayla ve hangi vurguyla oluşacağı. Yeni şablonda havuzdaki bütün aktif bileşenler açık gelir.</Typography.Paragraph>
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
        <div className="template-card-grid">{[0, 1].map((i) => <Card key={i}><Skeleton active /></Card>)}</div>
      ) : rows.length ? (
        <div className="template-card-grid">
          {rows.map((t) => (
            <Card key={t.id} title={t.title} extra={<Space size={4}>{t.isDefault && <Tag color="success" icon={<StarFilled />}>Varsayılan</Tag>}<Tag>v{t.currentVersion}</Tag></Space>}>
              <Typography.Paragraph type="secondary">Güncellendi: {new Date(t.updatedAt).toLocaleString('tr-TR')}</Typography.Paragraph>
              <div className="atez-source-footer">
                <Can permission="config.manage">
                  <Button onClick={() => setEditing(t.id)}>Şablonu düzenle</Button>
                </Can>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Empty description="İlk rapor şablonunuzu oluşturun." />
      )}
      <Modal title="Yeni şablon" open={creating} onCancel={() => setCreating(false)} onOk={() => void create()} okText="Oluştur" cancelText="Vazgeç">
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="title" label="Şablon adı" rules={[{ required: true, message: 'Şablon adı gerekli' }]}>
            <Input maxLength={160} placeholder="ör. Müşteri bülteni — otomotiv" />
          </Form.Item>
          <Form.Item name="description" label="Açıklama">
            <Input maxLength={1000} />
          </Form.Item>
          <Form.Item name="brief" label="Brief" tooltip="Raporun amacı, hedef kitle, ton ve genel vurgu. Analiz ve rapor yazımı bu metni görür.">
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} maxLength={4000} placeholder="ör. Otomotiv ithalatçıları için; kısa ve uygulamaya dönük; önce maliyet etkisini, sonra belge yükümlülüklerini öne çıkar." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

function TemplateEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const [base, setBase] = useState<TemplateFullV2 | null>(null)
  const [draft, setDraftState] = useState<TemplateDefinitionV2 | null>(null)
  const [past, setPast] = useState<TemplateDefinitionV2[]>([])
  const [future, setFuture] = useState<TemplateDefinitionV2[]>([])
  const [components, setComponents] = useState<StudioComponent[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState('section')
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ html: string; sections: { id: string; state: string }[] } | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState<{ sectionId: string; sectionDescription: string }[] | null>(null)
  const [feedback, holder] = message.useMessage()
  const draftRef = useRef(draft)
  draftRef.current = draft

  const reload = useCallback(async () => {
    const [t, c] = await Promise.all([studioApi.template(id), studioApi.components()])
    setBase(t)
    setDraftState(t.definition)
    setComponents(c)
    setSelected((s) => s ?? sorted(t.definition)[0]?.id ?? null)
  }, [id])
  useEffect(() => {
    void reload().catch((e) => void feedback.error((e as Error).message))
  }, [reload, feedback])

  const change = (fn: (d: TemplateDefinitionV2) => TemplateDefinitionV2) => {
    const cur = draftRef.current
    if (!cur) return
    const next = fn(cur)
    setPast((p) => [...p, cur].slice(-80))
    setFuture([])
    setDraftState(next)
    draftRef.current = next
  }
  const undo = () => {
    const last = past.at(-1)
    if (!last || !draft) return
    setFuture((f) => [draft, ...f])
    setPast((p) => p.slice(0, -1))
    setDraftState(last)
  }
  const redo = () => {
    const next = future[0]
    if (!next || !draft) return
    setPast((p) => [...p, draft])
    setFuture((f) => f.slice(1))
    setDraftState(next)
  }
  const dirty = !!draft && !!base && stable(draft) !== stable(base.definition)

  const debounced = useDebounced(draft, 400)
  useEffect(() => {
    if (!debounced) return
    let live = true
    studioApi
      .previewTemplate(debounced)
      .then((p) => {
        if (live) {
          setPreview(p)
          setPreviewError('')
        }
      })
      .catch((e) => live && setPreviewError((e as Error).message))
    return () => {
      live = false
    }
  }, [debounced])

  const byKey = useMemo(() => new Map(components.map((c) => [c.key, c])), [components])
  const states = useMemo(() => new Map((preview?.sections ?? []).map((s) => [s.id, s.state])), [preview])
  const sections = draft ? sorted(draft) : []
  const sel = sections.find((s) => s.id === selected) ?? null

  const patch = (sid: string, p: Partial<TemplateSectionV2>) => change((d) => ({ ...d, sections: d.sections.map((s) => (s.id === sid ? { ...s, ...p } : s)) }))
  const move = (from: string, to: string) =>
    change((d) => {
      const list = sorted(d)
      const i = list.findIndex((s) => s.id === from)
      const j = list.findIndex((s) => s.id === to)
      if (i < 0 || j < 0 || i === j) return d
      const [m] = list.splice(i, 1)
      list.splice(j, 0, m!)
      return { ...d, sections: list.map((s, k) => ({ ...s, order: k })) }
    })
  const step = (sid: string, delta: number) => {
    const i = sections.findIndex((s) => s.id === sid)
    const target = sections[i + delta]
    if (target) move(sid, target.id)
  }
  const addFromPool = (c: StudioComponent) => {
    change((d) => {
      let sid = c.key
      for (let n = 2; d.sections.some((s) => s.id === sid); n++) sid = `${c.key}-${n}`
      return { ...d, sections: [...d.sections, { id: sid, componentKey: c.key, componentVersion: c.currentVersion, enabled: true, order: d.sections.length, heading: c.name, sectionDescription: '', required: false, missingDataRule: 'OMIT' }] }
    })
    setAdding(false)
  }
  const removeSection = (sid: string) => change((d) => ({ ...d, sections: sorted(d).filter((s) => s.id !== sid).map((s, k) => ({ ...s, order: k })) }))

  const save = async () => {
    if (!draft) return
    if (!draft.title.trim()) {
      void feedback.error('Şablon adı gerekli.')
      return
    }
    setSaving(true)
    try {
      const r = await studioApi.saveTemplate(id, draft)
      await reload()
      setPast([])
      setFuture([])
      void feedback.success(`Şablon kaydedildi (sürüm ${r.version}).`)
    } catch (e) {
      const err = e as StudioRequestError
      Modal.error({ title: err.message, content: err.issues?.length ? <ul className="studio-issues">{err.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null })
    } finally {
      setSaving(false)
    }
  }
  const back = () => {
    if (dirty) Modal.confirm({ title: 'Kaydedilmemiş değişiklikler var', content: 'Çıkarsanız bu değişiklikler kaybolur.', okText: 'Kaydetmeden çık', cancelText: 'Düzenlemeye devam et', onOk: onBack })
    else onBack()
  }
  const suggest = async () => {
    if (!draft) return
    setSuggesting(true)
    try {
      setSuggestions((await studioApi.describe(draft)).suggestions)
    } catch (e) {
      void feedback.error((e as Error).message)
    } finally {
      setSuggesting(false)
    }
  }

  if (!draft || !base) return <div className="template-studio"><Skeleton active paragraph={{ rows: 10 }} /></div>
  return (
    <div className="template-studio v2">
      {holder}
      <div className="template-studio-toolbar">
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={back} disabled={saving}>
            Şablonlar
          </Button>
          <Typography.Title level={3}>Rapor şablonu</Typography.Title>
          <Tag>Sürüm {base.version}</Tag>
          {base.isDefault && <Tag color="success" icon={<StarFilled />}>Varsayılan</Tag>}
        </Space>
        <Space>
          <Typography.Text type="secondary">{dirty ? 'Kaydedilmemiş değişiklikler' : 'Kaydedildi'}</Typography.Text>
          <Button aria-label="Geri al" icon={<UndoOutlined />} disabled={!past.length || saving} onClick={undo} />
          <Button aria-label="İleri al" icon={<RedoOutlined />} disabled={!future.length || saving} onClick={redo} />
          {!base.isDefault && (
            <Button onClick={() => void studioApi.setDefault(id).then(reload)} disabled={saving}>
              Varsayılan yap
            </Button>
          )}
          <Can permission="config.manage">
            <Button type="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
              Şablonu kaydet
            </Button>
          </Can>
        </Space>
      </div>

      <Card className="template-info-card" size="small">
        <div className="template-info v2">
          <label>
            Şablon adı
            <Input value={draft.title} maxLength={160} onChange={(e) => change((d) => ({ ...d, title: e.target.value }))} />
          </label>
          <label>
            Açıklama
            <Input value={draft.description} maxLength={1000} onChange={(e) => change((d) => ({ ...d, description: e.target.value }))} />
          </label>
          <label className="brief">
            <span>
              Brief <Typography.Text type="secondary">· raporun amacı, hedef kitle, ton, genel vurgu</Typography.Text>
            </span>
            <Input.TextArea aria-label="Şablon brief" autoSize={{ minRows: 2, maxRows: 5 }} maxLength={4000} value={draft.brief} onChange={(e) => change((d) => ({ ...d, brief: e.target.value }))} />
          </label>
        </div>
      </Card>

      <div className="template-editor-grid">
        <Card
          className="template-sections-card"
          title={
            <span>
              Rapor bölümleri <Tag>{sections.filter((s) => s.enabled).length}/{sections.length} açık</Tag>
            </span>
          }
          size="small"
        >
          <ol className="template-section-list" aria-label="Rapor bölümleri">
            {sections.map((s, i) => {
              const c = byKey.get(s.componentKey)
              const st = s.enabled ? states.get(s.id) : undefined
              return (
                <li
                  key={s.id}
                  draggable
                  onDragStart={() => setDragId(s.id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dragId && move(dragId, s.id)}
                  className={[selected === s.id && 'is-selected', !s.enabled && 'is-off', dragId === s.id && 'is-dragging'].filter(Boolean).join(' ')}
                  onClick={() => {
                    setSelected(s.id)
                    setTab('section')
                  }}
                >
                  <HolderOutlined className="section-grip" aria-hidden="true" />
                  <div className="section-text">
                    <strong>{s.heading || c?.name || s.componentKey}</strong>
                    <span>
                      {c ? CATEGORY_LABELS[c.category] : s.componentKey} · v{s.componentVersion}
                      {s.sectionDescription.trim() ? ' · açıklamalı' : ''}
                    </span>
                    {st && <Tag color={STATE_LABELS[st]?.color} bordered={false}>{STATE_LABELS[st]?.text}</Tag>}
                  </div>
                  <span className="section-actions" onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="Yukarı">
                      <Button size="small" type="text" aria-label={`${s.heading} yukarı`} icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => step(s.id, -1)} />
                    </Tooltip>
                    <Tooltip title="Aşağı">
                      <Button size="small" type="text" aria-label={`${s.heading} aşağı`} icon={<ArrowDownOutlined />} disabled={i === sections.length - 1} onClick={() => step(s.id, 1)} />
                    </Tooltip>
                    <Switch size="small" aria-label={`${s.heading} açık`} checked={s.enabled} onChange={(v) => patch(s.id, { enabled: v })} />
                  </span>
                </li>
              )
            })}
          </ol>
          <div className="template-section-foot">
            <Button icon={<AppstoreAddOutlined />} onClick={() => setAdding(true)}>
              Havuzdan ekle
            </Button>
            <Link to="/templates/components?ai=1">Yeni bileşen oluştur →</Link>
          </div>
        </Card>

        <Card className="template-preview-card" title="Önizleme · örnek analiz" size="small">
          {previewError && <Alert type="warning" showIcon title="Önizleme alınamadı" description={previewError} />}
          <StudioPreview html={preview?.html} title="Rapor önizlemesi" height={880} />
        </Card>

        <Card className="template-settings-card" size="small">
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: 'section',
                label: 'Bölüm',
                children: sel ? (
                  <Form layout="vertical" className="section-form">
                    <Typography.Paragraph type="secondary">
                      Bileşen: <strong>{byKey.get(sel.componentKey)?.name ?? sel.componentKey}</strong> <Tag bordered={false}>v{sel.componentVersion}</Tag>
                    </Typography.Paragraph>
                    <Form.Item label="Başlık">
                      <Input aria-label="Bölüm başlığı" value={sel.heading} maxLength={160} onChange={(e) => patch(sel.id, { heading: e.target.value })} />
                    </Form.Item>
                    <Form.Item
                      label="Bölüm açıklaması"
                      extra="Bu bölümde nelere önem verilsin, içerikte ne istensin? Analiz bu bilgiyi kaynakta arar; rapor yazımı bunu en önemli yönlendirme olarak uygular. Kaynakta olmayan bilgi eklenmez."
                    >
                      <Input.TextArea
                        aria-label="Bölüm açıklaması"
                        autoSize={{ minRows: 7, maxRows: 14 }}
                        maxLength={4000}
                        showCount
                        value={sel.sectionDescription}
                        placeholder={'ör. Gümrük müşavirinin beyannamede neyi değiştirmesi gerektiğini öne çıkar.\nSayısal artışı tek cümlede yorumla; belge yükümlülüklerini madde madde ver.'}
                        onChange={(e) => patch(sel.id, { sectionDescription: e.target.value })}
                      />
                    </Form.Item>
                    <Form.Item>
                      <Checkbox checked={sel.required} onChange={(e) => patch(sel.id, { required: e.target.checked, ...(e.target.checked && sel.missingDataRule === 'OMIT' ? { missingDataRule: 'NOTE' as const } : {}) })}>
                        Zorunlu bölüm
                      </Checkbox>
                    </Form.Item>
                    <Form.Item label="Kaynakta veri yoksa">
                      <Segmented
                        value={sel.missingDataRule}
                        onChange={(v) => patch(sel.id, { missingDataRule: v as 'NOTE' | 'OMIT' })}
                        options={(['NOTE', 'OMIT'] as const).map((k) => ({ value: k, label: MISSING_RULE_LABELS[k], disabled: sel.required && k === 'OMIT' }))}
                      />
                    </Form.Item>
                    <Button danger type="text" icon={<DeleteOutlined />} onClick={() => removeSection(sel.id)}>
                      Bölümü şablondan çıkar
                    </Button>
                  </Form>
                ) : (
                  <Empty description="Soldan bir bölüm seçin." />
                ),
              },
              {
                key: 'ai',
                label: 'AI önerisi',
                children: (
                  <div className="section-form">
                    <Typography.Paragraph type="secondary">Brief’ten her açık bölüm için açıklama önerir. Bölüm yapısı, sırası ve bileşenler değişmez; öneriyi uygulamadan önce görürsünüz.</Typography.Paragraph>
                    <Button icon={<RobotOutlined />} loading={suggesting} disabled={!draft.brief.trim()} onClick={() => void suggest()}>
                      Bölüm açıklamalarını öner
                    </Button>
                    {!draft.brief.trim() && <Typography.Paragraph type="secondary">Önce brief yazın.</Typography.Paragraph>}
                    {suggestions && (
                      <>
                        <List
                          size="small"
                          className="suggestion-list"
                          dataSource={suggestions}
                          renderItem={(s) => <List.Item><List.Item.Meta title={sections.find((x) => x.id === s.sectionId)?.heading} description={s.sectionDescription} /></List.Item>}
                        />
                        <Space>
                          <Button onClick={() => setSuggestions(null)}>Vazgeç</Button>
                          <Button
                            type="primary"
                            onClick={() => {
                              const m = new Map(suggestions.map((s) => [s.sectionId, s.sectionDescription]))
                              change((d) => ({ ...d, sections: d.sections.map((s) => (m.has(s.id) ? { ...s, sectionDescription: m.get(s.id)! } : s)) }))
                              setSuggestions(null)
                            }}
                          >
                            Uygula
                          </Button>
                        </Space>
                      </>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </Card>
      </div>

      <Modal title="Havuzdan ekle" open={adding} onCancel={() => setAdding(false)} footer={null} width={720}>
        <Typography.Paragraph type="secondary">Yalnızca aktif bileşenler listelenir. Yeni bileşen için bileşen havuzundaki AI panelini kullanın.</Typography.Paragraph>
        <List
          className="pool-pick"
          dataSource={components.filter((c) => c.status === 'ACTIVE')}
          renderItem={(c) => (
            <List.Item actions={[<Button key="add" size="small" onClick={() => addFromPool(c)}>Ekle</Button>]}>
              <List.Item.Meta
                title={
                  <Space>
                    {c.name}
                    {sections.some((s) => s.componentKey === c.key) && <Tag bordered={false}>şablonda var</Tag>}
                  </Space>
                }
                description={`${CATEGORY_LABELS[c.category]} · v${c.currentVersion} — ${c.description}`}
              />
            </List.Item>
          )}
        />
      </Modal>
    </div>
  )
}
