import { useEffect, useState } from 'react'
import { Button, Modal, Spin } from 'antd'
import { FileTextOutlined } from '@ant-design/icons'
import { getStandaloneRevision } from '../reports/standalone-api'
import type { ReportDraftView } from '../revision/types'
import type { ReportThread } from './api'

/** Keep the report readable beside its conversation without opening the editor. */
export function ReportChatPreview({ thread, view, loading }: { thread: ReportThread; view: ReportDraftView | null; loading: boolean }) {
  const [open, setOpen] = useState(false)
  const [published, setPublished] = useState<{ key: string; html: string } | null>(null)
  const [error, setError] = useState(false)
  const revisionKey = `${thread.reportId}:${thread.latestVersion}`

  useEffect(() => {
    if (thread.topicId || !open) return
    let disposed = false
    setError(false)
    void getStandaloneRevision(thread.reportId, thread.latestVersion).then(result => {
      if (!disposed) setPublished({ key: revisionKey, html: result.html })
    }).catch(() => { if (!disposed) setError(true) })
    return () => { disposed = true }
  }, [thread.topicId, thread.reportId, thread.latestVersion, revisionKey, open])

  const html = thread.topicId ? view?.html : published?.key === revisionKey ? published.html : undefined
  const isLoading = thread.topicId ? loading : !html && !error
  const version = thread.topicId && view ? view.baseVersion : thread.latestVersion
  return <>
    <div className="atez-report-preview-trigger">
      <Button icon={<FileTextOutlined />} aria-haspopup="dialog" onClick={() => setOpen(true)}>Rapor önizlemesi</Button>
    </div>
    <Modal
      title={`${thread.title} · ${view?.draft && thread.topicId ? `Taslak · r${version} üzerinden` : `r${version}`}`}
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      centered
      width="min(1100px, calc(100vw - 32px))"
      className="atez-report-preview-modal"
      destroyOnHidden
      closable={{ 'aria-label': 'Önizlemeyi kapat' }}
    >
      {html ? <iframe title="Sohbette rapor önizlemesi" srcDoc={html} sandbox="allow-same-origin" />
        : <div className="atez-report-preview-status">{isLoading ? <Spin size="small" /> : 'Önizleme yüklenemedi. Raporu açarak tekrar deneyebilirsiniz.'}</div>}
    </Modal>
  </>
}
