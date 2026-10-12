import { Navigate, useParams, useSearchParams } from 'react-router-dom'

/** Published report links open the same workspace used from the sidebar. */
export function ReportDetail() {
  const { id } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  if (id) params.set('topic', id)
  return <Navigate to={`/chat?${params.toString()}`} replace />
}
