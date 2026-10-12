import type {FastifyInstance} from 'fastify'
import type {AuthRuntime} from './runtime'
import {validReturnTo} from './config'
import {AuthError,cookieHeader,readOpaqueCookie} from './security'
/** Rate accounting contains no identity or token; persistence belongs to the session store. */
class AuthRateGate {
 private buckets=new Map<string,{count:number;expires:number}>()
 assert(key:string,max:number) {
  const now=Date.now();if(this.buckets.size>4096)for(const [id,bucket]of this.buckets)if(bucket.expires<now)this.buckets.delete(id)
  const bucket=this.buckets.get(key)
  if(bucket && bucket.expires>now){if(++bucket.count>max)throw new AuthError(429,'Çok fazla giriş isteği; kısa süre sonra tekrar deneyin.','RATE_LIMITED')}
  else {if(this.buckets.size>8192)throw new AuthError(429,'Giriş hizmeti yoğun; kısa süre sonra tekrar deneyin.','RATE_LIMITED');this.buckets.set(key,{count:1,expires:now+60_000})}
 }
}
export async function authRoutes(app:FastifyInstance,{runtime}:{runtime:AuthRuntime}) {
 const rate=new AuthRateGate(),config=runtime.config
 const handle=async(reply:any,action:()=>Promise<unknown>)=>{try{return await action()}catch(error){const failure=error instanceof AuthError?error:new AuthError(503,'Kimlik hizmeti şu anda kullanılamıyor.','AUTH_SERVICE_UNAVAILABLE');return reply.code(failure.statusCode).send({category:failure.category,message:failure.message})}}
 app.get('/login',(request,reply)=>handle(reply,async()=>{
  rate.assert(`login:${request.ip}`,30)
  let returnTo:string;try{returnTo=validReturnTo((request.query as {returnTo?:string}).returnTo)}catch{throw new AuthError(400,'Giriş dönüş adresi geçersiz.','RETURN_TO_INVALID')}
  const login=await runtime.sessions.createLogin(returnTo)
  return reply.header('Cache-Control','no-store').header('Set-Cookie',cookieHeader(config.loginCookie,login.handle,config.secureCookie,config.loginTtlSeconds)).redirect(login.url)
 }))
 app.get('/callback',async(request,reply)=>{
  let consumed=false
  try {
  rate.assert(`callback:${request.ip}`,30)
  const browserHandle=readOpaqueCookie(request.headers.cookie,config.loginCookie),url=new URL(request.raw.url!,config.publicOrigin)
  if(!browserHandle||url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1||!url.searchParams.get('code')||url.searchParams.get('code')!.length>2048)throw new AuthError(400,'Giriş dönüşü doğrulanamadı.','LOGIN_INVALID')
  const state=url.searchParams.get('state')!
  if(!/^[A-Za-z0-9_-]{43}$/.test(state))throw new AuthError(400,'Giriş dönüşü doğrulanamadı.','LOGIN_INVALID')
  const flow=await runtime.sessions.consumeLogin(browserHandle,state)
  consumed=true
  let tokens;try{tokens=await runtime.provider.callback(new URL(`${config.redirectUri}${url.search}`),flow.proof)}catch{throw new AuthError(401,'Giriş dönüşü doğrulanamadı; tekrar giriş yapın.','LOGIN_INVALID')}
  const session=await runtime.sessions.createSession(tokens),prior=readOpaqueCookie(request.headers.cookie,config.sessionCookie)
  if(prior)await runtime.sessions.revoke(prior,'SESSION_ROTATED')
  return reply.header('Cache-Control','no-store').header('Set-Cookie',[cookieHeader(config.loginCookie,'',config.secureCookie,0),cookieHeader(config.sessionCookie,session.handle,config.secureCookie,config.absoluteTtlSeconds)]).redirect(`${config.publicOrigin}${flow.returnTo}`)

  }catch(error){
   const category=error instanceof AuthError&&['LOGIN_INVALID','LOGIN_REPLAY','MEMBERSHIP_REQUIRED','MEMBERSHIP_REVOKED'].includes(error.category)?error.category:error instanceof AuthError&&error.statusCode!==503?'LOGIN_INVALID':'AUTH_SERVICE_UNAVAILABLE'
   const cookies=[cookieHeader(config.loginCookie,'',config.secureCookie,0)]
   if(consumed){const prior=readOpaqueCookie(request.headers.cookie,config.sessionCookie);if(prior)await runtime.sessions.revoke(prior,'LOGIN_REJECTED').catch(()=>undefined);cookies.push(cookieHeader(config.sessionCookie,'',config.secureCookie,0))}
   return reply.header('Cache-Control','no-store').header('Set-Cookie',cookies).redirect(`${config.publicOrigin}/login?error=${category}`)
  }
 })
 app.get('/me',(request,reply)=>handle(reply,async()=>{
  const context=request.authContext
  if(!context||context.kind!=='authenticated')throw new AuthError(401,'Giriş yapmanız gerekiyor.')
  return reply.header('Cache-Control','no-store').send({user:context.session.user,workspace:context.session.workspace,role:context.actor.role,permissions:context.actor.permissions,csrfToken:context.session.session.csrfToken})
 }))
 app.post('/logout',(request,reply)=>handle(reply,async()=>{
  const handle=readOpaqueCookie(request.headers.cookie,config.sessionCookie)
  if(!handle)throw new AuthError(401,'Giriş yapmanız gerekiyor.')
  const logoutUrl=await runtime.sessions.logout(handle)
  return reply.header('Cache-Control','no-store').header('Set-Cookie',[cookieHeader(config.sessionCookie,'',config.secureCookie,0),cookieHeader(config.loginCookie,'',config.secureCookie,0)]).send({logoutUrl})
 }))
 app.post('/backchannel-logout',(request,reply)=>handle(reply,async()=>{
  rate.assert(`backchannel:${request.ip}`,300)
  const body=typeof request.body==='string'?new URLSearchParams(request.body).get('logout_token'):(request.body as {logout_token?:unknown}|null)?.logout_token
  if(typeof body!=='string'||body.length>20_000||!body)throw new AuthError(400,'Çıkış bildirimi geçersiz.','LOGOUT_TOKEN_INVALID')
  let claims;try{claims=await runtime.provider.verifyLogout(body)}catch{throw new AuthError(400,'Çıkış bildirimi doğrulanamadı.','LOGOUT_TOKEN_INVALID')}
  await runtime.sessions.backchannelLogout(claims)
  return reply.header('Cache-Control','no-store').code(200).send({status:'ok'})
 }))
 app.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string',bodyLimit:20_000},(_request,body,done)=>done(null,body))
}
