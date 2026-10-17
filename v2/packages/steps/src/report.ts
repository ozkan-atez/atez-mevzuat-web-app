import type { StepInput, StepOutput } from '@atez/contracts'
import type { StepHandler } from '@atez/engine'
import { loadTemplate } from '@atez/modules'
import type { StepDeps } from './deps'
import { ReportService } from './report-service'

export const reportCompose: StepHandler<StepInput<'report.compose'>, StepOutput<'report.compose'>, StepDeps> = {
  key: 'report.compose',
  versions: (ctx) => ({ handler: '1', prompt: new ReportService(ctx).promptRef(), model: ctx.deps.ai?.modelFor('main') ?? 'none' }),
  cacheIdentity: (input) => input.analysisId,
  run: (input, ctx) => new ReportService(ctx).compose(input.analysisId),
}

export const reportRender: StepHandler<StepInput<'report.render'>, StepOutput<'report.render'>, StepDeps> = {
  key: 'report.render',
  versions: (ctx) => ({ handler: '1', template: loadTemplate(ctx.deps.configDir).ref }),
  cacheIdentity: (input) => `${input.reportId}:r${input.revision}`,
  async run(input, ctx) {
    const { htmlKey, issues } = await new ReportService(ctx).render(input.reportId, input.revision)
    return { reportId: input.reportId, revision: input.revision, status: 'READY' as const, htmlKey, issues }
  },
}
