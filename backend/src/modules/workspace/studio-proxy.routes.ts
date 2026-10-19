import { studioFetch } from '../../platform/studio-transport'
import type { PrismaClient } from '@prisma/client'
import { syncStudioTemplates } from './studio-bridge'
import type { FastifyInstance } from 'fastify'
/** Keep v2 behind the existing session, CSRF and config.manage checks. */
export async function studioProxyRoutes(app:FastifyInstance,{baseUrl,prisma}:{baseUrl:string;prisma:PrismaClient}){
  app.route({method:['GET','POST','PUT','PATCH','DELETE'],url:'/api/v2/*',handler:async(request,reply)=>{
    const path=request.url.replace(/^\/api\/v2\//,'/api/')
    let decoded:string
    try{decoded=decodeURIComponent(path.split('?')[0]!)}catch{return reply.code(404).send({message:'Uç bulunamadı.'})}
    if(decoded.split('/').some(segment=>segment==='.'||segment==='..')||decoded.includes('\\'))return reply.code(404).send({message:'Uç bulunamadı.'})
    // Expose only the studio; pipeline administration remains internal.
    if(!/^\/api\/(components|templates|bindings)(?:[/?]|$)/.test(path))return reply.code(404).send({message:'Uç bulunamadı.'})
    try{
      const response=await studioFetch(`${baseUrl.replace(/\/$/,'')}${path}`,{method:request.method,headers:{'content-type':'application/json'},...(!['GET','HEAD'].includes(request.method)?{body:JSON.stringify(request.body??{})}:{}),signal:AbortSignal.timeout(180_000),redirect:'error'})
      if(response.ok && path.startsWith('/api/templates') && (request.method!=='GET' || path==='/api/templates'))await syncStudioTemplates(prisma,baseUrl)
      return reply.code(response.status).type('application/json').send(await response.text())
    }catch{ return reply.code(503).send({message:'Şablon stüdyosuna ulaşılamadı.'}) }
  }})
}
