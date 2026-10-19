import { useState } from 'react'
import { useAuth } from '../../features/auth/AuthProvider'
import { Button, Dropdown, Empty, Popover, Space, Tooltip, message } from 'antd'
import { BellOutlined, DownOutlined, MoonOutlined, SunOutlined, BgColorsOutlined } from '@ant-design/icons'
import { useLocation } from 'react-router-dom'
import { useTheme, type Palette } from './ThemeProvider'

const titles: Record<string, string> = { '/': 'Dashboard', '/runs': 'Taramalar', '/documents': 'Belgeler', '/operations': 'İşlemler', '/reports': 'Raporlar', '/chat': 'Sohbetler', '/automations': 'Otomasyonlar', '/groups': 'Dağıtım', '/sources': 'Kaynaklar', '/source-runs': 'Kaynak taraması', '/templates/components': 'Bileşen havuzu', '/templates': 'Şablonlar', '/usage': 'Kullanım', '/admin': 'Yönetim' }
const palettes: { key: Palette; label: string; color: string }[] = [
  { key: 'violet', label: 'Mor Neon', color: '#c5aff5' },
  { key: 'ocean', label: 'Okyanus Mavi', color: '#73dcff' },
  { key: 'emerald', label: 'Emerald Yeşil', color: '#57e3ae' },
  { key: 'aurora', label: 'Aurora', color: '#ffb8ef' },
]

export function Navbar() {
  const auth=useAuth()
  const [loggingOut,setLoggingOut]=useState(false)
  const [feedback,holder]=message.useMessage()
  const userName=auth.session?.user.name||auth.session?.user.email||'Hesap'
  const roleLabel=({ADMIN:'Yönetici',EDITOR:'Düzenleyici',VIEWER:'Görüntüleyici'} as const)[auth.session?.role??'VIEWER']
  const { pathname } = useLocation()
  const { appearance, setAppearance, palette, setPalette } = useTheme()
  const root = Object.keys(titles).filter((key) => key !== '/' && pathname.startsWith(key)).sort((a, b) => b.length - a.length)[0] ?? '/'
  return <header className="atez-topbar">{holder}
    <div className="atez-breadcrumb">Çalışma alanı <span>/</span> <strong>{root === '/runs' && pathname.includes('/reports/') ? 'Rapor ayrıntısı' : titles[root]}</strong></div>
    <Space size={8} className="atez-header-actions">
      <Dropdown menu={{items:[{key:'identity',disabled:true,label:<span>{userName}<small style={{display:'block'}}>{roleLabel}</small></span>},{key:'logout',label:loggingOut?'Çıkış yapılıyor…':'Çıkış yap',disabled:loggingOut}],onClick:({key})=>{if(key==='logout'){setLoggingOut(true);void auth.logout().catch(error=>void feedback.error(error.message)).finally(()=>setLoggingOut(false))}}}} trigger={['click']}><Button type="text" className="atez-team-indicator" aria-label="Kullanıcı menüsü"><i /> {auth.session?.workspace.name??'Çalışma alanı'} <DownOutlined /></Button></Dropdown>
      <Tooltip title={appearance === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'}>
        <Button className="atez-top-button" icon={appearance === 'dark' ? <SunOutlined /> : <MoonOutlined />} aria-label={appearance === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'} onClick={() => setAppearance(appearance === 'dark' ? 'light' : 'dark')} />
      </Tooltip>
      <Dropdown menu={{ items: palettes.map(({ key, label, color }) => ({ key, label: <span className="atez-palette-item"><i style={{ background: color }} />{label}{palette === key && <span>✓</span>}</span> })), onClick: ({ key }) => setPalette(key as Palette) }} trigger={['click']}>
        <Button className="atez-top-button" icon={<BgColorsOutlined />} aria-label="Renk paleti seç" />
      </Dropdown>
      <Popover title="Bildirimler" content={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Yeni bildirim yok." />} trigger="click" placement="bottomRight">
        <Button className="atez-top-button" icon={<BellOutlined />} aria-label="Bildirimler" />
      </Popover>
    </Space>
  </header>
}
