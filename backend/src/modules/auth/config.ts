export interface AuthConfig {
 profile:'local'|'company'; publicOrigin:string; issuer:string; clientId:string; clientSecret:string; redirectUri:string; logoutRedirectUri:string;
 encryptionKey:Buffer; encryptionKeyId:string; workspaceKey:string; idleTtlSeconds:number; absoluteTtlSeconds:number; loginTtlSeconds:number;
 sessionCookie:string; loginCookie:string; secureCookie:boolean; apiAllowedHosts:string[]; caFile?:string; providerTimeoutSeconds:number;
}
const loopback=(host:string)=>['localhost','127.0.0.1','[::1]'].includes(host)
const bounded=(value:string|undefined,fallback:number,min:number,max:number)=>{const n=value===undefined?fallback:Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new Error('Geçersiz oturum süresi yapılandırması.');return n}
export function loadAuthConfig(env:Record<string,string|undefined>=process.env):AuthConfig {
 const profile=env.AUTH_PROFILE;if(profile!=='local'&&profile!=='company')throw new Error('AUTH_PROFILE local veya company olarak açıkça yapılandırılmalıdır.')
 const required=(name:string)=>{const value=env[name]?.trim();if(!value)throw new Error(`Kimlik yapılandırması eksik: ${name}`);return value}
 const publicUrl=new URL(required('APP_PUBLIC_ORIGIN')),issuerUrl=new URL(required('OIDC_ISSUER_URL')),redirect=new URL(required('OIDC_REDIRECT_URI')),logout=new URL(required('OIDC_POST_LOGOUT_REDIRECT_URI'))
 for(const url of [publicUrl,issuerUrl,redirect,logout]) {
  if(url.username||url.password||url.hash)throw new Error('Kimlik adresleri kullanıcı bilgisi veya fragment içeremez.')
  if(url.protocol!=='https:' && !(profile==='local'&&url.protocol==='http:'&&loopback(url.hostname)))throw new Error('Kimlik adresleri HTTPS olmalıdır; HTTP yalnız yerel loopback profilinde kullanılabilir.')
 }
 if(publicUrl.pathname!=='/'||publicUrl.search||issuerUrl.search||redirect.search||logout.search)throw new Error('Kimlik adresi yapılandırması geçersiz.')
 if(redirect.origin!==publicUrl.origin||redirect.pathname!=='/api/auth/callback'||logout.origin!==publicUrl.origin)throw new Error('Callback ve çıkış adresleri tanımlı uygulama originine ait olmalıdır.')
 const encodedKey=required('SESSION_ENCRYPTION_KEY')
 const key=/^[a-fA-F0-9]{64}$/.test(encodedKey)?Buffer.from(encodedKey,'hex'):Buffer.from(encodedKey,'base64')
 if(key.length!==32)throw new Error('SESSION_ENCRYPTION_KEY 32 baytlık base64 anahtar olmalıdır.')
 if(env.SESSION_ENCRYPTION_KEY_ID && !/^[A-Za-z0-9_-]{1,32}$/.test(env.SESSION_ENCRYPTION_KEY_ID))throw new Error('Şifreleme anahtarı sürümü geçersiz.')
 const secureCookie=publicUrl.protocol==='https:'
 const hosts=env.AUTH_API_ALLOWED_HOSTS?.trim() ? env.AUTH_API_ALLOWED_HOSTS.split(',').map(s=>s.trim()).filter(Boolean) : [publicUrl.host,...(profile==='local'?['localhost:3001','127.0.0.1:3001']:[])]
 if(!hosts.length||hosts.some(h=>/[\s/\\@?#]/.test(h)))throw new Error('API Host allowlist geçersiz.')
 return {profile,publicOrigin:publicUrl.origin,issuer:issuerUrl.href.replace(/\/$/,''),clientId:required('OIDC_CLIENT_ID'),clientSecret:required('OIDC_CLIENT_SECRET'),redirectUri:redirect.href,logoutRedirectUri:logout.href,encryptionKey:key,encryptionKeyId:env.SESSION_ENCRYPTION_KEY_ID ?? 'v1',workspaceKey:env.AUTH_WORKSPACE_KEY ?? 'atez',idleTtlSeconds:bounded(env.SESSION_IDLE_TTL_SECONDS,1800,60,86400),absoluteTtlSeconds:bounded(env.SESSION_ABSOLUTE_TTL_SECONDS,28800,300,604800),loginTtlSeconds:300,sessionCookie:secureCookie?'__Host-atez_session':'atez_session',loginCookie:secureCookie?'__Host-atez_login':'atez_login',secureCookie,apiAllowedHosts:hosts,...(env.OIDC_CA_FILE?{caFile:env.OIDC_CA_FILE}:{}),providerTimeoutSeconds:10}
}
export function validReturnTo(value:unknown):string {
 if(value===undefined)return '/'
 if(typeof value!=='string'||value.length>2000||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020]/.test(value))throw new Error('Geçersiz giriş dönüş adresi.')
 const decoded=decodeURIComponent(value)
 if(decoded.startsWith('//')||/[\\\u0000-\u0020]/.test(decoded))throw new Error('Geçersiz giriş dönüş adresi.')
 const url=new URL(value,'https://application.invalid')
 if(url.origin!=='https://application.invalid'||url.pathname.startsWith('/api/auth/'))throw new Error('Geçersiz giriş dönüş adresi.')
 return `${url.pathname}${url.search}${url.hash}`
}
