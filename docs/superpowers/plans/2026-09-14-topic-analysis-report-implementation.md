# Topic Analysis and Report Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filtre sonrası her `IN` Resmî Gazete topic'ini bağımsız analiz eden, revizyonlanabilir analiz kayıtları oluşturan ve doğrulanmış ATEZ HTML raporu üreten uçtan uca sistemi tamamlamak.

**Architecture:** Mevcut clean-architecture tabanlı `scan-runs` akışı korunur ve yeni `topic-analysis` modülüyle genişletilir. Gemini yalnızca sıkı şemalı kanonik analiz JSON'u üretir; Markdown, rapor spesifikasyonu ve HTML deterministik olarak uygulama içinde oluşturulur. PostgreSQL durum ve revizyon ilişkilerini, MinIO/S3 ise değiştirilemeyen kanıt ve çıktı dosyalarını saklar.

**Tech Stack:** TypeScript, Fastify, Prisma/PostgreSQL, pg-boss, `@google/genai`, Zod, MinIO/S3, React 19, Vitest, Testing Library, Docker Compose

**Spec:** `docs/superpowers/specs/2026-09-14-topic-analysis-report-design.md`

## Global Constraints

- Bir filtre topic'i bölünmez: bir `CollectedDocument` + kesin `IN` kararı = bir `TopicProcess` = en fazla bir topic HTML raporu.
- Gemini HTML, CSS, Markdown veya logo üretmez; yalnızca `analysis.json` şemasını döndürür.
- `analysis.md`, `report-spec.json` ve `report.html` deterministik olarak üretilir.
- `atez-logo.png` HTML içine `data:image/png;base64,...` olarak gömülür ve Gemini bağlamına girmez.
- Tablo yalnızca en az iki satırlık kanıtlı yapısal veri olduğunda K2 ile üretilir.
- Hiçbir raporlanabilir değişiklik yoksa Gemini analiz çağrısı yapılmadan yalnızca K6 `00-degisiklik-yok.html` oluşturulur.
- K6, topic raporlarıyla aynı run içinde birlikte üretilmez.
- Her revizyon değiştirilemezdir; yeni `rNN` sürümü oluşturulur.
- Tarih bazlı bütün yeni testler `2026-09-11` kullanır; `2026-07-11` yeni analiz/rapor testlerinde kullanılmaz.
- Gemini model adı ortamdan `GEMINI_MODEL` ile gelir; anahtarlar ve ham kimlik bilgileri loglanmaz.
- Uygulama mevcut `codex/resmi-gazete-manual-ingestion` dalındaki toplama, filtre, önceki kaynak ve retry davranışlarını bozmamalıdır.

## File Structure

### Backend files to create

- `backend/src/modules/topic-analysis/domain/analysis-schemas.ts`: Kanonik analiz, revizyon ve durum şemaları.
- `backend/src/modules/topic-analysis/domain/report-spec-schemas.ts`: K1-K6 ayrık union rapor sözleşmesi.
- `backend/src/modules/topic-analysis/application/ports.ts`: Repository, object store, clock ve model sınırları.
- `backend/src/modules/topic-analysis/application/analysis-prompts.ts`: Topic başına sürümlü analiz system prompt'u ve JSON Schema.
- `backend/src/modules/topic-analysis/application/build-evidence-bundle.ts`: Güncel belge, ekler ve önceki kaynak bağlamını hazırlar.
- `backend/src/modules/topic-analysis/application/render-analysis-markdown.ts`: Kanonik JSON'dan `analysis.md` üretir.
- `backend/src/modules/topic-analysis/application/build-report-spec.ts`: Analizden K1-K6 ve B1-B10 seçer.
- `backend/src/modules/topic-analysis/application/render-report-html.ts`: Sabit iskelet, logo ve bloklarla HTML üretir.
- `backend/src/modules/topic-analysis/application/validate-report-html.ts`: Yayınlama sözleşmesinin 14 yerel kontrolünü uygular.
- `backend/src/modules/topic-analysis/application/execute-topic-analysis.ts`: Tek topic analiz ve yayın use-case'i.
- `backend/src/modules/topic-analysis/application/execute-run-topic-analyses.ts`: Run içindeki topic'leri sınırlı paralellikle yürütür ve K6 kısa yolunu yönetir.
- `backend/src/modules/topic-analysis/application/build-revision-context.ts`: Son analiz, kullanıcı talebi ve ilgili kanıtlarla düşük-token revizyon bağlamı kurar.
- `backend/src/modules/topic-analysis/application/execute-topic-revision.ts`: Analiz veya yayın revizyonunu yeni değiştirilemez sürüm olarak üretir.
- `backend/src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository.ts`: Yeni modeller için Prisma adaptörü.
- `backend/src/modules/topic-analysis/infrastructure/topic-analysis-queue.ts`: Topic retry ve revizyon komutlarını pg-boss'a taşır.
- `backend/src/modules/topic-analysis/topic-analysis.routes.ts`: Topic, mesaj, revizyon, rapor ve retry uçları.
- `backend/src/modules/topic-analysis/templates/bulten-v2.ts`: Sabit sayfa, CSS, K1-K6 ve B1-B10 şablonları.
- `backend/src/modules/topic-analysis/assets/atez-logo.png`: Kullanıcının onayladığı ATEZ logosu.
- `backend/prisma/migrations/20260914040000_add_topic_analysis_reporting/migration.sql`: Yeni enum, tablo, ilişki ve indeksler.

### Backend files to modify

- `backend/prisma/schema.prisma`: Topic, evidence, thread, mesaj, analiz ve rapor revizyon modelleri.
- `backend/src/modules/scan-runs/domain/scan-run.ts`: `ANALYZING_TOPICS`, `GENERATING_REPORTS` aşamaları.
- `backend/src/modules/scan-runs/application/ports.ts`: Run DTO'suna analiz/rapor ilerlemesi.
- `backend/src/modules/scan-runs/infrastructure/prisma-scan-repository.ts`: `IN` belgeleri ve yeni aşama özetlerini okuma.
- `backend/src/modules/scan-runs/application/execute-scan-run.ts`: Önceki kaynak sonrasında topic analizi ve rapor üretimi.
- `backend/src/modules/scan-runs/application/build-manifest.ts`: Analiz/rapor artifact kayıtları ve K6 durumu.
- `backend/src/modules/scan-runs/scan-runs.routes.ts`: Analiz retry ve rapor bağlantılarının run görünümü.
- `backend/src/config/env.ts`: Topic concurrency ve analiz bağlam limitleri.
- `backend/src/worker.ts`: Yeni use-case bağımlılıklarının kurulması.
- `backend/src/app.ts`: Topic analiz route kaydı.
- `backend/.env.example`: Yeni ortam değişkenleri.
- `docker-compose.yml`: Worker'a topic concurrency ve analiz limitlerinin geçirilmesi.

### Frontend files to create

- `frontend/src/features/analysis/TopicAnalysisCard.tsx`: Topic analiz ve rapor durumu.
- `frontend/src/features/analysis/TopicAnalysisChat.tsx`: Topic'e bağlı kalıcı revizyon sohbeti.
- `frontend/src/features/analysis/api.ts`: Topic detay, mesaj, retry ve revizyon çağrıları.
- `frontend/src/features/analysis/types.ts`: Backend DTO eşleri.
- `frontend/src/features/analysis/TopicAnalysisCard.test.tsx`: Durum ve retry UI testleri.
- `frontend/src/features/analysis/TopicAnalysisChat.test.tsx`: Sohbet ve revizyon UI testleri.

### Frontend files to modify

- `frontend/src/features/scans/types.ts`: Yeni aşamalar, topic ve report özetleri.
- `frontend/src/features/scans/api.ts`: Analiz retry çağrısı.
- `frontend/src/features/runs/OperationSteps.tsx`: Analiz ve rapor üretim adımları.
- `frontend/src/features/runs/RunDetail.tsx`: Topic analiz kartları ve K6 raporu.
- `frontend/src/features/runs/RunDetail.test.tsx`: Gerçek backend verisi ve topic durumları.
- `frontend/src/features/reports/ReportDetail.tsx`: HTML önizleme ve topic sohbeti.
- `frontend/src/features/reports/ReportDetail.test.tsx`: Revizyon ve rapor gösterimi.

---

### Task 1: Persist Topic, Evidence, Chat, Analysis and Report Revisions

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260914040000_add_topic_analysis_reporting/migration.sql`
- Create: `backend/src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository.ts`
- Create: `backend/test/integration/topic-analysis-repository.test.ts`

**Interfaces:**
- Consumes: `ScanRun`, `CollectedDocument`, `StoredObject`, `DocumentFilterDecision` and `PreviousSourceDocument` from the existing schema.
- Produces: `PrismaTopicAnalysisRepository.ensureTopics(runId)`, `getTopicWorkItem(topicId)`, `createAnalysisRevision(input)`, `createReportRevision(input)`, `appendMessage(input)`, and `getRunAnalysisProgress(runId)`.

- [ ] **Step 1: Write the repository integration test**

Create a filtered `IN` and `OUT` document, call `ensureTopics`, and assert only the `IN` document becomes one topic. Then persist two analysis revisions and verify both remain immutable.

```ts
it('creates exactly one topic per final IN document and preserves revisions', async () => {
  const ids = await seedFilteredDocuments(prisma, ['IN', 'OUT'])
  const topics = await repository.ensureTopics(ids.runId)
  expect(topics).toHaveLength(1)
  expect(topics[0].documentId).toBe(ids.documentIds[0])

  const first = await repository.createAnalysisRevision({
    topicId: topics[0].id,
    status: 'PASS',
    version: 1,
    analysisObjectKey: 'runs/2026/09/11/run/topics/topic/analysis/r01/analysis.json',
    markdownObjectKey: 'runs/2026/09/11/run/topics/topic/analysis/r01/analysis.md',
    model: 'gemini-3.7-flash',
    promptVersion: 'topic-analysis-v1',
    schemaVersion: 1,
  })
  const second = await repository.createAnalysisRevision({ ...first, id: undefined, version: 2 })
  expect(await prisma.analysisRevision.count({ where: { topicId: topics[0].id } })).toBe(2)
  expect(second.version).toBe(2)
})
```

- [ ] **Step 2: Run the test and verify the missing repository/schema failure**

Run: `cd backend && npm test -- test/integration/topic-analysis-repository.test.ts`

Expected: FAIL because the topic-analysis repository and Prisma models do not exist.

- [ ] **Step 3: Add the Prisma enums and models**

Add these exact enum values and database constraints:

```text
TopicProcessStatus: QUEUED, ANALYZING, ANALYZED, RENDERING, VALIDATING, COMPLETED, AWAITING_RETRY, BLOCKED, FAILED
AnalysisRevisionStatus: PASS, PASS_NO_RELEVANT_CONTENT
ReportRevisionStatus: GENERATED, VALIDATED, FAILED
ChatRole: SYSTEM, USER, ASSISTANT
ChatMessageKind: AUTOMATED_ANALYSIS, REVISION_REQUEST, REVISION_RESULT, ERROR
RevisionKind: ANALYSIS, PUBLICATION
```

Add the following relationships with database uniqueness enforced:

```prisma
model TopicProcess {
  id               String              @id @default(uuid())
  scanRunId        String
  scanRun          ScanRun             @relation(fields: [scanRunId], references: [id], onDelete: Cascade)
  documentId       String              @unique
  document         CollectedDocument   @relation(fields: [documentId], references: [id], onDelete: Cascade)
  status           TopicProcessStatus  @default(QUEUED)
  lastErrorCategory AiErrorCategory?
  lastErrorMessage String?
  evidenceBundle   EvidenceBundle?
  thread           AnalysisThread?
  analyses         AnalysisRevision[]
  reports          TopicReport[]
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt

  @@index([scanRunId, status])
}

model AnalysisRevision {
  id                String   @id @default(uuid())
  topicId           String
  topic             TopicProcess @relation(fields: [topicId], references: [id], onDelete: Cascade)
  version           Int
  status            AnalysisRevisionStatus
  analysisObjectKey String
  markdownObjectKey String
  model             String
  promptVersion     String
  schemaVersion     Int
  inputTokens       Int?
  outputTokens      Int?
  createdAt         DateTime @default(now())

  @@unique([topicId, version])
}
```

Create analogous `EvidenceBundle`, `AnalysisThread`, `ChatMessage`, `TopicReport`, `ReportRevision`, `TopicAiExecution`, and `TopicOutbox` models described by the spec. `AnalysisThread.topicId` and `EvidenceBundle.topicId` are unique. `ReportRevision` is unique on `(reportId, version)` and references the exact `analysisRevisionId` used. `TopicOutbox.requestKey` is unique and its command is one of `RETRY_ANALYSIS`, `REVISE_ANALYSIS`, or `REVISE_PUBLICATION`. `TopicReport` always has `scanRunId`; its `topicId` is optional only for the single run-level K6 report. Enforce one run-level K6 report per run with a partial unique index in the SQL migration.

- [ ] **Step 4: Add and apply the migration**

Run: `cd backend && npx prisma migrate dev --name add_topic_analysis_reporting`

Expected: migration applies and Prisma Client generates successfully.

- [ ] **Step 5: Implement repository transactions**

Implement `ensureTopics` as an idempotent transaction driven exclusively by `DocumentFilterDecision.finalDecision = IN`. Create each topic's `EvidenceBundle` and `AnalysisThread` in the same transaction. Use unique constraints instead of read-then-write races.

- [ ] **Step 6: Run repository and existing integration tests**

Run: `cd backend && npm test -- test/integration/topic-analysis-repository.test.ts test/integration/document-filter-repository.test.ts test/integration/previous-source-repository.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the persistence boundary**

```bash
git add backend/prisma backend/src/modules/topic-analysis/infrastructure backend/test/integration/topic-analysis-repository.test.ts
git commit -m "feat: persist topic analysis revisions"
```

### Task 2: Define the Canonical Analysis and Report Spec Schemas

**Files:**
- Create: `backend/src/modules/topic-analysis/domain/analysis-schemas.ts`
- Create: `backend/src/modules/topic-analysis/domain/report-spec-schemas.ts`
- Create: `backend/src/modules/topic-analysis/application/analysis-prompts.ts`
- Create: `backend/test/unit/analysis-schemas.test.ts`
- Create: `backend/test/unit/report-spec-schemas.test.ts`
- Create: `backend/test/unit/analysis-prompts.test.ts`

**Interfaces:**
- Consumes: Topic identity and evidence references from Task 1.
- Produces: `AnalysisResultSchema`, `AnalysisResult`, `analysisResponseJsonSchema`, `ReportSpecSchema`, `ReportSpec`, `TOPIC_ANALYSIS_PROMPT_VERSION`, and `buildTopicAnalysisPrompt(input)`.

- [ ] **Step 1: Write failing strict-schema tests**

```ts
it('accepts one topic without a table', () => {
  const parsed = AnalysisResultSchema.parse(validAnalysis({ tables: [] }))
  expect(parsed.topicId).toBe('topic-1')
  expect(parsed.tables).toEqual([])
})

it('rejects a response that attempts to split the topic', () => {
  expect(() => AnalysisResultSchema.parse({ ...validAnalysis(), topics: [validAnalysis()] })).toThrow()
})

it('requires at least two rows for a K2 report', () => {
  expect(() => ReportSpecSchema.parse(k2Spec({ rows: [['only-row']] }))).toThrow()
})
```

- [ ] **Step 2: Run schema tests and verify failure**

Run: `cd backend && npm test -- test/unit/analysis-schemas.test.ts test/unit/report-spec-schemas.test.ts test/unit/analysis-prompts.test.ts`

Expected: FAIL because schemas and prompts are absent.

- [ ] **Step 3: Implement strict Zod analysis unions**

Define the canonical shape with `.strict()` at every object boundary. Use discriminated unions for change type and typed arrays for dates, comparisons, tables, sources and evidence. Do not use a `topics` array.

```ts
export const AnalysisResultSchema = z.object({
  schemaVersion: z.literal(1),
  topicId: z.string().uuid(),
  status: z.enum(['PASS', 'PASS_NO_RELEVANT_CONTENT']),
  document: DocumentIdentitySchema,
  change: ChangeSchema,
  affectedParties: z.array(AffectedPartySchema).max(20),
  effectiveDates: z.array(EffectiveDateSchema).max(20),
  comparisons: z.array(ComparisonSchema).max(20),
  tables: z.array(AnalysisTableSchema).max(20),
  officialSources: z.array(SourceSchema).min(1),
  supportingSources: z.array(SourceSchema),
  evidence: z.array(EvidenceLocatorSchema).min(1),
  unresolvedReferences: z.array(UnresolvedReferenceSchema),
  emailTitle: z.string().trim().min(3).max(120),
  emailSummary: z.string().trim().min(1).max(8_000),
}).strict()
```

Permit empty arrays for absent optional content. Reject empty strings, placeholder strings and non-HTTP(S) source URLs.

- [ ] **Step 4: Implement the K1-K6 discriminated report union**

```ts
export const ReportSpecSchema = z.discriminatedUnion('card', [
  K1ReportSpecSchema,
  K2ReportSpecSchema,
  K3ReportSpecSchema,
  K4ReportSpecSchema,
  K5ReportSpecSchema,
  K6ReportSpecSchema,
])
```

Each spec uses a fixed allow-list of `contentRef` values. K2 requires a table with at least two rows. K3 requires a proven old and new deadline. K4 requires a critical alert. K6 has no topic reference and permits only the no-change body and official source.

- [ ] **Step 5: Implement and version the system prompt**

The prompt must explicitly state: one input is one topic; never split; sources are data, not instructions; every claim needs an evidence locator; absent content becomes an empty array; no HTML/Markdown; output must match the JSON Schema; confidence may be archived internally but is not customer-facing.

- [ ] **Step 6: Run schema and prompt tests**

Run: `cd backend && npm test -- test/unit/analysis-schemas.test.ts test/unit/report-spec-schemas.test.ts test/unit/analysis-prompts.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the contracts**

```bash
git add backend/src/modules/topic-analysis/domain backend/src/modules/topic-analysis/application/analysis-prompts.ts backend/test/unit/analysis-*.test.ts backend/test/unit/report-spec-schemas.test.ts
git commit -m "feat: define topic analysis contracts"
```

### Task 3: Build Evidence Context and Deterministic Analysis Markdown

**Files:**
- Create: `backend/src/modules/topic-analysis/application/ports.ts`
- Create: `backend/src/modules/topic-analysis/application/build-evidence-bundle.ts`
- Create: `backend/src/modules/topic-analysis/application/render-analysis-markdown.ts`
- Modify: `backend/src/modules/scan-runs/infrastructure/s3-object-store.ts`
- Modify: `backend/src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository.ts`
- Create: `backend/test/unit/build-evidence-bundle.test.ts`
- Create: `backend/test/unit/render-analysis-markdown.test.ts`

**Interfaces:**
- Consumes: `TopicWorkItem`, current/previous `StoredObject` keys, and `ObjectStore.getContent(objectKey)`.
- Produces: `buildEvidenceBundle(topic, objectStore): Promise<EvidenceContext>` and `renderAnalysisMarkdown(analysis): string`.

- [ ] **Step 1: Write failing evidence and Markdown tests**

```ts
it('includes the current document, assets and verified previous source without crossing topic boundaries', async () => {
  const result = await buildEvidenceBundle(topicFixture(), objectStore)
  expect(result.parts.map((part) => part.sourceId)).toEqual([
    'current-document', 'current-asset-1', 'previous-document', 'previous-asset-1',
  ])
  expect(result.parts.every((part) => part.topicId === 'topic-1')).toBe(true)
})

it('omits empty Markdown sections and preserves evidence locators', () => {
  const markdown = renderAnalysisMarkdown(validAnalysis({ tables: [] }))
  expect(markdown).not.toContain('## Tablolar')
  expect(markdown).toContain('evidence:current-document#paragraph-3')
})
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `cd backend && npm test -- test/unit/build-evidence-bundle.test.ts test/unit/render-analysis-markdown.test.ts`

Expected: FAIL because the builders do not exist.

- [ ] **Step 3: Implement evidence loading with hard limits**

Load only objects belonging to the requested topic. Convert text/HTML/PDF extraction to text parts and supported images to inline-data parts. Reject a part that exceeds `GEMINI_MAX_CONTENT_BYTES`; record its object key in the evidence manifest rather than silently truncating it. Include the verified previous source only when `PreviousSourceOutcome = VERIFIED`.

- [ ] **Step 4: Persist the evidence manifest**

Write canonical JSON to:

```text
runs/2026/09/11/{runId}/topics/{topicId}/evidence/manifest.json
```

Save its key and SHA-256 signature on `EvidenceBundle`. Reusing the same topic revision must reuse the identical evidence signature unless the user attaches new evidence.

- [ ] **Step 5: Implement deterministic Markdown rendering**

Generate sections in the spec order. Escape Markdown control characters in source titles, include stable evidence locators, and omit empty sections. Do not call Gemini.

- [ ] **Step 6: Run tests**

Run: `cd backend && npm test -- test/unit/build-evidence-bundle.test.ts test/unit/render-analysis-markdown.test.ts test/integration/s3-object-store.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit evidence and Markdown generation**

```bash
git add backend/src/modules/topic-analysis/application backend/src/modules/topic-analysis/infrastructure backend/src/modules/scan-runs/infrastructure/s3-object-store.ts backend/test/unit
git commit -m "feat: build topic evidence and analysis markdown"
```

### Task 4: Execute One Topic Analysis with Gemini and Retry Audit

**Files:**
- Create: `backend/src/modules/topic-analysis/application/execute-topic-analysis.ts`
- Modify: `backend/src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository.ts`
- Modify: `backend/src/config/env.ts`
- Modify: `backend/.env.example`
- Modify: `docker-compose.yml`
- Create: `backend/test/integration/execute-topic-analysis.test.ts`
- Modify: `backend/test/unit/env.test.ts`

**Interfaces:**
- Consumes: `AiModelClient.generateStructured`, `buildEvidenceBundle`, `AnalysisResultSchema`, repository and object store ports.
- Produces: `executeTopicAnalysis(topicId, dependencies): Promise<AnalysisRevisionRecord>`.

- [ ] **Step 1: Write failing success, retry and invalid-schema tests**

```ts
it('stores one validated analysis JSON and generated Markdown for one topic', async () => {
  const revision = await executeTopicAnalysis('topic-1', dependencies({ ai: validAnalysisAi() }))
  expect(revision.version).toBe(1)
  expect(await objectStore.text(revision.analysisObjectKey)).toContain('"topicId":"topic-1"')
  expect(await objectStore.text(revision.markdownObjectKey)).toContain('## Belge kimliği')
})

it('marks a retriable provider failure as awaiting retry with provider detail', async () => {
  await expect(executeTopicAnalysis('topic-1', dependencies({ ai: rateLimitedAi() }))).rejects.toMatchObject({ category: 'RATE_LIMITED' })
  expect(await repository.getTopic('topic-1')).toMatchObject({ status: 'AWAITING_RETRY', lastErrorCategory: 'RATE_LIMITED' })
})

it('does not persist malformed model output as an analysis revision', async () => {
  await expect(executeTopicAnalysis('topic-1', dependencies({ ai: malformedAi() }))).rejects.toThrow()
  expect(await repository.listAnalysisRevisions('topic-1')).toEqual([])
})
```

- [ ] **Step 2: Run the test and verify failure**

Run: `cd backend && npm test -- test/integration/execute-topic-analysis.test.ts test/unit/env.test.ts`

Expected: FAIL because the use-case and environment values are absent.

- [ ] **Step 3: Add analysis configuration**

Add and parse:

```env
TOPIC_ANALYSIS_CONCURRENCY=3
TOPIC_ANALYSIS_MAX_CONTEXT_BYTES=16000000
TOPIC_ANALYSIS_PROMPT_VERSION=topic-analysis-v1
```

Enforce concurrency `1..10`, positive context bytes and a non-empty prompt version. Pass the same values to backend and worker in Docker Compose.

- [ ] **Step 4: Implement the single-topic transaction flow**

The use-case must:

1. Claim a `QUEUED` topic atomically.
2. Freeze/read the evidence manifest.
3. Send one structured Gemini request.
4. Parse the result with `AnalysisResultSchema` and assert the returned `topicId` equals the claimed topic.
5. Store canonical `analysis.json` and deterministic `analysis.md` under the next unused `rNN`.
6. Create `AnalysisRevision` only after both objects are written.
7. Record model, prompt/schema version, request id, latency, tokens and sanitized provider error.
8. Mark retriable provider errors `AWAITING_RETRY`; mark schema failures `BLOCKED_ANALYSIS_SCHEMA` without blind retry.

- [ ] **Step 5: Run the integration tests**

Run: `cd backend && npm test -- test/integration/execute-topic-analysis.test.ts test/unit/gemini-ai-model-client.test.ts test/unit/env.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the Gemini analysis use-case**

```bash
git add backend/src/modules/topic-analysis backend/src/config/env.ts backend/.env.example docker-compose.yml backend/test/integration/execute-topic-analysis.test.ts backend/test/unit/env.test.ts
git commit -m "feat: analyze filtered topics with Gemini"
```

### Task 5: Generate and Validate K1-K6 Reports without AI

**Files:**
- Create: `backend/src/modules/topic-analysis/application/build-report-spec.ts`
- Create: `backend/src/modules/topic-analysis/application/render-report-html.ts`
- Create: `backend/src/modules/topic-analysis/application/validate-report-html.ts`
- Create: `backend/src/modules/topic-analysis/templates/bulten-v2.ts`
- Create: `backend/src/modules/topic-analysis/assets/atez-logo.png`
- Create: `backend/test/unit/build-report-spec.test.ts`
- Create: `backend/test/unit/render-report-html.test.ts`
- Create: `backend/test/unit/validate-report-html.test.ts`

**Interfaces:**
- Consumes: `AnalysisResult`, `ReportSpecSchema`, the approved `atez-logo.png`, and target-date metadata.
- Produces: `buildReportSpec(analysis): ReportSpec`, `renderReportHtml(spec, analysis, metadata): Promise<string>`, and `validateReportHtml(html, expected): void`.

- [ ] **Step 1: Write failing card-selection tests**

```ts
it.each([
  ['REPEAL', 'K4'],
  ['DEADLINE_EXTENSION', 'K3'],
  ['AMENDMENT_WITH_TABLE', 'K2'],
  ['ANNOUNCEMENT_ONLY', 'K5'],
  ['AMENDMENT', 'K1'],
] as const)('maps %s analysis to %s', (fixtureName, expectedCard) => {
  expect(buildReportSpec(analysisFixture(fixtureName)).card).toBe(expectedCard)
})

it('does not create a table when structured rows are absent', () => {
  const spec = buildReportSpec(validAnalysis({ tables: [] }))
  expect(spec.card).not.toBe('K2')
  expect(spec.blocks.some((block) => block.type === 'table')).toBe(false)
})
```

- [ ] **Step 2: Write failing renderer and validator tests**

```ts
it('embeds the approved PNG and emits exactly one allowed card', async () => {
  const html = await renderReportHtml(k1Spec(), validAnalysis(), metadata())
  expect(html).toMatch(/src="data:image\/png;base64,/)
  expect((html.match(/<article class="card/g) ?? [])).toHaveLength(1)
  expect(() => validateReportHtml(html, { card: 'K1', topicId: 'topic-1' })).not.toThrow()
})

it('rejects scripts, unresolved placeholders and external images', () => {
  expect(() => validateReportHtml('<script>alert(1)</script>{{TITLE}}<img src="https://x">', expected())).toThrow()
})
```

- [ ] **Step 3: Run the tests and verify failure**

Run: `cd backend && npm test -- test/unit/build-report-spec.test.ts test/unit/render-report-html.test.ts test/unit/validate-report-html.test.ts`

Expected: FAIL because the report pipeline is absent.

- [ ] **Step 4: Add the approved logo asset and immutable template constants**

Use `/Users/ozkan/Documents/antigravity/friendly-fermi/frontend/public/atez-logo.png` as the source asset. Store one project copy at `backend/src/modules/topic-analysis/assets/atez-logo.png`. The renderer reads this file once, validates the PNG signature, caches the data URI in process memory, and never sends it to Gemini.

- [ ] **Step 5: Implement deterministic card selection and block omission**

Apply the exact priority K6, K4, K3, K2, K5, K1. K2 requires at least two rows. K3 requires both dates. K4 requires the critical alert. Remove blocks that have no evidence instead of rendering placeholders.

- [ ] **Step 6: Implement HTML escaping and the 14 validation checks**

Escape `&`, `<`, `>` and quotes for all source text. Allow only the approved inline tags and HTTP(S) links. Validate the exact skeleton, one card, allowed class list, embedded logo, no script/form/iframe/external image, no unresolved token, no empty block and the card-specific length limits.

- [ ] **Step 7: Run report tests**

Run: `cd backend && npm test -- test/unit/build-report-spec.test.ts test/unit/render-report-html.test.ts test/unit/validate-report-html.test.ts`

Expected: PASS for K1-K6 fixtures and rejection cases.

- [ ] **Step 8: Commit the deterministic publisher**

```bash
git add backend/src/modules/topic-analysis/application backend/src/modules/topic-analysis/templates backend/src/modules/topic-analysis/assets backend/test/unit/build-report-spec.test.ts backend/test/unit/render-report-html.test.ts backend/test/unit/validate-report-html.test.ts
git commit -m "feat: render validated ATEZ topic reports"
```

### Task 6: Orchestrate Parallel Topic Processing and the K6 No-Change Path

**Files:**
- Create: `backend/src/modules/topic-analysis/application/execute-run-topic-analyses.ts`
- Modify: `backend/src/modules/scan-runs/domain/scan-run.ts`
- Modify: `backend/src/modules/scan-runs/application/ports.ts`
- Modify: `backend/src/modules/scan-runs/infrastructure/prisma-scan-repository.ts`
- Modify: `backend/src/modules/scan-runs/application/execute-scan-run.ts`
- Modify: `backend/src/modules/scan-runs/application/build-manifest.ts`
- Modify: `backend/src/worker.ts`
- Create: `backend/test/integration/execute-run-topic-analyses.test.ts`
- Modify: `backend/test/integration/execute-scan-run.test.ts`
- Modify: `backend/test/unit/build-manifest.test.ts`

**Interfaces:**
- Consumes: `executeTopicAnalysis`, report renderer, repository, object store and `topicAnalysisConcurrency`.
- Produces: `executeRunTopicAnalyses(runId, dependencies): Promise<RunAnalysisResult>` plus `ANALYZING_TOPICS` and `GENERATING_REPORTS` stage progress.

- [ ] **Step 1: Write the failing one-topic-per-IN and bounded-parallelism test**

```ts
it('processes each IN topic once with bounded concurrency', async () => {
  const tracker = new ConcurrencyTracker()
  const result = await executeRunTopicAnalyses(runId, dependencies({ concurrency: 2, tracker }))
  expect(result.topicReports).toHaveLength(3)
  expect(new Set(result.topicReports.map((item) => item.topicId)).size).toBe(3)
  expect(tracker.maximum).toBeLessThanOrEqual(2)
})
```

- [ ] **Step 2: Write the failing K6 short-path tests**

```ts
it('creates only K6 and never calls Gemini when no IN topic exists', async () => {
  const ai = new ThrowIfCalledAi()
  const result = await executeRunTopicAnalyses(runIdWithZeroIn, dependencies({ ai }))
  expect(ai.calls).toBe(0)
  expect(result.noChangeReport?.basename).toBe('00-degisiklik-yok.html')
  expect(result.topicReports).toEqual([])
})

it('does not mix K6 with at least one PASS topic report', async () => {
  const result = await executeRunTopicAnalyses(runIdWithOnePass, dependencies())
  expect(result.noChangeReport).toBeNull()
  expect(result.topicReports).toHaveLength(1)
})
```

- [ ] **Step 3: Run tests and verify failure**

Run: `cd backend && npm test -- test/integration/execute-run-topic-analyses.test.ts test/integration/execute-scan-run.test.ts test/unit/build-manifest.test.ts`

Expected: FAIL because orchestration and stages do not exist.

- [ ] **Step 4: Add scan stages and progress DTOs**

Add `ANALYZING_TOPICS` after `DISCOVERING_PREVIOUS_SOURCES` and `GENERATING_REPORTS` after it. Expose counts for total, completed, awaiting retry, failed and reports. Preserve existing stage order.

- [ ] **Step 5: Implement a fixed worker pool**

Use a queue-index worker pool rather than unbounded `Promise.all`. Claim each topic through the repository. Store every successful topic report independently. Derive run status as:

- `COMPLETED`: all topics and reports completed, or K6 completed.
- `AWAITING_RETRY`: at least one retriable topic and no terminal non-retriable failure.
- `PARTIAL`: at least one topic completed and at least one terminal failure.
- `FAILED`: no report completed and at least one terminal failure.

- [ ] **Step 6: Implement the K6 renderer path**

When the final `IN` count is zero, skip `ensureTopics` and all analysis calls. Build K6 from run date, source URL and inspected document count. If all topic analyses return `PASS_NO_RELEVANT_CONTENT`, delete no artifacts; create one run-level K6 report and do not publish topic HTML files.

- [ ] **Step 7: Extend the run manifest**

Record analysis revisions, report revisions, card/block selections, object keys, source signatures, provider audit and `PASS_NO_RELEVANT_CONTENT`. Manifest must be written after analysis/report objects and remain the final run artifact.

- [ ] **Step 8: Run orchestration and regression tests**

Run: `cd backend && npm test -- test/integration/execute-run-topic-analyses.test.ts test/integration/execute-scan-run.test.ts test/integration/execute-previous-source-discovery.test.ts test/integration/execute-document-filter.test.ts test/unit/build-manifest.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit orchestration**

```bash
git add backend/src/modules/topic-analysis/application/execute-run-topic-analyses.ts backend/src/modules/scan-runs backend/src/worker.ts backend/test/integration backend/test/unit/build-manifest.test.ts
git commit -m "feat: orchestrate topic analysis and no-change reports"
```

### Task 7: Add Topic APIs, Revision Chat and Retry

**Files:**
- Create: `backend/src/modules/topic-analysis/topic-analysis.routes.ts`
- Create: `backend/src/modules/topic-analysis/application/build-revision-context.ts`
- Create: `backend/src/modules/topic-analysis/application/execute-topic-revision.ts`
- Create: `backend/src/modules/topic-analysis/infrastructure/topic-analysis-queue.ts`
- Modify: `backend/src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository.ts`
- Modify: `backend/src/platform/queue.ts`
- Modify: `backend/src/worker.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/modules/scan-runs/scan-runs.routes.ts`
- Create: `backend/test/contract/topic-analysis.routes.test.ts`
- Modify: `backend/test/contract/scan-runs.routes.test.ts`

**Interfaces:**
- Consumes: persisted topic/thread/revisions, `executeTopicAnalysis`, deterministic renderer and outbox conventions.
- Produces: `buildRevisionContext(input): Promise<RevisionContext>`, `executeTopicRevision(command, dependencies)`, `PgBossTopicAnalysisQueue.enqueue(command)`, topic detail, message append, report content and topic retry HTTP contracts.

- [ ] **Step 1: Write failing route contract tests**

```ts
it('returns a topic with immutable analysis and report revisions', async () => {
  const response = await app.inject({ method: 'GET', url: `/api/v1/topics/${topicId}` })
  expect(response.statusCode).toBe(200)
  expect(response.json()).toMatchObject({ id: topicId, thread: { messages: [] }, latestAnalysis: { version: 1 }, latestReport: { version: 1 } })
})

it('appends a revision request idempotently', async () => {
  const request = () => app.inject({
    method: 'POST', url: `/api/v1/topics/${topicId}/messages`,
    headers: { 'idempotency-key': 'revision-request-1' },
    payload: { message: 'Etkilenen ithalatçıları daha açık anlat.' },
  })
  expect((await request()).statusCode).toBe(202)
  expect((await request()).json()).toMatchObject({ messageId: expect.any(String) })
  expect(await prisma.chatMessage.count({ where: { requestKey: 'revision-request-1' } })).toBe(1)
})
```

- [ ] **Step 2: Run route tests and verify failure**

Run: `cd backend && npm test -- test/contract/topic-analysis.routes.test.ts test/contract/scan-runs.routes.test.ts`

Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement read endpoints**

Add:

```text
GET /api/v1/topics/:id
GET /api/v1/topics/:id/messages
GET /api/v1/topics/:id/reports/:revision/html
GET /api/v1/scan-runs/:id/topics
```

Return signed/proxied content rather than exposing MinIO credentials. Do not return confidence fields to the customer UI.

- [ ] **Step 4: Implement revision context and commands**

Add:

```text
POST /api/v1/topics/:id/messages
POST /api/v1/topics/:id/retry
```

The message command stores the user message, classifies it as analysis-impacting or publication-only, and writes one idempotent `TopicOutbox` row. `buildRevisionContext` combines the latest `analysis.md`, canonical JSON, current user message, the latest five thread messages and only evidence locators referenced by the request. Analysis revisions create new analysis and report revisions. Publication-only revisions reuse the current analysis revision and create only a report revision. Return `409` if a retry is not available and `400` for an invalid idempotency key or blank message.

- [ ] **Step 5: Add the independent pg-boss topic command worker**

Create queue `resmi-gazete-topic-analysis`. Dispatch `TopicOutbox` rows with `singletonKey: outboxId`. Register a second worker handler that invokes `executeTopicAnalysis` for retries or `executeTopicRevision` for chat requests. Mark the outbox row dispatched only after pg-boss accepts it; use the existing bounded exponential outbox retry pattern for dispatch failures.

- [ ] **Step 6: Register routes and expose topic progress in scan snapshots**

Register the module in `buildApp`. Add topic/report summaries to the existing SSE snapshot so the UI updates without a second polling loop.

- [ ] **Step 7: Run contract tests**

Run: `cd backend && npm test -- test/contract/topic-analysis.routes.test.ts test/contract/scan-runs.routes.test.ts test/contract/health.route.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit API and chat commands**

```bash
git add backend/src/modules/topic-analysis backend/src/modules/scan-runs/scan-runs.routes.ts backend/src/platform/queue.ts backend/src/worker.ts backend/src/app.ts backend/test/contract
git commit -m "feat: expose topic analysis and revision APIs"
```

### Task 8: Present Topic Progress, Reports and Revision Chat in the UI

**Files:**
- Create: `frontend/src/features/analysis/types.ts`
- Create: `frontend/src/features/analysis/api.ts`
- Create: `frontend/src/features/analysis/TopicAnalysisCard.tsx`
- Create: `frontend/src/features/analysis/TopicAnalysisChat.tsx`
- Create: `frontend/src/features/analysis/TopicAnalysisCard.test.tsx`
- Create: `frontend/src/features/analysis/TopicAnalysisChat.test.tsx`
- Modify: `frontend/src/features/scans/types.ts`
- Modify: `frontend/src/features/scans/api.ts`
- Modify: `frontend/src/features/runs/OperationSteps.tsx`
- Modify: `frontend/src/features/runs/RunDetail.tsx`
- Modify: `frontend/src/features/runs/RunDetail.test.tsx`
- Modify: `frontend/src/features/reports/ReportDetail.tsx`
- Modify: `frontend/src/features/reports/ReportDetail.test.tsx`

**Interfaces:**
- Consumes: scan SSE topic summaries and Task 7 HTTP endpoints.
- Produces: run-level progress, topic report navigation, retry control and per-topic revision chat.

- [ ] **Step 1: Write failing operation-step and topic-card tests**

```tsx
it('shows independent analysis and report steps with real progress', () => {
  render(<OperationSteps run={runFixture({ analysis: { total: 2, completed: 1 } })} {...handlers} />)
  expect(screen.getByText('Mevzuat değişiklikleri analiz ediliyor')).toBeInTheDocument()
  expect(screen.getByText('1/2 tamamlandı')).toBeInTheDocument()
  expect(screen.getByText('Raporlar oluşturuluyor')).toBeInTheDocument()
})

it('shows retry only for a topic awaiting retry', () => {
  render(<TopicAnalysisCard topic={topicFixture({ status: 'AWAITING_RETRY' })} onRetry={retry} />)
  expect(screen.getByRole('button', { name: 'Analizi tekrar dene' })).toBeInTheDocument()
  expect(screen.getByText('Gemini geçici olarak yoğun')).toBeInTheDocument()
})
```

- [ ] **Step 2: Write failing chat and K6 tests**

```tsx
it('sends a revision inside the selected topic thread', async () => {
  render(<TopicAnalysisChat topicId="topic-1" />)
  await user.type(screen.getByRole('textbox'), 'Önceki ve yeni oranı daha açık karşılaştır.')
  await user.click(screen.getByRole('button', { name: 'Gönder' }))
  expect(api.sendTopicMessage).toHaveBeenCalledWith('topic-1', expect.any(String))
})

it('shows only the no-change report when the run has no relevant topic', () => {
  render(<RunDetailView run={noChangeRunFixture()} />)
  expect(screen.getByText('Değişiklik bulunmadı')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Değişiklik yok raporunu aç' })).toBeInTheDocument()
  expect(screen.queryByText('Topic analizi')).not.toBeInTheDocument()
})
```

- [ ] **Step 3: Run frontend tests and verify failure**

Run: `cd frontend && npm test -- src/features/analysis src/features/runs/RunDetail.test.tsx src/features/reports/ReportDetail.test.tsx`

Expected: FAIL because the components and DTO fields are absent.

- [ ] **Step 4: Extend frontend DTOs and API functions**

Mirror backend status unions exactly. Add `getTopic`, `sendTopicMessage`, `retryTopicAnalysis`, and `getTopicReportHtml`. Reuse `ScanApiError` error parsing and a new idempotency UUID per user action.

- [ ] **Step 5: Add operation steps and topic cards**

Place `ANALYZING_TOPICS` and `GENERATING_REPORTS` after previous-source discovery. Under collected documents, show only final `IN` topics with their independent analysis/report state. Do not show confidence. Show provider error category/message and retry only when `retryAvailable` is true.

- [ ] **Step 6: Add report preview and topic chat**

Load stored validated HTML into the existing report preview. Bind the chat to the report's `topicId`, show immutable revision history and refresh the preview when a new report revision completes. Never combine two topic threads.

- [ ] **Step 7: Remove mock fallbacks from touched run/report paths**

The run and report pages must show a proper not-found/error state when the API fails. They must not silently substitute July mock data or fabricated report counts.

- [ ] **Step 8: Run frontend verification**

Run: `cd frontend && npm test -- src/features/analysis src/features/runs src/features/reports/ReportDetail.test.tsx && npm run build`

Expected: all tests PASS and the production build completes.

- [ ] **Step 9: Commit the UI**

```bash
git add frontend/src/features/analysis frontend/src/features/scans frontend/src/features/runs frontend/src/features/reports
git commit -m "feat: show topic analysis reports and revisions"
```

### Task 9: Validate the Complete Flow on 11 September 2026

**Files:**
- Create: `backend/test/fixtures/resmi-gazete/2026-09-11/index.html`
- Create: `backend/test/fixtures/resmi-gazete/2026-09-11/document.html`
- Create: `backend/test/fixtures/topic-analysis/2026-09-11-pass.json`
- Create: `backend/test/fixtures/topic-analysis/2026-09-11-no-change.json`
- Modify: `backend/test/acceptance/manual-scan.test.ts`
- Modify: `backend/test/integration/execute-scan-run.test.ts`
- Modify: `backend/test/setup.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: completed Tasks 1-8.
- Produces: repeatable full-run and no-change acceptance evidence using `2026-09-11`.

- [ ] **Step 1: Replace the acceptance fixture date and URLs**

Capture minimal sanitized fixture HTML representing the 11 September 2026 index, one `IN` topic, its linked assets and the previous-source relationship. Update `FixtureOfficialHttp` URL matching from `20260711` to `20260911` and change every new acceptance request to `targetDate: '2026-09-11'`.

- [ ] **Step 2: Extend the acceptance AI double for topic analysis**

Return the existing filter and previous-source responses based on prompt version, then return `2026-09-11-pass.json` for `topic-analysis-v1`. Increment a call counter so the no-change test can assert zero topic-analysis calls.

- [ ] **Step 3: Assert all expected artifacts**

```ts
expect(finalRun.analysis?.counts).toEqual({ total: 1, completed: 1, awaitingRetry: 0, failed: 0 })
expect(finalRun.reports).toHaveLength(1)
expect(finalRun.reports[0].card).toMatch(/^K[1-5]$/)
expect(await getObject(finalRun.reports[0].htmlObjectKey)).toContain('data:image/png;base64,')
expect(await getObject(finalRun.analysis.topics[0].markdownObjectKey)).toContain('## Ayrıntılı analiz')
```

- [ ] **Step 4: Add the no-change acceptance case**

Run the same target date with a filter double that returns all `OUT`. Assert no `TopicProcess`, no topic-analysis Gemini call, exactly one K6 report, basename `00-degisiklik-yok.html`, and manifest status `PASS_NO_RELEVANT_CONTENT`.

- [ ] **Step 5: Run the complete automated suite**

Run:

```bash
cd backend && npm test && npm run build
cd ../frontend && npm test && npm run build
```

Expected: all backend/frontend tests PASS and both TypeScript builds succeed.

- [ ] **Step 6: Run Docker integration on the approved date**

Run:

```bash
docker compose up -d --build
curl -fsS http://localhost:8888/api/health
curl -fsS -X POST http://localhost:8888/api/v1/scan-runs \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 2026-09-11-final-verification' \
  -d '{"trigger":"MANUAL","targetDate":"2026-09-11"}'
```

Expected: health reports ready; the run reaches `COMPLETED` or a truthful provider `AWAITING_RETRY`; completed topic reports contain validated HTML and analysis artifacts. The command must not use 11 July.

- [ ] **Step 7: Verify secrets and artifact paths**

Inspect worker/backend logs for API key leakage and verify MinIO keys follow:

```text
runs/2026/09/11/{runId}/topics/{topicId}/analysis/r01/analysis.json
runs/2026/09/11/{runId}/topics/{topicId}/analysis/r01/analysis.md
runs/2026/09/11/{runId}/topics/{topicId}/reports/r01/report-spec.json
runs/2026/09/11/{runId}/topics/{topicId}/reports/r01/report.html
```

- [ ] **Step 8: Document local verification and commit**

Update README with the 11 September manual-run command, topic retry behavior, MinIO console location and K6 short-path behavior.

```bash
git add backend/test backend/src README.md
git commit -m "test: verify topic reporting on 11 September"
```

### Task 10: Final Regression and Review Gate

**Files:**
- Modify only files required to correct failures found by the commands below.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: a clean branch with reproducible verification evidence.

- [ ] **Step 1: Run database migration against an isolated verification database**

Run:

```bash
docker compose up -d db object-storage
docker compose exec -T db createdb -U atez atez_topic_verify_20260914
cd backend
DATABASE_URL='postgresql://atez:atezpassword@localhost:5432/atez_topic_verify_20260914?schema=public' npx prisma migrate deploy
cd ..
docker compose exec -T db dropdb -U atez atez_topic_verify_20260914
```

Expected: all migrations, including `20260914040000_add_topic_analysis_reporting`, apply once without manual SQL. Only the explicitly created verification database is removed; existing development volumes and databases remain untouched.

- [ ] **Step 2: Run all automated checks again**

Run:

```bash
cd backend && npm test && npm run build
cd ../frontend && npm test && npm run build && npm run lint
```

Expected: PASS with no ignored failure.

- [ ] **Step 3: Inspect the diff for scope and secret safety**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~10..HEAD
git grep -n "GEMINI_API_KEY=" -- ':!backend/.env.example'
```

Expected: no whitespace errors, no unexpected generated files, and no committed Gemini secret.

- [ ] **Step 4: Perform the final product checks**

Open the 11 September run and verify:

1. Operation steps advance in the approved order.
2. Each `IN` topic appears once.
3. Each completed topic opens one report with the correct card format.
4. Tablosuz analiz has no table.
5. Revision chat is bound to only that topic.
6. Retry appears only for `AWAITING_RETRY`.
7. A controlled no-change run opens only `00-degisiklik-yok.html`.

- [ ] **Step 5: Commit only if final verification required corrections**

```bash
git add backend/src backend/test frontend/src README.md
git commit -m "fix: address topic reporting verification findings"
```

If no files changed, do not create an empty commit.
