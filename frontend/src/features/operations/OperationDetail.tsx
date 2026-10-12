import { useParams } from 'react-router-dom'
import { Typography } from 'antd'
import { OperationTaskCard } from './OperationTaskCard'
export function OperationDetail() { const { id } = useParams(); return <div className="atez-page-stack"><Typography.Title level={2}>İşlem ayrıntıları</Typography.Title>{id && <OperationTaskCard requestId={id} />}</div> }
