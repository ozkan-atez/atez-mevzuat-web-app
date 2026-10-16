import { StepRegistry } from '@atez/engine'
import { demoJoin, demoSplit, demoUpper } from './demo'
import type { StepDeps } from './deps'

export * from './demo'
export * from './deps'

export function buildStepRegistry(): StepRegistry<StepDeps> {
  return new StepRegistry<StepDeps>().register(demoSplit, demoUpper, demoJoin)
}
