import { useEffect, useState } from 'react'
import { Alert, Spin, Typography } from 'antd'
import { getStandaloneReport } from './standalone-api'
import { OperationTaskCard } from '../operations/OperationTaskCard'

/** Reuses the existing document report revision and publication controls. */
export function StandaloneReportCorrection({reportId}:{reportId:string}) {
  const [requestId,setRequestId]=useState<string|null>(null)
  const [error,setError]=useState<string|null>(null)
  const [loading,setLoading]=useState(true)
  useEffect(()=>{
    let disposed=false
    void getStandaloneReport(reportId).then(report=>{
      if(disposed)return
      const revision=report.revisions.find(item=>item.version===report.latestVersion)
      if(!revision?.operationRequestId)throw new Error('Bu raporun düzenleme işlemi bulunamadı.')
      setRequestId(revision.operationRequestId)
    }).catch(error=>{if(!disposed)setError(error.message)}).finally(()=>{if(!disposed)setLoading(false)})
    return()=>{disposed=true}
  },[reportId])
  return <div className="atez-report-scroll"><Typography.Text type="secondary">Taslak içeriğini düzenleyip yeni sürümü yayımlayabilirsiniz.</Typography.Text>{error&&<Alert showIcon type="warning" title={error}/>}<Spin spinning={loading}>{requestId&&<OperationTaskCard requestId={requestId}/>}</Spin></div>
}
