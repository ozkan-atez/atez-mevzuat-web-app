import {useCallback,useEffect,useRef,useState} from 'react'
import {workspaceRequest} from '../workspace/api'
import { Can } from '../auth/Can'
import { useCan } from '../auth/AuthProvider'
import { Alert, Button, Empty, Spin, Typography } from 'antd'
import { DeleteOutlined, FileTextOutlined, FormOutlined, EditOutlined } from '@ant-design/icons'
import { Link, useNavigate } from 'react-router-dom'
import type { ChatHistoryItem } from './types'

interface Props {
  items: ChatHistoryItem[]
  activeId: string | undefined
  isLoading: boolean
  error: string | null
  onRetry: () => void
  onDelete: (id: string) => void
  onOpenReports?: () => void
  onNavigate?: () => void
}

export function ConversationHistory({ items, activeId, isLoading, error, onRetry, onDelete, onOpenReports, onNavigate }: Props) {
  const canWrite=useCan('chat.write'),canEdit=useCan('report.edit')
  const navigate = useNavigate()
  const [reports,setReports]=useState<Array<{id:string;title:string;conversations:Array<{id:string;title:string;archivedAt:string|null}>}>>([])
  const [reportCursor,setReportCursor]=useState<string|null>(null),[reportsLoading,setReportsLoading]=useState(false),[reportsError,setReportsError]=useState<string|null>(null)
  const reportLoad=useRef(0)
  const loadReports=useCallback(async(cursor?:string)=>{
    const request=++reportLoad.current;setReportsLoading(true);setReportsError(null)
    try{const result=await workspaceRequest<{reports:typeof reports;nextCursor:string|null}>(`report-workspaces${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`)
      if(request!==reportLoad.current)return
      setReports(current=>cursor?[...current,...(result.reports??[]).filter(report=>!current.some(existing=>existing.id===report.id))]:result.reports??[]);setReportCursor(result.nextCursor??null)
    }catch(error){if(request===reportLoad.current)setReportsError(error instanceof Error?error.message:'Rapor sohbetleri yüklenemedi.')}
    finally{if(request===reportLoad.current)setReportsLoading(false)}
  },[])
  useEffect(()=>{void loadReports();return()=>{reportLoad.current+=1}},[items,loadReports])
  return (
    <nav aria-label="Sohbet geçmişi" className="atez-conversation-history">
      <Can permission="chat.write"><Button block type="text" icon={<FormOutlined />} href="/chat" onClick={(event) => { event.preventDefault(); navigate('/chat'); onNavigate?.() }} className="atez-chat-new-link">Yeni sohbet</Button></Can>

      {canEdit && onOpenReports && <Button type="text" block icon={<EditOutlined />} onClick={onOpenReports} className="atez-chat-report-button">Rapor düzelt</Button>}

      {isLoading && <Spin size="small" description="Geçmiş yükleniyor…"><div className="atez-history-loading" /></Spin>}

      {error && <Alert type="warning" showIcon message={error} action={<Button size="small" onClick={onRetry}>Yeniden dene</Button>} />}

      {!isLoading && !error && items.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Henüz bir sohbet yok." />}

      {reports.length>0&&<section aria-label="Rapor sohbetleri"><span className="atez-history-heading">Raporlar</span>{reports.map(report=><details key={report.id}><summary>{report.title}</summary><Link className="atez-history-link" to={`/chat?report=${encodeURIComponent(report.id)}`} onClick={onNavigate}>Raporu aç</Link>{report.conversations.filter(c=>!c.archivedAt).map(c=><Link className="atez-history-link" key={c.id} to={`/chat?report=${encodeURIComponent(report.id)}&conversation=${encodeURIComponent(c.id)}`} onClick={onNavigate}>{c.title}</Link>)}</details>)}</section>}
      {reportsLoading&&<Typography.Text type="secondary" role="status">Rapor sohbetleri yükleniyor…</Typography.Text>}
      {reportsError&&<Alert type="warning" showIcon title={reportsError} action={<Button size="small" onClick={()=>void loadReports(reportCursor??undefined)}>Raporları yeniden yükle</Button>} />}
      {reportCursor&&<Button type="text" block loading={reportsLoading} onClick={()=>void loadReports(reportCursor)}>Daha fazla rapor</Button>}
      {items.length>0 && <span className="atez-history-heading">Sohbetler</span>}
      <ol className="atez-history-list">
        {items.map((item) => {
          const isActive = item.id === activeId
          return (
            <li key={item.id} className="atez-history-item">
              <Link
                to={item.target}
                onClick={onNavigate}
                title={item.title}
                aria-current={isActive ? 'page' : undefined}
                className={`atez-history-link ${isActive ? 'active' : ''}`}
              >
                {item.type === 'REPORT_REVISION' && <FileTextOutlined aria-hidden />}
                <Typography.Text className="atez-history-title" ellipsis>{item.title.replace(/^\s*(?:[-–—−•]\s*)+/u, '').trim()}</Typography.Text>
              </Link>

              {/* Only a general conversation is the user's to delete; a revision
                  thread is part of its report's history. */}
              {canWrite && item.type === 'GENERAL' && (
                <Button
                  type="text"
                  aria-label={`${item.title} sohbetini sil`}
                  onClick={() => onDelete(item.id)}
                  className="atez-history-delete"
                  icon={<DeleteOutlined />}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
