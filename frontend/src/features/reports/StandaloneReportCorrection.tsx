import { ReportWorkspace } from '../revision/ReportWorkspace'

export function StandaloneReportCorrection({reportId}:{reportId:string}) {
  return <ReportWorkspace topicId={reportId} popup />
}
