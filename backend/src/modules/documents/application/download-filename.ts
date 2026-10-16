import { basename, extname } from 'node:path'

const extensions:Record<string,string>={
  'text/html':'.htm','application/xhtml+xml':'.html','application/pdf':'.pdf',
  'text/plain':'.txt','text/csv':'.csv','application/json':'.json',
  'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp',
  'application/zip':'.zip','application/msword':'.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx',
  'application/vnd.ms-excel':'.xls','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx',
}
/** Keep archived bytes intact; give nameless captures a usable, safe download filename. */
export function downloadFilename(original:string|null|undefined,url:string|null|undefined,mime:string){
  let candidate=original
  if(!candidate && url){try{candidate=decodeURIComponent(new URL(url).pathname.split('/').pop() || '')}catch{}}
  let name=basename((candidate || 'belge').replace(/\\/g,'/')).replace(/[\x00-\x1f\x7f"<>:|?*]/g,'_').trim().slice(0,180) || 'belge'
  const extension=extensions[mime.split(';')[0]!.trim().toLowerCase()]
  if(extension){
    const actual=extname(name).toLowerCase()
    const matches=actual===extension || extension==='.htm'&&actual==='.html' || extension==='.jpg'&&actual==='.jpeg'
    if(!matches)name=name.replace(/\.[a-z0-9]{1,8}$/i,'')+extension
  }
  const ascii=name.normalize('NFKD').replace(/[^\x20-\x7e]/g,'_').replace(/["\\]/g,'_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`
}
