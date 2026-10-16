import { normalizeTurkish } from '../../chat/application/resolve-date'
export function reportChatIntent(message:string):'SHOW_ANALYSIS'|'RERUN_ANALYSIS'|'EDIT_REPORT' {
 const t=normalizeTurkish(message)
 if(!/\banaliz\w*/.test(t))return 'EDIT_REPORT'
 if(/\b(?:yapma|yenileme|calistirma|istemiyorum)\b/.test(t))return 'EDIT_REPORT'
 if(/\b(?:tekrar|yeniden|bastan)\b/.test(t)&&/\b(?:yap\w*|et\w*|calistir\w*|analizle\w*)\b/.test(t)||/\banalizi\s+yenile\w*/.test(t))return 'RERUN_ANALYSIS'
 if(/\b(?:goster\w*|paylas\w*|getir\w*|oku\w*)\b/.test(t))return 'SHOW_ANALYSIS'
 return 'EDIT_REPORT'
}
