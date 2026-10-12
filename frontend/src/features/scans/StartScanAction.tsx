import { useNavigate } from 'react-router-dom'
import { StartScanButton } from './StartScanButton'

/** Selecting sources and starting work happens in the conversation. */
export function StartScanAction() {
  const navigate = useNavigate()
  return <StartScanButton onClick={() => navigate('/chat', { state: { scanIntent: true }, viewTransition: true })} />
}
