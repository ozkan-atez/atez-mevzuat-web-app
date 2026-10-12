import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StartScanButton } from './StartScanButton'
import { TriggerWorkflowModal } from '../dashboard/TriggerWorkflowModal'

/** Every entry point opens the same date selection and scan workflow. */
export function StartScanAction() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  return <>
    <StartScanButton onClick={() => setOpen(true)} />
    {open && <TriggerWorkflowModal onClose={() => setOpen(false)} onTriggered={runId => navigate(`/runs/${runId}`)} />}
  </>
}
