import type {PrismaClient,AuthSession} from '@prisma/client'
import {resolveActorContext,type ActorContext} from '../../platform/actor-context'
import type {AuthConfig} from './config'
import {createHash} from 'node:crypto'
import {AuthError,digest,encryptSecret,decryptSecret,randomHandle,constantEqual} from './security'
import type {AuthProvider,ProviderTokens,LoginProof,LogoutClaims} from './provider'
export interface SessionView {actor:ActorContext;session:AuthSession;user:{id:string;email:string;name:string|null};workspace:{id:string;name:string}}
const context=(id:string,config:AuthConfig)=>`session:${id}:${config.issuer}:${config.clientId}`
export class AuthSessionStore {
 constructor(readonly prisma:PrismaClient,readonly config:AuthConfig,readonly provider:AuthProvider) {}
 async createLogin(returnTo:string) {
  const handle=randomHandle(),idHash=digest(handle),proof:LoginProof={state:randomHandle(),nonce:randomHandle(),verifier:randomHandle()}
  const url=await this.provider.authorizationUrl(proof)
  await this.prisma.authLoginAttempt.create({data:{idHash,stateHash:digest(proof.state),issuer:this.config.issuer,clientId:this.config.clientId,encryptedPayload:encryptSecret(proof,this.config.encryptionKey,this.config.encryptionKeyId,`login:${idHash}`),returnTo,expiresAt:new Date(Date.now()+this.config.loginTtlSeconds*1000)}})
  return {handle,url}
 }
 async consumeLogin(handle:string,state:string) {
  const idHash=digest(handle),attempt=await this.prisma.authLoginAttempt.findUnique({where:{idHash}})
  if(!attempt||attempt.issuer!==this.config.issuer||attempt.clientId!==this.config.clientId||attempt.expiresAt.getTime()<=Date.now()||!constantEqual(attempt.stateHash,digest(state)))throw new AuthError(400,'Giriş isteği geçersiz veya süresi dolmuş.','LOGIN_INVALID')
  if(attempt.consumedAt)throw new AuthError(400,'Giriş isteği daha önce kullanılmış.','LOGIN_REPLAY')
  const consumed=await this.prisma.authLoginAttempt.updateMany({where:{idHash,consumedAt:null,expiresAt:{gt:new Date()},stateHash:digest(state)},data:{consumedAt:new Date()}})
  if(consumed.count!==1)throw new AuthError(400,'Giriş isteği daha önce kullanılmış.','LOGIN_REPLAY')
  return {proof:decryptSecret<LoginProof>(attempt.encryptedPayload,this.config.encryptionKey,this.config.encryptionKeyId,`login:${idHash}`),returnTo:attempt.returnTo}
 }
 async createSession(tokens:ProviderTokens) {
  const identity=await this.prisma.externalIdentity.findUnique({where:{issuer_subject:{issuer:this.config.issuer,subject:tokens.subject}},include:{user:true}})
  const workspace=await this.prisma.workspace.findUnique({where:{key:this.config.workspaceKey}})
  if(!identity?.user.isActive||!workspace)throw new AuthError(403,'Bu uygulamaya erişim üyeliğiniz bulunmuyor.','MEMBERSHIP_REQUIRED')
  const actor=await resolveActorContext(this.prisma,{userId:identity.userId,identityId:identity.id,workspaceId:workspace.id})
  if(!actor)throw new AuthError(403,'Bu uygulamaya erişim üyeliğiniz bulunmuyor.','MEMBERSHIP_REQUIRED')
  const handle=randomHandle(),idHash=digest(handle),csrfToken=randomHandle(),now=Date.now()
  await this.prisma.$transaction(async tx=>{
   await lockLogoutTargets(tx,this.config.issuer,this.config.clientId,tokens.subject,tokens.sid)
   const priorLogout=await tx.logoutReplay.findFirst({where:{issuer:this.config.issuer,clientId:this.config.clientId,expiresAt:{gt:new Date()},issuedAt:{gte:new Date(tokens.issuedAt*1000)},OR:[...(tokens.sid?[{providerSid:tokens.sid}]:[]),{providerSid:null,subject:tokens.subject}]}})
   if(priorLogout)throw new AuthError(401,'Sağlayıcı oturumu kapatılmış; yeniden giriş yapın.','LOGIN_INVALID')
   await tx.authSession.create({data:{idHash,userId:actor.userId,identityId:actor.identityId,workspaceId:actor.workspaceId,issuer:this.config.issuer,clientId:this.config.clientId,subject:tokens.subject,providerSid:tokens.sid??null,csrfToken,encryptedTokens:encryptSecret(tokens,this.config.encryptionKey,this.config.encryptionKeyId,context(idHash,this.config)),accessExpiresAt:new Date(tokens.expiresAt),idleExpiresAt:new Date(now+this.config.idleTtlSeconds*1000),absoluteExpiresAt:new Date(now+this.config.absoluteTtlSeconds*1000)}})
  })
  return {handle,actor,csrfToken}
 }
 async revoke(handle:string,reason='LOGOUT') {return this.revokeHash(digest(handle),reason)}
 async revokeHash(idHash:string,reason:string) {
  return this.prisma.authSession.updateMany({where:{idHash,revoked:false},data:{revoked:true,revokedAt:new Date(),reason,encryptedTokens:null,refreshOwner:null,refreshUntil:null,version:{increment:1}}})
 }
 async authenticateLogout(handle:string):Promise<{session:AuthSession}> {
  const session=await this.prisma.authSession.findUnique({where:{idHash:digest(handle)}})
  if(!session||session.issuer!==this.config.issuer||session.clientId!==this.config.clientId)throw new AuthError(401,'Çıkış için oturum doğrulanamadı.')
  return{session}
 }
 async authenticate(handle:string,options:{allowExpiredAccess?:boolean;touch?:boolean}={}):Promise<SessionView> {
  const idHash=digest(handle)
  let session=await this.prisma.authSession.findUnique({where:{idHash}})
  const valid=(row:AuthSession|null)=>row&&!row.revoked&&row.issuer===this.config.issuer&&row.clientId===this.config.clientId&&row.idleExpiresAt.getTime()>Date.now()&&row.absoluteExpiresAt.getTime()>Date.now()
  if(!valid(session)) {if(session&&!session.revoked)await this.revokeHash(idHash,'EXPIRED_OR_CONFIG_CHANGED');throw new AuthError(401,'Oturum sona erdi; yeniden giriş yapın.')}
  try{if(!session!.encryptedTokens)throw new AuthError(401,'Oturum doğrulanamadı.');decryptSecret<ProviderTokens>(session!.encryptedTokens,this.config.encryptionKey,this.config.encryptionKeyId,context(idHash,this.config))}catch{await this.revokeHash(idHash,'TOKEN_STATE_INVALID');throw new AuthError(401,'Oturum doğrulanamadı; yeniden giriş yapın.')}
  let actor=await resolveActorContext(this.prisma,{userId:session!.userId,identityId:session!.identityId,workspaceId:session!.workspaceId})
  if(!actor||actor.issuer!==this.config.issuer||actor.subject!==session!.subject){await this.revokeHash(idHash,'MEMBERSHIP_REVOKED');throw new AuthError(403,'Uygulama üyeliğiniz veya erişim izniniz etkin değil.','MEMBERSHIP_REVOKED')}
  if(!options.allowExpiredAccess && session!.accessExpiresAt.getTime()<Date.now()+30_000) {
   session=await this.refresh(session!)
   actor=await resolveActorContext(this.prisma,{userId:session.userId,identityId:session.identityId,workspaceId:session.workspaceId})
   if(!actor)throw new AuthError(403,'Uygulama üyeliğiniz etkin değil.','MEMBERSHIP_REVOKED')
  }
  if(!valid(session))throw new AuthError(401,'Oturum sona erdi; yeniden giriş yapın.')
  if(options.touch!==false) {
   const touched=await this.prisma.authSession.updateMany({where:{idHash,version:session!.version,revoked:false,idleExpiresAt:{gt:new Date()},absoluteExpiresAt:{gt:new Date()}},data:{lastSeenAt:new Date(),idleExpiresAt:new Date(Math.min(Date.now()+this.config.idleTtlSeconds*1000,session!.absoluteExpiresAt.getTime()))}})
   if(!touched.count)throw new AuthError(401,'Oturum sona erdi; yeniden giriş yapın.')
  }
  const [user,workspace]=await Promise.all([this.prisma.user.findUniqueOrThrow({where:{id:actor.userId},select:{id:true,email:true,name:true}}),this.prisma.workspace.findUniqueOrThrow({where:{id:actor.workspaceId},select:{id:true,name:true}})])
  return {actor:{...actor,sessionId:idHash},session:session!,user,workspace}
 }
 async refresh(current:AuthSession):Promise<AuthSession> {
  const idHash=current.idHash,owner=randomHandle()
  if(current.refreshOwner && current.refreshUntil && current.refreshUntil.getTime()<=Date.now()){await this.revokeHash(idHash,'REFRESH_UNCERTAIN');throw new AuthError(401,'Oturum yenilemesi doğrulanamadı; yeniden giriş yapın.')}
  const claimed=await this.prisma.authSession.updateMany({where:{idHash,version:current.version,revoked:false,refreshOwner:null,idleExpiresAt:{gt:new Date()},absoluteExpiresAt:{gt:new Date()}},data:{refreshOwner:owner,refreshUntil:new Date(Date.now()+30_000)}})
  if(!claimed.count) {
   for(let attempt=0;attempt<20;attempt++) {
    await new Promise(resolve=>setTimeout(resolve,50))
    const row=await this.prisma.authSession.findUnique({where:{idHash}})
    if(!row||row.revoked)throw new AuthError(401,'Oturum sona erdi; yeniden giriş yapın.')
    if(row.version!==current.version && !row.refreshOwner && row.accessExpiresAt.getTime()>Date.now())return row
   }
   throw new AuthError(503,'Oturum yenileniyor; kısa bir süre sonra tekrar deneyin.','AUTH_SERVICE_UNAVAILABLE')
  }
  try {
   if(!current.encryptedTokens)throw new AuthError(401,'Oturum doğrulanamadı; yeniden giriş yapın.')
   const prior=decryptSecret<ProviderTokens>(current.encryptedTokens,this.config.encryptionKey,this.config.encryptionKeyId,context(idHash,this.config)),tokens=await this.provider.refresh(prior)
   if(tokens.subject!==current.subject)throw new AuthError(401,'Oturum kimliği değişti; yeniden giriş yapın.')
   const actor=await resolveActorContext(this.prisma,{userId:current.userId,identityId:current.identityId,workspaceId:current.workspaceId})
   if(!actor)throw new AuthError(403,'Uygulama üyeliğiniz etkin değil.','MEMBERSHIP_REVOKED')
   const replaced=await this.prisma.authSession.updateMany({where:{idHash,version:current.version,refreshOwner:owner,revoked:false,refreshUntil:{gt:new Date()},idleExpiresAt:{gt:new Date()},absoluteExpiresAt:{gt:new Date()}},data:{encryptedTokens:encryptSecret(tokens,this.config.encryptionKey,this.config.encryptionKeyId,context(idHash,this.config)),accessExpiresAt:new Date(tokens.expiresAt),providerSid:tokens.sid??current.providerSid,version:{increment:1},refreshOwner:null,refreshUntil:null}})
   if(!replaced.count)throw new AuthError(401,'Oturum sona erdi; yeniden giriş yapın.')
   return this.prisma.authSession.findUniqueOrThrow({where:{idHash}})
  }catch(error){await this.revokeHash(idHash,'REFRESH_FAILED');if(error instanceof AuthError)throw error;throw new AuthError(503,'Kimlik sağlayıcısına ulaşılamıyor; yeniden giriş gerekebilir.','AUTH_SERVICE_UNAVAILABLE')}
 }
 async logout(handle:string) {
  const row=await this.prisma.authSession.findUnique({where:{idHash:digest(handle)}})
  let tokens:ProviderTokens|undefined
  if(row?.encryptedTokens)try{tokens=decryptSecret<ProviderTokens>(row.encryptedTokens,this.config.encryptionKey,this.config.encryptionKeyId,context(row.idHash,this.config))}catch{/* Durable local revocation still succeeds. */}
  await this.revoke(handle)
  if(tokens)await this.provider.revoke(tokens).catch(()=>undefined)
  return this.provider.logoutUrl().catch(()=>`${this.config.publicOrigin}/login`)
 }
 async backchannelLogout(claims:LogoutClaims) {
  try{return await this.prisma.$transaction(async tx=>{
   await lockLogoutTargets(tx,claims.issuer,this.config.clientId,claims.subject,claims.sid)
   await tx.logoutReplay.create({data:{clientId:this.config.clientId,providerSid:claims.sid??null,subject:claims.subject??null,issuedAt:new Date(claims.issuedAt*1000),issuer:claims.issuer,jtiHash:digest(claims.jti),expiresAt:new Date((claims.issuedAt+600)*1000)}})
   return tx.authSession.updateMany({where:{issuer:claims.issuer,clientId:this.config.clientId,revoked:false,...(claims.sid?{providerSid:claims.sid}:{subject:claims.subject!}),...(claims.sid&&claims.subject?{subject:claims.subject}:{})},data:{revoked:true,revokedAt:new Date(),reason:'PROVIDER_LOGOUT',encryptedTokens:null,refreshOwner:null,refreshUntil:null,version:{increment:1}}})
  })}catch(error){if((error as {code?:string}).code==='P2002')throw new AuthError(400,'Çıkış bildirimi daha önce kullanılmış.','LOGOUT_REPLAY');throw error}
 }
 async cleanup() {const now=new Date();await Promise.all([this.prisma.authLoginAttempt.deleteMany({where:{expiresAt:{lt:now}}}),this.prisma.authSession.deleteMany({where:{absoluteExpiresAt:{lt:now}}}),this.prisma.logoutReplay.deleteMany({where:{expiresAt:{lt:now}}})])}
}

async function lockLogoutTargets(tx:import('@prisma/client').Prisma.TransactionClient,issuer:string,clientId:string,subject?:string,sid?:string) {
 const targets=[...(subject?[`subject:${subject}`]:[]),...(sid?[`sid:${sid}`]:[])].sort()
 for(const target of targets){const lock=createHash('sha256').update(`oidc:${issuer}:${clientId}:${target}`).digest().readBigInt64BE();await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lock})`}
}
