import { useAuth } from '../../features/auth/AuthProvider'
import { Menu } from 'antd'
import { AppstoreOutlined, FileTextOutlined, MessageOutlined, ThunderboltOutlined, ReadOutlined, SendOutlined, GlobalOutlined, BarChartOutlined, SettingOutlined, BookOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'

const items = [
  { key: '/', icon: <AppstoreOutlined />, label: 'Dashboard', title: 'Dashboard', 'aria-label': 'Dashboard' },
  { key: '/reports', icon: <FileTextOutlined />, label: 'Raporlar', title: 'Raporlar', 'aria-label': 'Raporlar' },
  { key: '/chat', icon: <MessageOutlined />, label: 'Sohbetler', title: 'Sohbetler', 'aria-label': 'Sohbetler' },
  { key: '/automations', icon: <ThunderboltOutlined />, label: 'Otomasyonlar', title: 'Otomasyonlar', 'aria-label': 'Otomasyonlar' },
  { key: '/academy', icon: <ReadOutlined />, label: 'Gelişim Akademisi', title: 'Gelişim Akademisi', 'aria-label': 'Gelişim Akademisi' },
  { type: 'group' as const, key: 'operations', label: 'Operasyon', children: [
    { key: '/groups', icon: <SendOutlined />, label: 'Dağıtım', title: 'Dağıtım', 'aria-label': 'Dağıtım' },
    { key: '/documents', icon: <FileTextOutlined />, label: 'Belgeler', title: 'Belgeler', 'aria-label': 'Belgeler' },
    { key: '/sources', icon: <GlobalOutlined />, label: 'Kaynaklar', title: 'Kaynaklar', 'aria-label': 'Kaynaklar' },
    { key: '/templates', icon: <BookOutlined />, label: 'Şablonlar', title: 'Şablonlar', 'aria-label': 'Şablonlar' },
    { key: '/usage', icon: <BarChartOutlined />, label: 'Kullanım', title: 'Kullanım', 'aria-label': 'Kullanım' },
  ] },
  { type: 'group' as const, key: 'management', label: 'Yönetim', children: [
    { key: '/admin', icon: <SettingOutlined />, label: 'Yönetim', title: 'Yönetim', 'aria-label': 'Yönetim' },
  ] },
]

export function Sidebar() {
  const auth=useAuth()
  const name=auth.session?.user.name||auth.session?.user.email||'Kullanıcı'
  const visibleItems=items.filter(item=>item.key!=='management'||auth.can('admin.manage')).map(item=>item.type==='group'?{...item,children:item.children?.filter(child=>!['/groups','/templates'].includes(child.key)||auth.can('config.manage'))}:item)
  const initials=name.split(/\s+/).slice(0,2).map(word=>word[0]).join('').toLocaleUpperCase('tr-TR')
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const selected = pathname.startsWith('/source-runs') ? '/sources' : pathname.startsWith('/runs') ? '/' : pathname.startsWith('/reports') ? '/reports' : pathname.startsWith('/chat') ? '/chat' : pathname
  return <aside className="atez-sidebar" aria-label="Ana menü">
    <div className="atez-brand" onClick={() => navigate('/')} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') navigate('/') }}>
      <span className="atez-brand-name">Mevzuat <em>Radar</em></span>
    </div>
    <div className="atez-menu-scroll">
      <div className="atez-menu-heading">Çalışma alanı</div>
      <Menu mode="inline" items={visibleItems} selectedKeys={[selected]} onClick={({ key }) => navigate(key)} className="atez-menu" />
    </div>
    <div className="atez-sidebar-foot"><span className="atez-user-avatar">{initials}</span><span className="atez-user-label">{name}<small>{auth.session?.workspace.name??'Çalışma alanı'}</small></span></div>
  </aside>
}
