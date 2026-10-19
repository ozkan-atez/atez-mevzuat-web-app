import type { AuthSession } from '../features/auth/session'
/** Explicit test identity, never imported by the application entry point. */
export const testSession:AuthSession={user:{id:'test-admin',email:'admin@example.test',name:'ATEZ Yönetimi'},workspace:{id:'test-workspace',name:'ATEZ Ekibi'},role:'ADMIN',permissions:['workspace.read','report.read','document.read','chat.read','chat.write','document.upload','scan.run','analysis.run','report.edit','report.publish','operation.manage','config.manage','admin.manage','delivery.send'],csrfToken:'test-csrf'}
