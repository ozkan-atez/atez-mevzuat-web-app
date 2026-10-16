import { useParams } from 'react-router-dom'
import { ReportWorkspace } from '../revision/ReportWorkspace'
export function StandaloneReportDetail(){const {id}=useParams();return id?<ReportWorkspace topicId={id}/>:null}
