import { AsyncLocalStorage } from 'node:async_hooks'

export type ApplicationRole = 'VIEWER' | 'EDITOR' | 'ADMIN'
export interface ActorContext { userId:string; identityId:string; workspaceId:string; role:ApplicationRole; permissions:string[]; issuer:string; subject:string; sessionId?:string; serviceActor?:boolean }
export const actorContext = new AsyncLocalStorage<ActorContext>()
export const getActorContext=()=>actorContext.getStore()
export const runWithActorContext=<T>(actor:ActorContext,action:()=>T):T=>actorContext.run(actor,action)
export const enterActorContext=(actor:ActorContext)=>actorContext.enterWith(actor)
export function privateActorScope(actor=getActorContext()):string {return actor ? `workspace:${actor.workspaceId}:user:${actor.userId}`:'local-workspace'}
export function sharedActorScope(actor=getActorContext()):string {return actor ? `workspace:${actor.workspaceId}:shared`:'local-workspace'}
export function resourceOwnership(shared=false) {const actor=getActorContext();return actor ? {workspaceId:actor.workspaceId,ownerUserId:shared?null:actor.userId,visibility:shared?'WORKSPACE':'PRIVATE'}:{}}
export function documentAccessWhere(scope?:string) {const actor=getActorContext();return actor ? {workspaceId:actor.workspaceId,OR:[{visibility:'PRIVATE',ownerUserId:actor.userId},{visibility:'WORKSPACE',actorScope:sharedActorScope(actor)}]}:{actorScope:scope ?? 'local-workspace'}}
export function privateResourceWhere(scope?:string) {const actor=getActorContext();return actor ? {workspaceId:actor.workspaceId,ownerUserId:actor.userId,visibility:'PRIVATE'}:{actorScope:scope ?? 'local-workspace'}}
export function chatAccessWhere() {const actor=getActorContext();return actor?{workspaceId:actor.workspaceId,ownerId:actor.userId,visibility:'PRIVATE'}:{}}
export function canonicalDocumentKey(url:string,scope:string):string {return `${scope}:${url}`}

const rolePermissions:Record<ApplicationRole,string[]>={
 VIEWER:['workspace.read','report.read','document.read','chat.read'],
 EDITOR:['workspace.read','report.read','document.read','chat.read','chat.write','document.upload','scan.run','analysis.run','report.edit','report.publish','operation.manage','academy.write'],
 ADMIN:['workspace.read','report.read','document.read','chat.read','chat.write','document.upload','scan.run','analysis.run','report.edit','report.publish','operation.manage','academy.write','config.manage','admin.manage','delivery.send'],
}
export function permissionsForRole(role:ApplicationRole,custom:string[]=[]):string[]{
 const ceiling=new Set(role==='VIEWER'?rolePermissions.VIEWER:role==='EDITOR'?[...rolePermissions.EDITOR,'delivery.send']:rolePermissions.ADMIN)
 return [...new Set([...rolePermissions[role],...custom.filter(permission=>ceiling.has(permission))])]
}
export async function resolveActorContext(prisma:import('@prisma/client').PrismaClient,input:{userId:string;identityId:string;workspaceId:string}):Promise<ActorContext|null>{
 const [identity,membership]=await Promise.all([prisma.externalIdentity.findFirst({where:{id:input.identityId,userId:input.userId,user:{isActive:true}}}),prisma.workspaceMembership.findFirst({where:{workspaceId:input.workspaceId,userId:input.userId,active:true,workspace:{key:'atez'}}})])
 if(!identity || !membership || !['VIEWER','EDITOR','ADMIN'].includes(membership.role))return null
 const role=membership.role as ApplicationRole
 return {...input,role,permissions:permissionsForRole(role,membership.permissions),issuer:identity.issuer,subject:identity.subject}
}
export function reportAccessWhere(){const actor=getActorContext();return actor?{workspaceId:actor.workspaceId,OR:[{visibility:'PRIVATE',ownerUserId:actor.userId},{visibility:'WORKSPACE'}]}:{}}
export function officialSourceScope(sourceKey:string,url:string,fallback:string):string {
 if(!getActorContext())return fallback
 try{const value=new URL(url);if(sourceKey==='resmi-gazete'&&value.protocol==='https:'&&/(^|\.)resmigazete\.gov\.tr$/.test(value.hostname))return sharedActorScope()}catch{}
 return fallback
}
export function jobInitiatorFields(){const actor=getActorContext();return actor?{workspaceId:actor.workspaceId,initiatorUserId:actor.serviceActor?null:actor.userId}:{}}
/** A legacy source topic may expose source status before a report exists; a private report fences its full lineage. */
export function topicAccessWhere(){return getActorContext()?{OR:[{reports:{none:{}}},{reports:{some:reportAccessWhere()}}]}:{}}
export function topicContentAccessWhere(){return getActorContext()?{reports:{some:reportAccessWhere()}}:{}}
