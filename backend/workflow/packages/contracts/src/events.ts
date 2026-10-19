import { z } from 'zod'
import { RunStatus, WorkItemOutcome, WorkItemStatus } from './status'

export const EVENT_TYPES = {
  workItemFinished: 'work_item.finished',
  runFinished: 'run.finished',
} as const

export const WorkItemFinished = z.object({
  runId: z.string().uuid(),
  workItemId: z.string().uuid(),
  nodeId: z.string(),
  status: WorkItemStatus,
  outcome: WorkItemOutcome.nullable(),
})
export type WorkItemFinished = z.infer<typeof WorkItemFinished>

export const RunFinished = z.object({
  runId: z.string().uuid(),
  status: RunStatus,
})
export type RunFinished = z.infer<typeof RunFinished>
