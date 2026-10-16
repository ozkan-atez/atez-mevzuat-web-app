import { useState } from 'react'
import { GlobalOutlined } from '@ant-design/icons'

const icons:Record<string,string>={
  'resmi-gazete':'/source-icons/resmi-gazete.ico',
  'ticaret-bakanligi':'/source-icons/ticaret-bakanligi.png',
  'tariff':'/source-icons/tariff.png',
  'igmd':'/source-icons/igmd.png',
  'mevzuat-net':'/source-icons/mevzuat-net.png',
}
export function sourceIconUrl(url:string,sourceKey?:string){
  if(sourceKey&&icons[sourceKey])return icons[sourceKey]
  try{const parsed=new URL(url);return ['https:','http:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password?`${parsed.origin}/favicon.ico`:null}catch{return null}
}
export function SourceIcon({url,sourceKey}:{url:string;sourceKey?:string}){
  const src=sourceIconUrl(url,sourceKey)
  const [failed,setFailed]=useState<string|null>(null)
  return <span className={`connector-mark source-site-icon ${src&&failed!==src?'has-image':''}`} aria-hidden="true">{src&&failed!==src?<img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(src)}/>:<GlobalOutlined/>}</span>
}
