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
  const reportItems = items.filter((item) => item.type === 'REPORT_REVISION')
  const conversationItems = items.filter((item) => item.type === 'GENERAL')
  const renderItems = (groupItems: ChatHistoryItem[]) => (
      <ol className="atez-history-list">
        {groupItems.map((item) => {
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
  )

  return (
    <nav aria-label="Sohbet geçmişi" className="atez-conversation-history">
      <Can permission="chat.write"><Button block type="text" icon={<FormOutlined />} href="/chat" onClick={(event) => { event.preventDefault(); navigate('/chat'); onNavigate?.() }} className="atez-chat-new-link">Yeni sohbet</Button></Can>

      {canEdit && onOpenReports && <Button type="text" block icon={<EditOutlined />} onClick={onOpenReports} className="atez-chat-report-button">Rapor düzelt</Button>}

      {isLoading && <Spin size="small" description="Geçmiş yükleniyor…"><div className="atez-history-loading" /></Spin>}

      {error && <Alert type="warning" showIcon message={error} action={<Button size="small" onClick={onRetry}>Yeniden dene</Button>} />}

      {!isLoading && !error && items.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Henüz bir sohbet yok." />}

      {items.length > 0 && (
        <div className="atez-history-groups">
          {reportItems.length > 0 && (
            <section aria-label="Rapor değişiklikleri" className="atez-history-group atez-history-reports">
              <h2 className="atez-history-heading">Rapor değişiklikleri</h2>
              {renderItems(reportItems)}
            </section>
          )}
          <section aria-label="Sohbetler" className="atez-history-group atez-history-conversations">
            <h2 className="atez-history-heading">Sohbetler</h2>
            {conversationItems.length > 0
              ? renderItems(conversationItems)
              : <span className="atez-history-empty">Henüz bir sohbet yok.</span>}
          </section>
        </div>
      )}

    </nav>
  )
}
