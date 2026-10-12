import { Alert, Skeleton } from 'antd'
import { PageToolbar, ReviseButton } from '../../components/layout/PageToolbar'
import './reports.css'
import { useCan } from '../auth/AuthProvider'
import { ReportCorrectionDrawer } from '../revision/ReportCorrectionDrawer'
import { ReportWorkspace } from '../revision/ReportWorkspace'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getRunReportHtml } from '../scans/api'

export function RunReportDetail() {
  const { runId, reportId } = useParams<{ runId: string; reportId: string }>()
  const canEdit = useCan('report.edit')
  const [editing, setEditing] = useState(false)
  const [reload, setReload] = useState(0)
  const [html, setHtml] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!runId || !reportId) return
    let active = true
    setError(null)
    void getRunReportHtml(runId, reportId)
      .then((content) => { if (active) setHtml(content) })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Bülten yüklenemedi') })
    return () => { active = false }
  }, [reportId, runId, reload])

  return <div className="atez-report-page">
    <PageToolbar backTo={`/runs/${runId}`} backLabel="Taramaya dön">
      {canEdit && html && !error && <ReviseButton onClick={() => setEditing(true)} />}
    </PageToolbar>
    {error ? <Alert type="error" showIcon title="Bülten yüklenemedi" description={error} /> : !html ? <Skeleton active paragraph={{ rows: 8 }} /> :
      <iframe title="Değişiklik yok bülteni" srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox" className="atez-published-report-frame" />}
    <ReportCorrectionDrawer open={editing} onClose={() => setEditing(false)}><div className="atez-report-correction-content">{editing && reportId && <ReportWorkspace topicId={reportId} popup onRevisionSaved={() => setReload(value => value + 1)} />}</div></ReportCorrectionDrawer>
  </div>
}
