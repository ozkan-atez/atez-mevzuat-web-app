import { Segmented } from 'antd'
import { AppstoreOutlined, FileTextOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'

/** Şablon stüdyosu sekmeleri: şablon oluşturma ve bileşen oluşturma ayrı süreçlerdir (§10.1). */
export function StudioNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const value = pathname.startsWith('/templates/components') ? 'components' : 'templates'
  return (
    <Segmented
      className="studio-nav"
      value={value}
      onChange={(v) => navigate(v === 'components' ? '/templates/components' : '/templates')}
      options={[
        { value: 'templates', label: 'Şablonlar', icon: <FileTextOutlined /> },
        { value: 'components', label: 'Bileşen havuzu', icon: <AppstoreOutlined /> },
      ]}
    />
  )
}
