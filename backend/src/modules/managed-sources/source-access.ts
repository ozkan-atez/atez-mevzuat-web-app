import { getActorContext } from '../../platform/actor-context'
export const builtinSourceKeys = ['resmi-gazete', 'ticaret-bakanligi', 'igmd', 'mevzuat-net', 'tariff']
export function sourceAccessWhere() {
  const actor = getActorContext()
  return actor ? { OR: [{ workspaceId: actor.workspaceId }, { workspaceId: null, key: { in: builtinSourceKeys } }] } : { workspaceId: null }
}
export function sourceCredentialWorkspace() { return getActorContext()?.workspaceId ?? 'local' }
export function templateAccessWhere() {
  const actor = getActorContext()
  return actor ? { OR: [{ workspaceId: actor.workspaceId }, { workspaceId: null }] } : { workspaceId: null }
}

export function managedSourceAccessWhere() { return {workspaceId:getActorContext()?.workspaceId??null} }

export function sourceProfileAccessWhere() { const actor=getActorContext(); return actor?{OR:[{workspaceId:actor.workspaceId},{workspaceId:null}]}:{workspaceId:null} }
