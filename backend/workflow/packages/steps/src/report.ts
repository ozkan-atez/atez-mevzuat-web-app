import type { StepInput, StepOutput } from '@atez/contracts'
import type { StepHandler } from '@atez/engine'
import { loadShell } from '@atez/modules'
import type { StepDeps } from './deps'
import { ReportService } from './report-service'

export const reportCompose: StepHandler<StepInput<'report.compose'>, StepOutput<'report.compose'>, StepDeps> = {
  key: 'report.compose',
  versions: (ctx) => ({ handler: '2', prompt: new ReportService(ctx).promptRef(), model: ctx.deps.ai?.modelFor('main') ?? 'none' }),
  // Şablon sürümü kimliğe girer: şablon (ör. bölüm açıklaması) değişince rapor yeniden yazılır.
  cacheIdentity: async (input, ctx) => `${input.analysisId}:${await new ReportService(ctx).templateVersionId()}`,
  async run(input, ctx) {
    const svc = new ReportService(ctx)
    return svc.compose(input.analysisId, await svc.templateVersionId())
  },
}

export const reportRender: StepHandler<StepInput<'report.render'>, StepOutput<'report.render'>, StepDeps> = {
  key: 'report.render',
  versions: (ctx) => ({ handler: '2', shell: loadShell(ctx.deps.configDir).ref }),
  cacheIdentity: (input) => `${input.reportId}:r${input.revision}`,
  async run(input, ctx) {
    const { htmlKey, status, issues } = await new ReportService(ctx).render(input.reportId, input.revision)
    return { reportId: input.reportId, revision: input.revision, status, htmlKey, issues }
  },
}
