import { Segmented } from 'antd'
import { AppstoreOutlined, FileTextOutlined, HistoryOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'

/** Şablon stüdyosu sekmeleri: şablon oluşturma ve bileşen oluşturma ayrı süreçlerdir (§10.1). */
export function StudioNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const value = pathname.startsWith('/templates/components') ? 'components' : pathname.startsWith('/templates/legacy') ? 'legacy' : 'templates'
  return (
    <Segmented
      className="studio-nav"
      value={value}
      onChange={(v) => navigate(v === 'components' ? '/templates/components' : v === 'legacy' ? '/templates/legacy' : '/templates')}
      options={[
        { value: 'templates', label: 'Şablonlar', icon: <FileTextOutlined /> },
        { value: 'components', label: 'Bileşen havuzu', icon: <AppstoreOutlined /> },
        { value: 'legacy', label: 'Eski şablonlar', icon: <HistoryOutlined /> },
      ]}
    />
  )
}
