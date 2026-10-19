import { z } from 'zod'

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Ön kontrol öğe durumu (§5.3 basamak 1). İçerik farkı (basamak 2) doc.fetch'te çözülür. */
export const PrecheckStatus = z.enum([
  'NEW', // kimlik ilk kez görüldü
  'PENDING', // kimlik biliniyor ama işleme tamamlanmamış (önceki taramada yarım kaldı)
  'SEEN', // kimlik biliniyor ve işlendi → atlanır (FORCE hariç)
])
export type PrecheckStatus = z.infer<typeof PrecheckStatus>

/** `discovered-item.json` (§9.2). */
export const DiscoveredItem = z.object({
  schemaVersion: z.literal(1),
  source: z.string(),
  feed: z.string().url(),
  documentId: z.string().uuid(),
  identity: z.object({ canonicalKey: z.string(), url: z.string().url() }),
  title: z.string(),
  kind: z.enum(['REGULATION', 'ANNOUNCEMENT']),
  listedDate: IsoDate.nullable(),
  listContext: z.object({
    rgSection: z.string().nullable(),
    rgType: z.string().nullable(),
    rgIssue: z.string().nullable(),
    mukerrer: z.number().int().min(1).nullable(),
    position: z.number().int().min(0),
  }),
  precheck: z.object({ status: PrecheckStatus }),
})
export type DiscoveredItem = z.infer<typeof DiscoveredItem>

export const SourcePrecheck = z.object({
  /** Basamak 0: kaynak düzeyinde değişiklik var mı? */
  status: z.enum(['FIRST_SEEN', 'CHANGED', 'NO_CHANGE']),
  editions: z.array(z.object({ issue: z.string().nullable(), mukerrer: z.number().int().nullable(), url: z.string().url(), items: z.number().int() })),
  previous: z.object({ mukerrerCount: z.number().int(), itemCount: z.number().int() }).nullable(),
})
export type SourcePrecheck = z.infer<typeof SourcePrecheck>
