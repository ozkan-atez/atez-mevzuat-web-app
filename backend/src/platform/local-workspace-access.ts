import { getActorContext } from './actor-context'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

const loopbackAddress=(value:string)=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(value)
const loopbackHostname=(value:string)=>['localhost','127.0.0.1','::1'].includes(value.toLowerCase().replace(/^\[|\]$/g,''))
/** Temporary local-development boundary, not an authentication or multi-user authorization system. */
export function isLocalWorkspaceRequest(request:Pick<FastifyRequest,'ip'|'headers'>):boolean {
  if(getActorContext())return true
  if(!loopbackAddress(request.ip))return false
  try {
    const host=request.headers.host
    if(typeof host!=='string'||!loopbackHostname(new URL(`http://${host}`).hostname))return false
    const origin=request.headers.origin
    if(origin!==undefined && (typeof origin!=='string'||!loopbackHostname(new URL(origin).hostname)||!['http:','https:'].includes(new URL(origin).protocol)))return false
    return true
  } catch {return false}
}
export function enforceLocalWorkspace(request:FastifyRequest,reply:FastifyReply):boolean {
  if(isLocalWorkspaceRequest(request))return true
  reply.code(401).send({message:'Bu özellik yerel çalışma alanında kullanılabilir. Uzak erişim için kimlik doğrulama entegrasyonu gerekir.'})
  return false
}
export function installLocalWorkspaceBoundary(app:FastifyInstance):void {
  app.addHook('preHandler',async(request,reply)=>{if(!enforceLocalWorkspace(request,reply))return reply})
}
