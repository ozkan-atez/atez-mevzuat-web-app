import {createServer,type IncomingMessage,type ServerResponse} from 'node:http'
import {createHash} from 'node:crypto'
import {describe,it,expect} from 'vitest'
import {generateKeyPair,exportJWK,SignJWT} from 'jose'
import {createOidcProvider} from '../../src/modules/auth/provider'
import {loadAuthConfig} from '../../src/modules/auth/config'
async function fixture() {
 const keys=await generateKeyPair('RS256'),jwk=await exportJWK(keys.publicKey);Object.assign(jwk,{kid:'fixture-key',alg:'RS256',use:'sig'})
 let issuer='',nonce='',challenge='',wrongAudience=false,wrongNonce=false
 const sign=async(payload:Record<string,unknown>,aud='client')=>new SignJWT(payload).setProtectedHeader({alg:'RS256',kid:'fixture-key'}).setIssuer(issuer).setAudience(aud).setSubject('subject').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey)
 const server=createServer(async(req:IncomingMessage,res:ServerResponse)=>{
  res.setHeader('Content-Type','application/json')
  if(req.url==='/realm/.well-known/openid-configuration'){res.end(JSON.stringify({issuer,authorization_endpoint:`${issuer}/authorize`,token_endpoint:`${issuer}/token`,jwks_uri:`${issuer}/jwks`,end_session_endpoint:`${issuer}/logout`,response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_basic']}));return}
  if(req.url==='/realm/jwks'){res.end(JSON.stringify({keys:[jwk]}));return}
  if(req.url==='/realm/token'){
   let body='';for await(const part of req)body+=part.toString();const params=new URLSearchParams(body)
   if(params.get('grant_type')==='authorization_code' && createHash('sha256').update(params.get('code_verifier') ?? '').digest('base64url')!==challenge){res.statusCode=400;res.end(JSON.stringify({error:'invalid_grant'}));return}
   res.end(JSON.stringify({access_token:'server-access',refresh_token:'server-refresh',token_type:'Bearer',expires_in:300,id_token:await sign({sid:'provider-session',...(params.get('grant_type')==='authorization_code'?{nonce:wrongNonce?'wrong':nonce}:{})},wrongAudience?'wrong-client':'client')}));return
  }
  res.statusCode=404;res.end('{}')
 })
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as {port:number};issuer=`http://127.0.0.1:${address.port}/realm`
 const config=loadAuthConfig({AUTH_PROFILE:'local',APP_PUBLIC_ORIGIN:'http://localhost:5173',OIDC_ISSUER_URL:issuer,OIDC_CLIENT_ID:'client',OIDC_CLIENT_SECRET:'fixture-secret',OIDC_REDIRECT_URI:'http://localhost:5173/api/auth/callback',OIDC_POST_LOGOUT_REDIRECT_URI:'http://localhost:5173/login',SESSION_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64')})
 const provider=await createOidcProvider(config)
 return{provider,sign,setProof:(proof:{nonce:string;verifier:string})=>{nonce=proof.nonce;challenge=createHash('sha256').update(proof.verifier).digest('base64url')},wrongAudience:()=>{wrongAudience=true},wrongNonce:()=>{wrongNonce=true},close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}}
}
describe('actual OIDC signature and PKCE validation against local protocol fixtures',()=>{
 it('validates signed code nonce audience and refresh; never exposes ID token in logoutURL',async()=>{const f=await fixture();try{const proof={state:'state',nonce:'nonce',verifier:'x'.repeat(43)};f.setProof(proof);const auth=new URL(await f.provider.authorizationUrl(proof));expect(auth.searchParams.get('code_challenge_method')).toBe('S256');const tokens=await f.provider.callback(new URL('http://localhost:5173/api/auth/callback?code=one&state=state'),proof);expect(tokens.subject).toBe('subject');expect((await f.provider.refresh(tokens)).refreshToken).toBe('server-refresh');expect(await f.provider.logoutUrl(tokens)).not.toContain(tokens.idToken)}finally{await f.close()}})
 it('rejects wrong state, nonce and audience with no application session',async()=>{for(const mode of ['state','nonce','audience']){const f=await fixture();try{const proof={state:'state',nonce:'nonce',verifier:'x'.repeat(43)};f.setProof(proof);if(mode==='nonce')f.wrongNonce();if(mode==='audience')f.wrongAudience();await expect(f.provider.callback(new URL(`http://localhost:5173/api/auth/callback?code=one&state=${mode==='state'?'wrong':'state'}`),proof)).rejects.toThrow()}finally{await f.close()}}})
 it('validates signed backchannel logout and rejects nonce, wrong audience, missing events and malformed signature',async()=>{const f=await fixture();try{const event={'http://schemas.openid.net/event/backchannel-logout':{}},valid=await f.sign({jti:'logout1',events:event,sid:'provider-session'});expect(await f.provider.verifyLogout(valid)).toMatchObject({jti:'logout1',sid:'provider-session',subject:'subject'});for(const token of [await f.sign({jti:'logout2',events:event,sid:'provider-session',nonce:'forbidden'}),await f.sign({jti:'logout3',events:event,sid:'provider-session'},'wrong'),await f.sign({jti:'logout4',sid:'provider-session'}),valid.slice(0,-10)+'corrupted'])await expect(f.provider.verifyLogout(token)).rejects.toThrow()}finally{await f.close()}})
 it('keeps separate local issuer configurations isolated',async()=>{const a=await fixture(),b=await fixture();try{const token=await a.sign({jti:'logout',events:{'http://schemas.openid.net/event/backchannel-logout':{}},sid:'sid'});await expect(b.provider.verifyLogout(token)).rejects.toThrow()}finally{await a.close();await b.close()}})
})
