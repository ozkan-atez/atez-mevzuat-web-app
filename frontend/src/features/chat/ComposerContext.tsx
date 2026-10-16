import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Empty, Input, Select, Spin } from 'antd'
import { apiFetch } from '../../lib/apiFetch'

export interface SourceOption { id: string; title: string; url: string; readable?: boolean }
export interface TemplateOption { id: string; name: string }

export function ComposerContext({ sources, template, disabled, sourcesDisabled, onSourcesChange, onTemplateChange }: {
  sources: SourceOption[]; template: TemplateOption | null; disabled: boolean; sourcesDisabled?: boolean
  onSourcesChange: (sources: SourceOption[]) => void; onTemplateChange: (template: TemplateOption | null) => void
}) {
  const [query, setQuery] = useState('')
  const [data, setData] = useState<{sources: SourceOption[]; templates: TemplateOption[]}>({sources: [], templates: []})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null)
    const timer = setTimeout(() => {
      void apiFetch(`/api/v1/chat/context?query=${encodeURIComponent(query)}`, {signal: controller.signal})
        .then(async response => { if (!response.ok) throw new Error('Kaynaklar ve şablonlar alınamadı.'); return response.json() })
        .then(result => { if (!controller.signal.aborted) setData(result) })
        .catch(error => { if (!controller.signal.aborted) setError(error.message) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, retry])
  return <>
    <div className="atez-composer-search-section">
      <div className="atez-composer-archive-heading"><span>Tanımlı kaynaklar</span><span>{sources.length}/10</span></div>
      <Input aria-label="Tanımlı kaynaklarda ara" placeholder="Kaynak ara…" maxLength={200} value={query} allowClear onChange={event => setQuery(event.target.value)} />
    </div>
    {error && <Alert type="error" title={error} action={<Button size="small" onClick={() => setRetry(value => value + 1)}>Yeniden dene</Button>} />}
    <div className="atez-composer-search-section">Kaynaklar sayfasındaki etkin kayıtlar. Mesaj gönderildiğinde yalnızca seçtiğiniz kaynaklar taranır.</div>
    <Spin spinning={loading}><div className="atez-composer-archive-list">
      {!loading && !error && !data.sources.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Kaynaklar sayfasında etkin kaynak bulunamadı." />}
      {data.sources.map(source => <Checkbox key={source.id} checked={sources.some(item => item.id === source.id)} disabled={disabled || sourcesDisabled || loading || (sources.length >= 10 && !sources.some(item => item.id === source.id))} onChange={event => onSourcesChange(event.target.checked ? [...sources, source] : sources.filter(item => item.id !== source.id))}>
        <span title={source.url}>{source.title}</span>
      </Checkbox>)}
    </div></Spin>
    <div className="atez-composer-search-section">
      <div className="atez-composer-archive-heading"><span>Rapor şablonu</span></div>
      <Select getPopupContainer={trigger => trigger.parentElement!} aria-label="Rapor şablonu" placeholder="Şablon seçin" allowClear showSearch optionFilterProp="label" style={{width: '100%'}} loading={loading} disabled={disabled || loading || !!error} value={template?.id} options={data.templates.map(item => ({value: item.id, label: item.name}))} onChange={id => onTemplateChange(data.templates.find(item => item.id === id) ?? null)} />
    </div>
  </>
}
