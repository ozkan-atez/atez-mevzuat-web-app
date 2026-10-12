import type {PrismaClient} from '@prisma/client'
import type {ActorContext} from '../../platform/actor-context'
import {loadAuthConfig,type AuthConfig} from './config'
import {createOidcProvider,type AuthProvider} from './provider'
import {AuthSessionStore,type SessionView} from './session-store'
import {AuthError,readOpaqueCookie} from './security'
export class AuthRuntime {
 readonly sessions:AuthSessionStore
 constructor(readonly prisma:PrismaClient,readonly config:AuthConfig,readonly provider:AuthProvider){this.sessions=new AuthSessionStore(prisma,config,provider)}
 async authenticateLogout(cookieHeader:string|undefined) {
  const handle=readOpaqueCookie(cookieHeader,this.config.sessionCookie)
  if(!handle)throw new AuthError(401,'Çıkış için oturum doğrulanamadı.')
  return this.sessions.authenticateLogout(handle)
 }
 async authenticate(cookieHeader:string|undefined,allowExpiredAccess=false,options:{touch?:boolean}={}):Promise<SessionView> {
  const handle=readOpaqueCookie(cookieHeader,this.config.sessionCookie)
  if(!handle)throw new AuthError(401,'Giriş yapmanız gerekiyor.')
  return this.sessions.authenticate(handle,{allowExpiredAccess,...options})
 }
}
export async function createAuthRuntime(options:{prisma:PrismaClient;config?:AuthConfig;provider?:AuthProvider}):Promise<AuthRuntime> {
 if(options.provider && process.env.NODE_ENV!=='test')throw new Error('Sahte kimlik sağlayıcısı yalnız açık test enjeksiyonunda kullanılabilir.')
 const config=options.config ?? loadAuthConfig()
 // A provider outage must not prevent the API from revoking an existing local
 // session after restart. Discovery is required by identity operations, not DB logout.
 let cached:Promise<AuthProvider>|null=null
 let resolved:AuthProvider|null=null
 const load=()=>cached ??= createOidcProvider(config).then(provider=>{resolved=provider;return provider}).catch(error=>{cached=null;throw error})
 const provider=options.provider ?? {
  authorizationUrl:async proof=>(await load()).authorizationUrl(proof),
  callback:async(url,proof)=>(await load()).callback(url,proof),
  refresh:async tokens=>(await load()).refresh(tokens),
  revoke:async tokens=>(await load()).revoke(tokens),
  verifyLogout:async token=>(await load()).verifyLogout(token),
  logoutUrl:async()=>{
   if(resolved)return resolved.logoutUrl()
   const url=new URL(`${config.issuer}/protocol/openid-connect/logout`)
   url.searchParams.set('client_id',config.clientId);url.searchParams.set('post_logout_redirect_uri',config.logoutRedirectUri)
   return url.href
  },
 } satisfies AuthProvider
 return new AuthRuntime(options.prisma,config,provider)
}
export type AuthRequestContext = {kind:'authenticated';actor:ActorContext;session:SessionView}|{kind:'logout';actor:null;session:{session:import('@prisma/client').AuthSession}}
