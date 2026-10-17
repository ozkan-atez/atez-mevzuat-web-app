import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Drawer, Empty, Input, List, Popconfirm, Select, Segmented, Skeleton, Space, Switch, Tag, Tooltip, Typography, message } from 'antd'
import { DeleteOutlined, HistoryOutlined, InboxOutlined, PlusOutlined } from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import { Can } from '../auth/Can'
import { studioApi } from './studioApi'
import { CATEGORY_LABELS, ORIGIN_LABELS, STATUS_LABELS, type StudioComponent, type StudioComponentDetail } from './studio-types'
import { StudioNav } from './StudioNav'
import { StudioPreview } from './StudioPreview'
import { ComponentComposerDrawer } from './ComponentComposerDrawer'
import './template-studio.css'

const originColor = { BUILTIN: 'default', USER: 'processing', AI: 'purple' } as const

function ComponentCard({ c, onOpen, onChanged }: { c: StudioComponent; onOpen: () => void; onChanged: () => void }) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    studioApi
      .componentPreview(c.id)
      .then((r) => live && setHtml(r.html))
      .catch((e) => live && setError((e as Error).message))
    return () => {
      live = false
    }
  }, [c.id, c.currentVersion])
  const toggle = async (on: boolean) => {
    setBusy(true)
    try {
      await studioApi.setStatus(c.id, on ? 'ACTIVE' : 'INACTIVE')
      onChanged()
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className={`component-preview-card ${c.status !== 'ACTIVE' ? 'is-inactive' : ''}`}>
      <button className="component-preview-button" aria-label={`${c.name} ayrıntılarını aç`} onClick={onOpen}>
        {error ? <div className="component-preview-loading">Önizleme kullanılamıyor</div> : <StudioPreview html={html} title={`${c.name} önizlemesi`} height={190} compact />}
        <span className="component-preview-expand">
          <HistoryOutlined aria-hidden="true" /> Ayrıntılar
        </span>
      </button>
      <div className="component-preview-caption">
        <div className="component-caption-head">
          <strong>{c.name}</strong>
          {c.status !== 'ARCHIVED' && (
            <Can permission="config.manage">
              <Tooltip title={c.status === 'ACTIVE' ? 'Pasif yapınca yeni şablonlarda listelenmez; mevcut şablonları bozmaz.' : 'Aktifleştir'}>
                <Switch size="small" aria-label={`${c.name} aktif`} checked={c.status === 'ACTIVE'} loading={busy} onChange={(v) => void toggle(v)} />
              </Tooltip>
            </Can>
          )}
        </div>
        <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }}>
          {c.description}
        </Typography.Paragraph>
        <Space size={[4, 4]} wrap>
          <Tag>{CATEGORY_LABELS[c.category]}</Tag>
          <Tag color={originColor[c.origin]}>{ORIGIN_LABELS[c.origin]}</Tag>
          <Tag color={c.status === 'ACTIVE' ? 'success' : c.status === 'ARCHIVED' ? 'warning' : 'default'}>{STATUS_LABELS[c.status]}</Tag>
          <Tag bordered={false}>v{c.currentVersion}</Tag>
          {!!c.usage && <Tag bordered={false}>{c.usage} şablon sürümünde</Tag>}
        </Space>
      </div>
    </article>
  )
}

function ComponentDetailDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<StudioComponentDetail | null>(null)
  const [version, setVersion] = useState<number | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [feedback, holder] = message.useMessage()
  useEffect(() => {
    setDetail(null)
    setVersion(null)
    if (id) void studioApi.component(id).then(setDetail)
  }, [id])
  const v = version ?? detail?.currentVersion
  useEffect(() => {
    setHtml(null)
    if (id && v) void studioApi.componentPreview(id, v).then((r) => setHtml(r.html))
  }, [id, v])
  const remove = async () => {
    const r = await studioApi.removeComponent(id!)
    void feedback.success(r.result === 'DELETED' ? 'Bileşen silindi.' : `Bileşen ${r.usage} şablon sürümünde kullanıldığı için arşivlendi; eski raporlar kendi sürümüyle render edilmeye devam eder.`)
    onChanged()
    onClose()
  }
  const def = detail?.versions.find((x) => x.version === v)?.definition ?? detail?.definition
  return (
    <Drawer title={detail?.name ?? 'Bileşen'} open={!!id} onClose={onClose} size="min(1000px, 100vw)" className="component-detail-drawer">
      {holder}
      {!detail ? (
        <Skeleton active />
      ) : (
        <div className="component-detail">
          <div className="component-detail-main">
            <div className="component-large-preview">
              <StudioPreview html={html} title={`${detail.name} v${v}`} height={420} />
            </div>
            <Typography.Paragraph type="secondary">{detail.description}</Typography.Paragraph>
            <dl className="component-facts">
              <dt>Görünme kuralı</dt>
              <dd>
                <code>{def?.appliesWhen || 'her zaman görünür'}</code>
              </dd>
              <dt>Veri bağları</dt>
              <dd>{def?.bindings.length ? def.bindings.map((b) => <Tag key={b} bordered={false} className="binding-tag">{b}</Tag>) : '—'}</dd>
              <dt>Yazılacak alanlar</dt>
              <dd>
                {def?.slots.length
                  ? def.slots.map((s) => (
                      <Tooltip key={s.key} title={s.instruction}>
                        <Tag>{s.key}</Tag>
                      </Tooltip>
                    ))
                  : '—'}
              </dd>
            </dl>
          </div>
          <aside className="component-detail-side">
            <Typography.Title level={5}>Sürüm geçmişi</Typography.Title>
            <List
              size="small"
              dataSource={detail.versions}
              renderItem={(x) => (
                <List.Item className={x.version === v ? 'is-selected' : ''} onClick={() => setVersion(x.version)} style={{ cursor: 'pointer' }}>
                  <List.Item.Meta title={`v${x.version}${x.version === detail.currentVersion ? ' · güncel' : ''}`} description={`${new Date(x.createdAt).toLocaleString('tr-TR')}${x.note ? ` · ${x.note}` : ''}`} />
                </List.Item>
              )}
            />
            <Typography.Title level={5}>Kullanım</Typography.Title>
            <Typography.Paragraph type="secondary">{detail.usage ? `${detail.usage} şablon sürümünde kullanılıyor.` : 'Hiçbir şablonda kullanılmıyor.'}</Typography.Paragraph>
            {detail.origin !== 'BUILTIN' && detail.status !== 'ARCHIVED' && (
              <Can permission="config.manage">
                <Popconfirm
                  title={detail.usage ? 'Bileşen arşivlensin mi?' : 'Bileşen kalıcı olarak silinsin mi?'}
                  description={detail.usage ? 'Kullanımda olduğu için silinemez; arşivlenir.' : 'Hiçbir şablonda kullanılmıyor.'}
                  okText={detail.usage ? 'Arşivle' : 'Sil'}
                  cancelText="Vazgeç"
                  onConfirm={() => void remove()}
                >
                  <Button danger icon={detail.usage ? <InboxOutlined /> : <DeleteOutlined />}>
                    {detail.usage ? 'Arşivle' : 'Sil'}
                  </Button>
                </Popconfirm>
              </Can>
            )}
            {detail.origin === 'BUILTIN' && <Alert type="info" title="Yerleşik bileşenler koddan sürümlenir." />}
          </aside>
        </div>
      )}
    </Drawer>
  )
}

export function ComponentPoolPage() {
  const [params, setParams] = useSearchParams()
  const [items, setItems] = useState<StudioComponent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<string>('')
  const [category, setCategory] = useState<string | undefined>()
  const [origin, setOrigin] = useState<string | undefined>()
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const composerOpen = params.get('ai') === '1'
  const load = useCallback(async () => {
    setError('')
    try {
      setItems(await studioApi.components({ status, category, origin }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [status, category, origin])
  useEffect(() => {
    void load()
  }, [load])
  const visible = useMemo(() => items.filter((c) => !q || `${c.name} ${c.description}`.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'))), [items, q])

  return (
    <div className="atez-demo-page studio-page">
      <div className="atez-demo-heading">
        <div>
          <Typography.Title level={1}>Bileşen havuzu</Typography.Title>
          <Typography.Paragraph type="secondary">Raporların yapı taşları. Kartlar örnek analizle canlı render edilir; pasif bileşenler şablonlarda seçilemez. Yeni bileşen sohbetten oluşturulur.</Typography.Paragraph>
        </div>
      </div>
      <div className="studio-toolbar">
        <StudioNav />
      </div>
      <div className="studio-filters">
        <Input.Search allowClear placeholder="Ara…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} aria-label="Bileşen ara" />
        <Select allowClear placeholder="Kategori" value={category} onChange={setCategory} style={{ minWidth: 200 }} options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))} aria-label="Kategori" />
        <Segmented
          value={status}
          onChange={(v) => setStatus(String(v))}
          options={[
            { value: '', label: 'Tümü' },
            { value: 'ACTIVE', label: 'Aktif' },
            { value: 'INACTIVE', label: 'Pasif' },
            { value: 'ARCHIVED', label: 'Arşiv' },
          ]}
        />
        <Select allowClear placeholder="Kaynak" value={origin} onChange={setOrigin} style={{ minWidth: 140 }} options={Object.entries(ORIGIN_LABELS).map(([value, label]) => ({ value, label }))} aria-label="Kaynak" />
        <Typography.Text type="secondary" className="studio-count">
          {visible.length} bileşen
        </Typography.Text>
      </div>
      {error && <Alert type="error" showIcon title="Bileşenler yüklenemedi" description={error} action={<Button onClick={() => void load()}>Yeniden dene</Button>} />}
      {loading ? (
        <div className="component-preview-grid pool">{[0, 1, 2, 3, 4, 5].map((i) => <Card key={i}><Skeleton active /></Card>)}</div>
      ) : visible.length ? (
        <div className="component-preview-grid pool">
          {visible.map((c) => (
            <ComponentCard key={c.id} c={c} onOpen={() => setOpenId(c.id)} onChanged={() => void load()} />
          ))}
        </div>
      ) : (
        <Empty description="Bu filtrelerle bileşen yok.">
          <Button icon={<PlusOutlined />} onClick={() => setParams({ ai: '1' })}>
            AI ile oluştur
          </Button>
        </Empty>
      )}
      <ComponentDetailDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} />
      <ComponentComposerDrawer open={composerOpen} onClose={() => setParams({})} onSaved={() => void load()} />
    </div>
  )
}
