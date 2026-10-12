import { useState } from 'react'
import { Button, Space, message } from 'antd'
import { MessageOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { Can } from '../auth/Can'
import { workspaceRequest, type WorkspaceSource } from './api'
export function SourceActions({source,onChanged}:{source:WorkspaceSource;onChanged:()=>void}){
 const navigate=useNavigate(),[busy,setBusy]=useState(false),[feedback,holder]=message.useMessage()
 return <>{holder}<Space wrap><Can permission="chat.write"><Button icon={<MessageOutlined/>} disabled={!source.isActive||Boolean(source.setupStatus&&source.setupStatus!=='READY')} onClick={()=>navigate(`/chat?sourceId=${encodeURIComponent(source.id)}`)}>Sohbette kullan</Button></Can>{source.kind!=='FILES'&&<Can permission="config.manage"><Button icon={<SafetyCertificateOutlined/>} loading={busy} disabled={source.setupStatus==='PREPARING'} onClick={()=>{setBusy(true);void workspaceRequest(`sources/${source.id}/test`,{method:'POST'}).then(()=>{onChanged();void feedback.success('Bağlantı testi başlatıldı. Sonucu kaynak kartından takip edebilirsiniz.')}).catch(e=>{void feedback.error(e.message)}).finally(()=>setBusy(false))}}>Bağlantıyı test et</Button></Can>}</Space></>
}
