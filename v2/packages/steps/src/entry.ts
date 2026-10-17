import type { StepInput, StepOutput } from '@atez/contracts'
import type { StepHandler } from '@atez/engine'
import { PermanentError } from '@atez/platform'
import { documents } from '@atez/modules'
import type { StepDeps } from './deps'

/** `entry.documents`: planlayıcının `entry` belge kimlikleriyle başlayan tarifler için kök adım. */
export const entryDocuments: StepHandler<StepInput<'entry.documents'>, StepOutput<'entry.documents'>, StepDeps> = {
  key: 'entry.documents',
  versions: () => ({ handler: '1' }),
  cacheIdentity: () => null,
  async run(input, ctx) {
    for (const id of input.documentVersionIds) {
      if (!(await documents.getVersion(ctx.deps.db, id))) throw new PermanentError(`Belge sürümü yok: ${id}`, 'DOCUMENT_MISSING')
    }
    return { items: input.documentVersionIds.map((documentVersionId) => ({ documentVersionId })) }
  },
}
