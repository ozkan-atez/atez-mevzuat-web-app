import { Button, Result, Spin } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { LoginPage } from './LoginPage'
export function ForbiddenPage() { const auth=useAuth(),navigate=useNavigate();return <Result status="403" title="Bu sayfaya erişim yetkiniz yok" subTitle={auth.error??'İzinleriniz bu işlemi kapsamıyor.'} extra={<Button onClick={()=>{auth.clearForbidden();navigate('/reports')}}>Raporlara dön</Button>} /> }
export function RequireSession() {
  const auth=useAuth(),location=useLocation()
  if(auth.status==='loading')return <div className="atez-auth-page"><Spin size="large" description="Oturum kontrol ediliyor…" /></div>
  if(auth.status==='anonymous')return <LoginPage returnTo={`${location.pathname}${location.search}`} />
  if(auth.status==='forbidden')return <ForbiddenPage />
  if(auth.status==='unavailable')return <Result status="warning" title="Giriş hizmetine ulaşılamıyor" subTitle={auth.error??'Biraz sonra yeniden deneyin.'} extra={<Button onClick={()=>void auth.reload()}>Yeniden dene</Button>} />
  return <Outlet />
}
export function RequirePermission({permission}:{permission:string}) { return useAuth().can(permission)?<Outlet />:<ForbiddenPage /> }
