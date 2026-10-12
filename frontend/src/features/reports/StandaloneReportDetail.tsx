import { ActionLink, PageToolbar } from '../../components/layout/PageToolbar'
import './reports.css'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Select, Spin, Typography } from 'antd'
import { getStandaloneReport, getStandaloneRevision, type StandaloneReportDetail as Report, type StandaloneReportContent } from './standalone-api'
export function StandaloneReportDetail() {
  const { id } = useParams()
  const [report,setReport]=useState<Report|null>(null)
  const [version,setVersion]=useState<number|null>(null)
  const [content,setContent]=useState<StandaloneReportContent|null>(null)
  const [error,setError]=useState<string|null>(null)
  const [loading,setLoading]=useState(true)
  useEffect(()=>{ if(!id)return; let disposed=false; setError(null);setLoading(true);void getStandaloneReport(id).then(result=>{if(!disposed){setReport(result);setVersion(result.latestVersion)}}).catch(e=>{if(!disposed)setError(e.message)}).finally(()=>{if(!disposed)setLoading(false)});return()=>{disposed=true}},[id])
  useEffect(()=>{if(!id||!version)return;let disposed=false;setLoading(true);setError(null);void getStandaloneRevision(id,version).then(result=>{if(!disposed)setContent(result)}).catch(e=>{if(!disposed)setError(e.message)}).finally(()=>{if(!disposed)setLoading(false)});return()=>{disposed=true}},[id,version])
  return <div className="atez-report-page">
    <PageToolbar backTo="/reports" backLabel="Raporlara dön">
      {report && <><Select aria-label="Rapor sürümü" value={version ?? undefined} onChange={setVersion} options={report.revisions.map(revision => ({ value: revision.version, label: `Sürüm ${revision.version} · ${new Date(revision.createdAt).toLocaleString('tr-TR')}` }))} />
        <ActionLink to={`/operations/${report.revisions.find(revision => revision.version === version)?.operationTaskId ?? report.operationTaskId}`}>Düzenleme ve işlem geçmişi</ActionLink></>}
    </PageToolbar>
    <div className="atez-page-heading"><div><Typography.Title level={2}>{report?.title ?? 'Belge analizi raporu'}</Typography.Title><Typography.Paragraph type="secondary">Yayımlanmış belge analizi raporu. Kaynak tarihleri belgelere aittir; rapor kayıt tarihi ayrı tutulur.</Typography.Paragraph></div></div>
    {error && <Alert type="error" showIcon title={error} />}
    <Spin spinning={loading}>{content && <iframe sandbox="" title="Yayımlanmış belge raporu" srcDoc={content.html} className="atez-published-report-frame" />}</Spin>
  </div>
}
