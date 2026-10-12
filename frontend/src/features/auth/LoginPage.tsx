import { Button, Card, Space, Typography, Alert, Result, Spin } from 'antd'
import { LoginOutlined } from '@ant-design/icons'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import atezLogo from '../../assets/atez-logo.png'
import './auth.css'
export function safeReturnTo(value: string | null | undefined) { return value?.startsWith('/')&&!value.startsWith('//')&&!value.includes('\\')&&!/[\u0000-\u001f\u007f]|%2f|%5c/i.test(value)&&!/^\/(?:api|login)(?:\/|\?|$)/.test(value)?value:'/' }
export function loginHref(returnTo:string) { return `/api/auth/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}` }
export function LoginPage({returnTo,expired}:{returnTo?:string;expired?:boolean}) {
  const auth=useAuth(),[params]=useSearchParams(),location=useLocation()
  const callbackError=params.get('error')
  const callbackMessage=({LOGIN_INVALID:'Giriş isteği doğrulanamadı veya süresi doldu. Yeniden giriş yapın.',MEMBERSHIP_REQUIRED:'Bu çalışma alanına erişim izniniz yok. Hesabınızın yetkilendirilmesi için yöneticinize başvurun.',AUTH_SERVICE_UNAVAILABLE:'Giriş hizmetine şu anda ulaşılamıyor. Biraz sonra yeniden deneyin.'} as Record<string,string>)[callbackError??'']??'Giriş tamamlanamadı. Yeniden deneyin.'
  const destination=safeReturnTo(returnTo??params.get('returnTo'))
  if(auth.status==='loading')return <main className="atez-auth-page"><Spin size="large" /></main>
  if(auth.status==='unavailable')return <Result status="warning" title="Giriş hizmetine ulaşılamıyor" subTitle={auth.error??'Biraz sonra yeniden deneyin.'} extra={<Button onClick={()=>void auth.reload()}>Yeniden dene</Button>} />
  if(auth.status==='forbidden')return <Result status="403" title="Çalışma alanına erişim yetkiniz yok" subTitle={auth.error} extra={<Button onClick={()=>void auth.reload()}>Yeniden kontrol et</Button>} />
  if(auth.status==='authenticated'&&location.pathname==='/login')return <Navigate to={destination} replace />
  return <main className="atez-auth-page"><Card className="atez-auth-card"><Space orientation="vertical" size="large" style={{width:'100%'}}><img src={atezLogo} alt="ATEZ" className="atez-auth-logo" /><div><Typography.Title level={2}>Mevzuat Radar'a giriş yapın</Typography.Title><Typography.Paragraph type="secondary">Raporlarınız, belgeleriniz ve çalışma alanınız tek yerde.</Typography.Paragraph></div>{params.has('error')&&<Alert type={callbackError==='MEMBERSHIP_REQUIRED'?'error':'warning'} showIcon title={callbackMessage} />}{(expired??auth.expired)&&<Alert type="info" showIcon title="Oturumunuz sona erdi. Devam etmek için yeniden giriş yapın." />}<Button aria-label="Kurumsal hesapla giriş yap" type="primary" size="large" icon={<LoginOutlined />} href={loginHref(destination)} block>Kurumsal hesapla giriş yap</Button><Typography.Text type="secondary">Giriş için kurumunuzun güvenli giriş ekranına yönlendirilirsiniz.</Typography.Text></Space></Card></main>
}
