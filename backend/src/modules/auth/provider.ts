import * as oidc from 'openid-client'
import {createRemoteJWKSet,jwtVerify,customFetch as joseCustomFetch} from 'jose'
import {Agent,fetch as undiciFetch} from 'undici'
import {readFile} from 'node:fs/promises'
import type {AuthConfig} from './config'
import {AuthError} from './security'
export interface LoginProof {state:string;nonce:string;verifier:string}
export interface ProviderTokens {accessToken:string;refreshToken:string;idToken:string;expiresAt:number;subject:string;issuedAt:number;sid?:string}
export interface LogoutClaims {issuer:string;jti:string;issuedAt:number;subject?:string;sid?:string}
export interface AuthProvider {
 authorizationUrl(proof:LoginProof):Promise<string>;
 callback(url:URL,proof:LoginProof):Promise<ProviderTokens>;
 refresh(tokens:ProviderTokens):Promise<ProviderTokens>;
 logoutUrl(tokens?:ProviderTokens):Promise<string>;
 revoke(tokens:ProviderTokens):Promise<void>;
 verifyLogout(token:string):Promise<LogoutClaims>;
}
export async function createOidcProvider(config:AuthConfig):Promise<AuthProvider> {
 const issuer=new URL(config.issuer),agent=config.caFile?new Agent({connect:{ca:await readFile(config.caFile,'utf8')}}):undefined
 const guardedFetch=async(input:string,init?:{headers?:Headers|Record<string,string>;method?:string;body?:unknown;signal?:AbortSignal;redirect?:'manual';duplex?:'half'}):Promise<Response>=>{
  const url=new URL(input)
  if(url.origin!==issuer.origin||url.username||url.password)throw new AuthError(503,'Kimlik sağlayıcısı adresi doğrulanamadı.','PROVIDER_UNAVAILABLE')
  const result=await undiciFetch(url.href,{...init,redirect:'manual',...(agent?{dispatcher:agent}:{}),signal:AbortSignal.any([...(init?.signal?[init.signal]:[]),AbortSignal.timeout(config.providerTimeoutSeconds*1000)])} as Parameters<typeof undiciFetch>[1])
  if(result.status>=300&&result.status<400)throw new AuthError(503,'Kimlik sağlayıcısı yönlendirmesi doğrulanamadı.','PROVIDER_UNAVAILABLE')
  return result as unknown as Response
 }
 const client=await oidc.discovery(issuer,config.clientId,{client_secret:config.clientSecret,id_token_signed_response_alg:'RS256'},oidc.ClientSecretBasic(config.clientSecret),{timeout:config.providerTimeoutSeconds,[oidc.customFetch]:guardedFetch,execute:[...(config.profile==='local'&&issuer.protocol==='http:'?[oidc.allowInsecureRequests]:[]),oidc.enableNonRepudiationChecks]})
 const metadata=client.serverMetadata()
 if(metadata.issuer!==config.issuer)throw new AuthError(503,'Kimlik sağlayıcısı issuer bilgisi uyuşmuyor.','PROVIDER_UNAVAILABLE')
 for(const key of ['authorization_endpoint','token_endpoint','jwks_uri','end_session_endpoint'] as const){const value=metadata[key];if(!value)throw new Error('Kimlik sağlayıcısı metadata bilgisi eksik.');const url=new URL(value);if(url.origin!==issuer.origin||url.username||url.password)throw new Error('Kimlik sağlayıcısı metadata adresi doğrulanamadı.')}
 client[oidc.customFetch]=guardedFetch
 const jwks=createRemoteJWKSet(new URL(metadata.jwks_uri!),{[joseCustomFetch]:guardedFetch,timeoutDuration:config.providerTimeoutSeconds*1000})
 const toTokens=(tokens:Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>,previous?:ProviderTokens):ProviderTokens=>{
  const claims=tokens.claims(),subject=claims?.sub ?? previous?.subject
  if(!subject||!tokens.access_token||!Number.isFinite(tokens.expires_in)||Number(tokens.expires_in)<=0||(!previous&&!tokens.id_token)||(!tokens.refresh_token&&!previous?.refreshToken)||(claims&&claims.iss!==config.issuer)||(previous&&subject!==previous.subject))throw new AuthError(401,'Kimlik sağlayıcısı yanıtı doğrulanamadı.')
  return{accessToken:tokens.access_token,refreshToken:tokens.refresh_token??previous!.refreshToken,idToken:tokens.id_token??previous!.idToken,expiresAt:Date.now()+Number(tokens.expires_in)*1000,subject,issuedAt:typeof claims?.iat==='number'?claims.iat:previous!.issuedAt,...(typeof claims?.sid==='string'?{sid:claims.sid}:previous?.sid?{sid:previous.sid}:{})}
 }
 return {
  authorizationUrl:async(proof)=>oidc.buildAuthorizationUrl(client,{redirect_uri:config.redirectUri,scope:'openid profile email',response_type:'code',state:proof.state,nonce:proof.nonce,code_challenge:await oidc.calculatePKCECodeChallenge(proof.verifier),code_challenge_method:'S256'}).href,
  callback:async(url,proof)=>toTokens(await oidc.authorizationCodeGrant(client,url,{pkceCodeVerifier:proof.verifier,expectedState:proof.state,expectedNonce:proof.nonce,idTokenExpected:true})),
  refresh:async(tokens)=>toTokens(await oidc.refreshTokenGrant(client,tokens.refreshToken),tokens),
  logoutUrl:async(tokens)=>oidc.buildEndSessionUrl(client,{client_id:config.clientId,post_logout_redirect_uri:config.logoutRedirectUri,}).href,
  revoke:async(tokens)=>{if(metadata.revocation_endpoint){const url=new URL(metadata.revocation_endpoint);if(url.origin===issuer.origin)await oidc.tokenRevocation(client,tokens.refreshToken,{token_type_hint:'refresh_token'})}},
  verifyLogout:async(token)=>{
   const {payload}=await jwtVerify(token,jwks,{issuer:config.issuer,audience:config.clientId,algorithms:['RS256'],requiredClaims:['iss','aud','iat','jti','events'],maxTokenAge:300,clockTolerance:5})
   const events=payload.events
   if(typeof payload.jti!=='string'||!payload.jti||payload.jti.length>512||(payload.sid!==undefined&&(typeof payload.sid!=='string'||!payload.sid))||(payload.sub!==undefined&&!payload.sub)||payload.nonce!==undefined||!events||typeof events!=='object'||Array.isArray(events)||!Object.hasOwn(events,'http://schemas.openid.net/event/backchannel-logout')||typeof (events as Record<string,unknown>)['http://schemas.openid.net/event/backchannel-logout']!=='object'||Array.isArray((events as Record<string,unknown>)['http://schemas.openid.net/event/backchannel-logout'])||!(events as Record<string,unknown>)['http://schemas.openid.net/event/backchannel-logout']||(!payload.sub&&(typeof payload.sid!=='string'||!payload.sid))||typeof payload.iat!=='number'||payload.iat>Date.now()/1000+5)throw new AuthError(400,'Çıkış bildirimi doğrulanamadı.','LOGOUT_TOKEN_INVALID')
   return{issuer:config.issuer,jti:payload.jti,issuedAt:payload.iat,...(payload.sub?{subject:payload.sub}:{}),...(typeof payload.sid==='string'?{sid:payload.sid}:{})}
  },
 }
}
