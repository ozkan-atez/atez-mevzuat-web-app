import type {FastifyInstance} from 'fastify'
import {actorContext,hasPermission,type ActorContext} from '../../platform/actor-context'
import {AuthRuntime,type AuthRequestContext} from './runtime'
import {publicAuthRoutes,requiredPermission} from './route-policy'
import {AuthError,assertCsrf} from './security'
declare module 'fastify' {interface FastifyRequest {authContext?:AuthRequestContext;assertSessionActive?:()=>Promise<void>}}
export async function installAuth(app:FastifyInstance,options:{runtime:AuthRuntime;testActor?:ActorContext}) {
 if(options.testActor && process.env.NODE_ENV!=='test')throw new Error('Test aktörü üretimde kullanılamaz.')
 const {runtime}=options
 app.decorateRequest('authContext',undefined)
 app.decorateRequest('assertSessionActive',undefined)
 app.addHook('preHandler',(request,reply,done)=>{
  const route=request.routeOptions.url ?? request.url.split('?')[0]!,method=request.method
  const host=request.headers.host ?? ''
  const allowedHost=runtime.config.apiAllowedHosts.includes(host)||(runtime.config.profile==='local'&&route==='/api/auth/backchannel-logout'&&host==='host.docker.internal:3001')
  if(route!=='/api/health'&&!allowedHost){void reply.code(400).send({category:'HOST_INVALID',message:'Uygulama Host adresi doğrulanamadı.'});return}
  if(publicAuthRoutes.has(`${method} ${route}`)){done();return}
  void (async()=>{
   if(route==='/api/auth/logout'&&method==='POST') {
    const logout=await runtime.authenticateLogout(request.headers.cookie)
    assertCsrf(request.headers.origin,request.headers['x-csrf-token'],logout.session.csrfToken,runtime.config.publicOrigin)
    request.authContext={kind:'logout',actor:null,session:logout};done();return
   }
   if(!['GET','HEAD','OPTIONS'].includes(method) && request.headers.origin!==runtime.config.publicOrigin)throw new AuthError(403,'İstek kaynağı doğrulanamadı.','CSRF_INVALID')
   const session=await runtime.authenticate(request.headers.cookie)
   const actor=options.testActor ?? session.actor
   const permission=requiredPermission(method,route)
   if(permission===undefined && actor.role!=='ADMIN')throw new AuthError(403,'Bu uç için erişim politikası tanımlanmamış.','ROUTE_FORBIDDEN')
   if(permission && !hasPermission(actor,permission))throw new AuthError(403,'Bu işlem için yetkiniz bulunmuyor.','PERMISSION_DENIED')
   if(!['GET','HEAD','OPTIONS'].includes(method))assertCsrf(request.headers.origin,request.headers['x-csrf-token'],session.session.csrfToken,runtime.config.publicOrigin)
   request.authContext={kind:'authenticated',actor,session}
   request.assertSessionActive=async()=>{
    const active=await runtime.authenticate(request.headers.cookie,false,{touch:false})
    if((permission===undefined && active.actor.role!=='ADMIN') || (permission && !hasPermission(active.actor,permission)))throw new AuthError(403,'Bu işlem için yetkiniz artık bulunmuyor.','PERMISSION_DENIED')
    actor.role=active.actor.role;actor.permissions=active.actor.permissions
   }
   actorContext.run(actor,done)
  })().catch(error=>{
   const authError=error instanceof AuthError?error:new AuthError(503,'Oturum hizmeti şu anda kullanılamıyor.','AUTH_SERVICE_UNAVAILABLE')
   void reply.code(authError.statusCode).send({category:authError.statusCode===503?'AUTH_SERVICE_UNAVAILABLE':authError.category,message:authError.message})
  })
 })
 const timer=setInterval(()=>void runtime.sessions.cleanup().catch(()=>undefined),5*60_000);timer.unref()
 app.addHook('onClose',async()=>{clearInterval(timer)})
}
