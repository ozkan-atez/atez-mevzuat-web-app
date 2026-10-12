import {createCipheriv,createDecipheriv,createHash,randomBytes,timingSafeEqual} from 'node:crypto'
export class AuthError extends Error {constructor(readonly statusCode:number,message:string,readonly category='AUTHENTICATION_REQUIRED'){super(message)}}
export const randomHandle=()=>randomBytes(32).toString('base64url')
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
export function encryptSecret(value:unknown,key:Buffer,keyId:string,context:string):string {
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(`${keyId}:${context}`))
 const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()])
 return `${keyId}.${Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url')}`
}
export function decryptSecret<T>(value:string,key:Buffer,keyId:string,context:string):T {
 const [storedId,body,extra]=value.split('.')
 if(storedId!==keyId||!body||extra)throw new AuthError(401,'Oturum doğrulanamadı; yeniden giriş yapın.')
 try{const bytes=Buffer.from(body,'base64url'),decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAAD(Buffer.from(`${keyId}:${context}`));decipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8')) as T}catch{throw new AuthError(401,'Oturum doğrulanamadı; yeniden giriş yapın.')}
}
export function readOpaqueCookie(header:string|undefined,name:string):string|undefined {
 const found=(header??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(`${name}=`))
 if(found.length!==1)return undefined
 const value=found[0]!.slice(name.length+1)
 return /^[A-Za-z0-9_-]{43}$/.test(value)?value:undefined
}
export function constantEqual(a:string,b:string):boolean {return a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b))}
export function assertCsrf(origin:unknown,actual:unknown,expected:string,publicOrigin:string) {
 if(origin!==publicOrigin||typeof actual!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(actual)||!constantEqual(actual,expected))throw new AuthError(403,'İstek doğrulanamadı; sayfayı yenileyip tekrar deneyin.','CSRF_INVALID')
}
export function cookieHeader(name:string,value:string,secure:boolean,maxAge:number):string {return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`}
