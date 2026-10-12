import { sourceCredentialWorkspace } from './source-access'
import { getActorContext } from '../../platform/actor-context'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { PrismaClient } from '@prisma/client'
import { tariffCredentialsFromEnv } from './tariff-auth'
export interface SourceLogin { username: string; password: string }
function encryptionKey(): Buffer {
  const value = process.env.SOURCE_CREDENTIAL_KEY ?? (process.env.SOURCE_CREDENTIAL_KEY_FILE ? readFileSync(process.env.SOURCE_CREDENTIAL_KEY_FILE,'utf8').trim() : '')
  const key = Buffer.from(value,'base64')
  if (key.length !== 32) throw new Error('Kaynak hesapları için şifreleme anahtarı yapılandırılmamış.')
  return key
}
export function encryptLogin(login: SourceLogin, sourceId: string, workspace = 'local', key = encryptionKey()): string {
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(`${workspace}:${sourceId}`))
  const data=Buffer.concat([cipher.update(JSON.stringify(login),'utf8'),cipher.final()])
  return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join('.')
}
export function decryptLogin(value: string, sourceId: string, workspace = 'local', key = encryptionKey()): SourceLogin {
  const [version,iv,tag,data]=value.split('.');if(version!=='v1'||!iv||!tag||!data)throw new Error('Hesap kaydı okunamadı.')
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));decipher.setAAD(Buffer.from(`${workspace}:${sourceId}`));decipher.setAuthTag(Buffer.from(tag,'base64'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString())
}
export async function sourceLogin(prisma: PrismaClient, sourceId: string, sourceKey: string): Promise<SourceLogin | null> {
  const saved=await prisma.sourceCredential.findUnique({where:{sourceId_workspaceId:{sourceId,workspaceId:sourceCredentialWorkspace()}}})
  return saved ? decryptLogin(saved.encrypted,sourceId,sourceCredentialWorkspace()) : sourceKey==='tariff' && !getActorContext() ? tariffCredentialsFromEnv() : null
}
