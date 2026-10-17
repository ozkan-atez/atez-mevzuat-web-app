import type { ReactNode } from 'react'
import { Input, Typography } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { StudioNav } from './StudioNav'
import './connectors.css'

/** Şablonlar ve Bileşen havuzu için ortak üst kısım (Kaynaklar düzeni): başlık, arama, ana eylem, sekmeler. */
export function StudioHeader({ title, subtitle, search, onSearch, searchLabel, action, counts }: { title: string; subtitle: string; search: string; onSearch: (v: string) => void; searchLabel: string; action: ReactNode; counts: ReactNode }) {
  return (
    <>
      <header className="connector-heading">
        <div>
          <Typography.Title level={1}>{title}</Typography.Title>
          <p>{subtitle}</p>
        </div>
        <div className="connector-header-actions">
          <Input className="connector-search" aria-label={searchLabel} prefix={<SearchOutlined />} placeholder={searchLabel} value={search} onChange={(e) => onSearch(e.target.value)} allowClear />
          {action}
        </div>
      </header>
      <div className="connector-toolbar">
        <div className="connector-counts">{counts}</div>
        <StudioNav />
      </div>
    </>
  )
}
