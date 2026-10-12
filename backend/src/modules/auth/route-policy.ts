const read:Record<string,string>={
 '/api/v1/workspace/activity':'workspace.read',
 '/api/v1/chat/reports':'report.read','/api/v1/chat/sessions':'chat.read','/api/v1/chat/sessions/:id/messages':'chat.read',
 '/api/v1/documents':'document.read','/api/v1/documents/:id':'document.read','/api/v1/document-versions/:id/content':'document.read','/api/v1/document-imports/:id':'document.read',
 '/api/v1/operations/:id':'workspace.read','/api/v1/operation-tasks/:id/publication':'report.edit',
 '/api/v1/standalone-reports':'report.read','/api/v1/standalone-reports/:id':'report.read','/api/v1/standalone-reports/:id/revisions/:version':'report.read',
 '/api/v1/topics/:id/delivery':'report.read','/api/v1/topics/:id':'report.read','/api/v1/topics/:id/messages':'report.read','/api/v1/topics/:id/reports/:revision/html':'report.read',
 '/api/v1/topics/:id/draft':'report.edit','/api/v1/topics/:id/draft/history':'report.read','/api/v1/topics/:id/reports/:revision/delivery':'report.read','/api/v1/topics/:id/reports/:revision/pdf':'report.read',
 '/api/v1/scan-runs':'workspace.read','/api/v1/scan-runs/schedule':'workspace.read','/api/v1/scan-runs/:id':'workspace.read','/api/v1/scan-runs/:id/events':'workspace.read','/api/v1/scan-runs/:id/topics':'report.read','/api/v1/scan-runs/:id/reports/:reportId/html':'report.read',
 '/api/v1/source-scan-runs':'workspace.read','/api/v1/source-scan-runs/sources':'workspace.read','/api/v1/source-scan-runs/:id':'workspace.read','/api/v1/source-scan-runs/:id/report':'report.read','/api/v1/source-scan-runs/:id/documents/:documentId/files/:index':'document.read',
 '/api/v1/sources':'workspace.read','/api/v1/source-sites':'config.manage','/api/v1/source-discovery':'config.manage','/api/v1/source-profiles/:id':'config.manage','/api/v1/managed-sources':'workspace.read',
 '/api/v1/templates':'workspace.read','/api/v1/automations':'workspace.read','/api/v1/automations/:id':'workspace.read','/api/v1/automations/:id/runs':'workspace.read',
 '/api/v1/users':'admin.manage','/api/v1/background-jobs':'admin.manage','/api/v1/usage':'workspace.read','/api/v1/academy/attempts':'workspace.read','/api/v1/customer-groups':'workspace.read',
}
const mutations:Record<string,string>={
 'POST /api/v1/chat/sessions':'chat.write','DELETE /api/v1/chat/sessions/:id':'chat.write','POST /api/v1/chat/sessions/:id/messages':'chat.write','POST /api/v1/chat/sessions/:id/documents':'chat.write',
 'POST /api/v1/documents/uploads':'document.upload','POST /api/v1/documents/imports':'document.upload',
 'POST /api/v1/operations/plan':'analysis.run','POST /api/v1/operations':'analysis.run','POST /api/v1/operations/:id/cancel':'operation.manage','POST /api/v1/operation-tasks/:id/retry':'operation.manage','POST /api/v1/operation-tasks/:id/publish':'report.publish',
 'POST /api/v1/automations/:id/operations':'operation.manage','POST /api/v1/automations/:id/run':'scan.run',
 'POST /api/v1/scan-runs':'scan.run','POST /api/v1/scan-runs/:id/ai-filter/retry':'operation.manage','POST /api/v1/scan-runs/:id/previous-sources/retry':'operation.manage',
 'POST /api/v1/source-scan-runs':'scan.run','POST /api/v1/source-scan-runs/:id/analyze':'analysis.run','POST /api/v1/source-scan-runs/:id/retry':'operation.manage',
 'POST /api/v1/topics/:id/messages':'report.edit','POST /api/v1/topics/:id/retry':'operation.manage','POST /api/v1/topics/:id/draft/workspace':'report.edit','POST /api/v1/topics/:id/draft/sources':'report.edit','POST /api/v1/topics/:id/draft/edits':'report.edit','POST /api/v1/topics/:id/draft/edits/:editId/revert':'report.edit','POST /api/v1/topics/:id/draft/publish':'report.publish','DELETE /api/v1/topics/:id/draft':'report.edit',
 'POST /api/v1/topics/:id/dispatches':'delivery.send','POST /api/v1/academy/attempts':'academy.write',
}
for(const method of ['POST','PATCH','DELETE'])for(const path of ['/api/v1/users','/api/v1/users/:id'])mutations[`${method} ${path}`]='admin.manage'
for(const method of ['POST','PUT','PATCH','DELETE'])for(const path of [
 '/api/v1/sources','/api/v1/sources/:id','/api/v1/templates','/api/v1/templates/:id','/api/v1/automations','/api/v1/automations/:id','/api/v1/customer-groups','/api/v1/customer-groups/:id',
 '/api/v1/source-sites','/api/v1/source-sites/:id/discover','/api/v1/source-sites/:id/endpoints/:endpointId/activate','/api/v1/source-sites/:id/endpoints/:endpointId/reject',
 '/api/v1/source-discovery','/api/v1/source-discovery/:id/discover','/api/v1/source-discovery/:id/endpoints/:endpointId/activate','/api/v1/source-discovery/:id/endpoints/:endpointId/reject',
 '/api/v1/source-profiles/:id/discover','/api/v1/source-profiles/:id/credentials','/api/v1/source-profiles/:id/credentials/test','/api/v1/source-profiles/:id/profiles','/api/v1/source-profiles/:id/profiles/:profileId/verify',
 '/api/v1/managed-sources','/api/v1/managed-sources/:id','/api/v1/managed-sources/:id/refresh',
])mutations[`${method} ${path}`]='config.manage'
export const publicAuthRoutes=new Set(['GET /api/health','HEAD /api/health','GET /api/auth/login','GET /api/auth/callback','POST /api/auth/backchannel-logout'])
export function requiredPermission(method:string,route:string):string|null|undefined {
 let path=route!=='/'?route.replace(/\/$/,''):route
 const normalized=(value:string)=>value.replace(/:[A-Za-z0-9_]+/g,':param')
 if(!read[path]&&!mutations[`${method} ${path}`]){const candidates=method==='GET'||method==='HEAD'?Object.keys(read):Object.keys(mutations).filter(key=>key.startsWith(`${method} `)).map(key=>key.slice(method.length+1));path=candidates.find(value=>normalized(value)===normalized(path)) ?? path}
 if((method==='GET'||method==='HEAD')&&path==='/api/auth/me'||method==='POST'&&path==='/api/auth/logout')return null
 return method==='GET'||method==='HEAD'?read[path]:mutations[`${method} ${path}`]
}
export const authRoutePolicy={read,mutations}
