import { ReportConversationPanel } from '../revision/ReportConversationPanel'

/** Standalone reports share the same team conversations and immutable versions. */
export function StandaloneReportCorrection({reportId}:{reportId:string}) {
  return <div className="atez-report-scroll"><ReportConversationPanel reportId={reportId} showPreview /></div>
}
