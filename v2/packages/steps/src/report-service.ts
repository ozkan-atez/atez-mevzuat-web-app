import { desc, eq, sql } from 'drizzle-orm'
import { AnalysisV1, ReportSpecV1, ReportTextFields, type ReportCard } from '@atez/contracts'
import type { StepContext } from '@atez/engine'
import { PermanentError, StorageKeys, schema } from '@atez/platform'
import { allowedNumbers, loadPrompt, loadTemplate, renderReport, selectCard, unmatchedNumbers } from '@atez/modules'
import type { StepDeps } from './deps'
import { loadProfile } from './extract-table'

const PROMPT = 'report-compose.v1'

/**
 * Tek rapor yolu (§10): compose → render aynı serviste. Kart kuralla seçilir, metin alanlarını
 * ana model doldurur; metindeki sayılar analize karşı kodla denetlenir (1 onarım turu).
 * K1: onay adımı yok, rapor `READY` olur; e-posta gönderilmez.
 */
export class ReportService {
  constructor(private readonly ctx: StepContext<StepDeps>) {}

  promptRef(): string {
    return loadPrompt(this.ctx.deps.configDir, PROMPT).ref
  }

  async compose(analysisId: string): Promise<{ reportId: string; revision: number; card: ReportCard; specKey: string }> {
    const { db, store, ai } = this.ctx.deps
    if (!ai) throw new PermanentError('AI geçidi yapılandırılmamış', 'AI_NOT_CONFIGURED')
    const [a] = await db.select().from(schema.analysis).where(eq(schema.analysis.id, analysisId))
    if (!a) throw new PermanentError('Analiz yok', 'ANALYSIS_MISSING')
    const analysis = AnalysisV1.parse(JSON.parse((await store.get(a.objectKey)).toString('utf8')))
    const primary = analysis.documents.find((d) => d.role === 'PRIMARY') ?? analysis.documents[0]!
    const profile = (await loadProfile(this.ctx, primary.documentVersionId))?.profile
    if (!profile) throw new PermanentError('Ana belge profili yok', 'NO_PROFILE')
    const card = selectCard(profile, analysis)
    const prompt = loadPrompt(this.ctx.deps.configDir, PROMPT)
    const allowed = allowedNumbers(analysis)
    const aiCallIds: string[] = []
    const input = {
      kart: card,
      analiz: {
        summary: analysis.summary,
        operationalImpact: analysis.operationalImpact,
        affected: analysis.affected,
        claims: analysis.claims.map((c) => c.text),
        comparisonCommentary: analysis.comparisonCommentary,
        exceptions: analysis.exceptions,
        dates: analysis.dates,
        priorState: analysis.priorState,
        comparison: card === 'ORAN_TABLOSU' ? analysis.comparison : null,
        documents: analysis.documents.map((d) => ({ title: d.title, role: d.role, publicationDate: d.publicationDate, officialNumber: d.officialNumber })),
      },
    }
    const call = async (extra?: string) => {
      const res = await ai.generate({
        tier: 'main',
        purpose: 'report.compose',
        promptVersion: prompt.ref,
        system: prompt.text,
        parts: [{ text: `${JSON.stringify(input)}\n\nRapor metin alanlarını üret.${extra ? `\n\n${extra}` : ''}` }],
        schema: ReportTextFields,
        context: { runId: this.ctx.runId, workItemId: this.ctx.workItemId, stepKey: this.ctx.stepKey },
      })
      aiCallIds.push(res.aiCallId)
      return res.data
    }
    const texts = (f: ReportTextFields) => [f.headline, f.lead, ...f.keyPoints, f.impact, f.tableNote ?? '']
    let fields = await call()
    let check = unmatchedNumbers(texts(fields), allowed)
    let repairRounds = 0
    if (check.unmatched.length) {
      repairRounds++
      fields = await call(`Şu sayılar analizde yok; kaldır ya da analizdeki değerle değiştir: ${check.unmatched.join(', ')}`)
      check = unmatchedNumbers(texts(fields), allowed)
    }

    return db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.report).where(eq(schema.report.topicId, analysis.topicId))
      let reportId: string
      let revision: number
      if (existing) {
        reportId = existing.id
        const [last] = await tx.select({ r: schema.reportRevision.revision }).from(schema.reportRevision).where(eq(schema.reportRevision.reportId, reportId)).orderBy(desc(schema.reportRevision.revision)).limit(1)
        revision = (last?.r ?? 0) + 1
      } else {
        const [r] = await tx.insert(schema.report).values({ topicId: analysis.topicId, status: 'COMPOSING', title: fields.headline, card, currentRevision: 0 }).returning({ id: schema.report.id })
        reportId = r!.id
        revision = 1
      }
      const spec: ReportSpecV1 = ReportSpecV1.parse({
        schemaVersion: 1,
        reportId,
        revision,
        topicId: analysis.topicId,
        analysisId,
        card,
        fields,
        dates: analysis.dates,
        comparison: card === 'ORAN_TABLOSU' ? analysis.comparison : null,
        priorState: analysis.priorState,
        sources: analysis.documents.map((d) => ({ title: d.title, url: d.url, publicationDate: d.publicationDate, role: d.role === 'PRIOR' ? 'Önceki hal' : d.role === 'PRIMARY' ? 'Ana kaynak' : 'Destekleyici' })),
        validation: { numbersChecked: check.checked, unmatchedNumbers: check.unmatched, repairRounds },
        generatedBy: { model: ai.modelFor('main'), promptVersion: prompt.ref, aiCallIds },
      })
      const specKey = StorageKeys.reportFile(reportId, revision, 'spec.json')
      await store.put(specKey, JSON.stringify(spec, null, 2), 'application/json')
      await tx.insert(schema.reportRevision).values({ reportId, revision, analysisId, specKey, validation: spec.validation })
      return { reportId, revision, card, specKey }
    })
  }

  async render(reportId: string, revision: number): Promise<{ htmlKey: string; issues: string[] }> {
    const { db, store } = this.ctx.deps
    const [rev] = await db.select().from(schema.reportRevision).where(sql`${schema.reportRevision.reportId} = ${reportId} AND ${schema.reportRevision.revision} = ${revision}`)
    if (!rev) throw new PermanentError('Rapor revizyonu yok', 'REPORT_REVISION_MISSING')
    const spec = ReportSpecV1.parse(JSON.parse((await store.get(rev.specKey)).toString('utf8')))
    const template = loadTemplate(this.ctx.deps.configDir)
    const { html, issues: renderIssues } = renderReport(spec, template)
    const issues = [...renderIssues, ...spec.validation.unmatchedNumbers.map((n) => `Metindeki sayı analizde yok: ${n}`)]
    const htmlKey = StorageKeys.reportFile(reportId, revision, 'report.html')
    await store.put(htmlKey, html, 'text/html; charset=utf-8')
    await db.transaction(async (tx) => {
      await tx.update(schema.reportRevision).set({ htmlKey, validation: { ...spec.validation, renderIssues, template: template.ref } }).where(eq(schema.reportRevision.id, rev.id))
      await tx
        .update(schema.report)
        .set({ status: 'READY', title: spec.fields.headline, card: spec.card, currentRevision: revision, updatedAt: sql`now()` })
        .where(eq(schema.report.id, reportId))
    })
    return { htmlKey, issues }
  }
}
