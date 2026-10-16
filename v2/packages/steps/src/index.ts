import { StepRegistry } from '@atez/engine'
import { classifyProfile } from './classify-profile'
import { classifyTitle } from './classify-title'
import { demoJoin, demoSplit, demoUpper } from './demo'
import type { StepDeps } from './deps'
import { sourceDiscover } from './discover'
import { docFetch } from './fetch'
import { docNormalize } from './normalize'

export * from './classify-profile'
export * from './classify-title'
export * from './demo'
export * from './deps'
export * from './discover'
export * from './fetch'
export * from './normalize'

export function buildStepRegistry(): StepRegistry<StepDeps> {
  return new StepRegistry<StepDeps>().register(demoSplit, demoUpper, demoJoin, sourceDiscover, classifyTitle, docFetch, docNormalize, classifyProfile)
}
