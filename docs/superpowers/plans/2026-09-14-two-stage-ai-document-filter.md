# Two-Stage Gemini Document Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a resumable second scan stage that uses Gemini 3.8 Flash to classify all Resmî Gazete titles as `IN`, `OUT`, or `MAYBE`, resolves `MAYBE` documents from their contents to final `IN` or `OUT`, and archives every source document.

**Architecture:** Keep Gemini behind a reusable structured-generation port and put all filter behavior in a stateless `DocumentFilterService`. Persist the logical AI job, every provider call, and every document decision; pause the same scan in `AWAITING_RETRY` on diagnosable Gemini failures and resume only unfinished filter work through an idempotent outbox command.

**Tech Stack:** Node.js 22, TypeScript, Fastify, Prisma/PostgreSQL, pg-boss, MinIO/S3, Zod, YAML, Google Gen AI JavaScript SDK, React 19, Vitest, Testing Library, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-14-two-stage-ai-document-filter-design.md`

## Global Constraints

- Use Gemini model ID `gemini-3.8-flash`.
- First pass sends every discovered title together and permits `IN`, `OUT`, or `MAYBE`.
- Second pass processes only `MAYBE` documents and permits only final `IN` or `OUT`.
- The supplied keyword levels are semantic context, never exact-match rules.
- Download and archive all documents and supported assets, including final `OUT` documents.
- Persist confidence in PostgreSQL, but never return it in user-facing DTOs or render it in the UI.
- Keep filtering stateless; do not create or reuse conversation history.
- Keep `GEMINI_API_KEY` server-side, untracked, unlogged, and unpersisted.
- Automated tests use fakes and never consume Gemini quota.
- Preserve unrelated working-tree changes and stage only files named by each task.

## File Structure

### Backend files to create

- `backend/prisma/migrations/<timestamp>_add_ai_document_filter/migration.sql` — enum, state, AI audit, decision, and retry-outbox schema changes.
- `backend/config/document-filter-keywords.yaml` — versioned domain signals copied from the supplied reference.
- `backend/src/modules/ai/application/ai-model-client.ts` — provider-neutral structured-generation types and port.
- `backend/src/modules/ai/domain/ai-errors.ts` — stable error categories and retryability rules.
- `backend/src/modules/ai/infrastructure/gemini-ai-model-client.ts` — Gemini SDK adapter, structured output, timeout, and provider error mapping.
- `backend/src/modules/scan-runs/application/document-filter-schemas.ts` — strict first- and second-pass Zod schemas.
- `backend/src/modules/scan-runs/application/document-filter-prompts.ts` — versioned prompt construction and keyword configuration fingerprint.
- `backend/src/modules/scan-runs/application/normalize-document-content.ts` — HTML normalization and Gemini input-part construction.
- `backend/src/modules/scan-runs/application/execute-document-filter.ts` — resumable two-pass filter application service.
- `backend/test/unit/document-filter-prompts.test.ts` — prompt and response contract tests.
- `backend/test/unit/gemini-ai-model-client.test.ts` — adapter, error mapping, and automatic retry tests.
- `backend/test/unit/normalize-document-content.test.ts` — HTML/PDF input normalization tests.
- `backend/test/integration/document-filter-repository.test.ts` — atomic persistence and resume-query tests.
- `backend/test/integration/execute-document-filter.test.ts` — real PostgreSQL/MinIO-boundary flow with fake Gemini.

### Backend files to modify

- `backend/package.json`, `backend/package-lock.json` — add `@google/genai` and `yaml`.
- `backend/Dockerfile` — include `backend/config` in build and runtime images.
- `backend/prisma/schema.prisma` — add `AI_FILTERING`, `AWAITING_RETRY`, AI models, decisions, and repeatable outbox commands.
- `backend/src/config/env.ts` — Gemini model, timeout, retries, and safe content budget.
- `backend/src/modules/scan-runs/domain/scan-run.ts` — new ordered stage and paused run state.
- `backend/src/modules/scan-runs/application/ports.ts` — filter DTOs, repository operations, stored-object reads, and queue commands.
- `backend/src/modules/scan-runs/application/execute-scan-run.ts` — insert filtering, reuse stored documents, and resume from filtering.
- `backend/src/modules/scan-runs/application/build-manifest.ts` — emit final filter audit fields.
- `backend/src/modules/scan-runs/infrastructure/prisma-scan-repository.ts` — AI job/call/decision persistence and retry state transitions.
- `backend/src/modules/scan-runs/infrastructure/s3-object-store.ts` — retrieve already archived content for resume/materialization.
- `backend/src/modules/scan-runs/infrastructure/scan-run-queue.ts` — enqueue a typed command with an outbox-specific singleton key.
- `backend/src/modules/scan-runs/scan-runs.schemas.ts` — validate retry idempotency input.
- `backend/src/modules/scan-runs/scan-runs.routes.ts` — expose retry and filter summaries.
- `backend/src/platform/queue.ts` — keep one queue but support start and filter-retry commands.
- `backend/src/worker.ts` — construct Gemini/filter dependencies and dispatch typed outbox commands.
- `backend/test/unit/scan-run.test.ts` — stage order tests.
- `backend/test/unit/env.test.ts` — Gemini configuration tests.
- `backend/test/unit/build-manifest.test.ts` — filter audit manifest tests.
- `backend/test/integration/execute-scan-run.test.ts` — end-to-end orchestration and download-reuse tests.
- `backend/test/contract/scan-runs.routes.test.ts` — retry API and confidence-redaction tests.
- `backend/test/acceptance/manual-scan.test.ts` — completed run with final decisions.
- `docker-compose.yml` — pass server-side Gemini settings to backend and worker.

### Frontend files to modify

- `frontend/src/features/scans/types.ts` — paused status, AI stage, safe filter summary, and decision DTOs.
- `frontend/src/features/scans/api.ts` — retry request.
- `frontend/src/features/scans/useScanRun.ts` — treat paused state as stable and reconnect after retry.
- `frontend/src/features/runs/OperationSteps.tsx` — second AI-filter row, diagnosis, and retry action.
- `frontend/src/features/runs/CollectedDocuments.tsx` — show final decision and reason without confidence.
- `frontend/src/features/runs/RunDetail.tsx` — real `IN` count and retry coordination.
- `frontend/src/features/dashboard/RecentScanRuns.tsx` — paused status label and style.
- `frontend/src/features/runs/RunDetail.test.tsx` — retry and filter display tests.
- `frontend/src/features/dashboard/Dashboard.test.tsx` — paused run rendering test.

---

### Task 1: Extend the scan state machine and persistence schema

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_ai_document_filter/migration.sql`
- Modify: `backend/src/modules/scan-runs/domain/scan-run.ts`
- Modify: `backend/test/unit/scan-run.test.ts`

**Interfaces:**
- Produces: `ScanStage` containing `AI_FILTERING` immediately after `DISCOVERING`.
- Produces: `ScanRunStatus` and `StageExecutionStatus` containing `AWAITING_RETRY`.
- Produces: Prisma models `AiJob`, `AiCall`, and `DocumentFilterDecision` and a repeatable `ScanOutbox` command record.

- [ ] **Step 1: Write failing stage-order tests**

```ts
it('places AI filtering immediately after discovery', () => {
  expect(scanStages).toEqual([
    'DISCOVERING', 'AI_FILTERING', 'DOWNLOADING_DOCUMENTS',
    'DISCOVERING_ASSETS', 'DOWNLOADING_ASSETS', 'VALIDATING', 'WRITING_MANIFEST',
  ])
  expect(() => assertStageTransition('DISCOVERING', 'AI_FILTERING')).not.toThrow()
  expect(() => assertStageTransition('AI_FILTERING', 'DOWNLOADING_DOCUMENTS')).not.toThrow()
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd backend && npm test -- test/unit/scan-run.test.ts`  
Expected: FAIL because `AI_FILTERING` is not a `ScanStage`.

- [ ] **Step 3: Add the domain and Prisma enums**

Add `AI_FILTERING`, `AWAITING_RETRY`, and these AI enums:

```prisma
enum FilterDecision { IN OUT MAYBE }
enum FinalFilterDecision { IN OUT }
enum AiJobKind { DOCUMENT_FILTER }
enum AiJobStatus { QUEUED RUNNING COMPLETED AWAITING_RETRY FAILED }
enum AiCallPhase { TITLE CONTENT }
enum AiCallStatus { RUNNING COMPLETED FAILED }
enum AiErrorCategory {
  AUTHENTICATION PERMISSION QUOTA_EXCEEDED RATE_LIMITED
  PROVIDER_UNAVAILABLE TIMEOUT INVALID_RESPONSE CONTENT_REJECTED
  UNKNOWN_PROVIDER_ERROR
}
enum ScanCommandType { START_SCAN RETRY_AI_FILTER }
```

Add `AiJob` with a unique `(scanRunId, kind)`, `AiCall` with a unique `(aiJobId, phase, batchKey, attemptNo)`, and `DocumentFilterDecision` with a unique `(aiJobId, documentId)`. Add the relations to `ScanRun` and `CollectedDocument`.

Change `ScanOutbox` from one row per run to repeatable commands by removing `scanRunId @unique` and adding:

```prisma
commandType ScanCommandType @default(START_SCAN)
requestKey String @unique
```

The SQL migration must preserve existing outbox rows by setting `requestKey` from the related `ScanRun.requestKey` and `commandType` to `START_SCAN` before adding `NOT NULL` constraints.

- [ ] **Step 4: Generate Prisma client and apply the migration**

Run: `cd backend && npx prisma generate && DATABASE_URL='postgresql://atez:atezpassword@localhost:5432/atez_db?schema=public' npx prisma migrate deploy`  
Expected: migration applies without deleting existing runs.

- [ ] **Step 5: Implement the TypeScript stage order and verify GREEN**

Update `scanStages` so the array exactly matches the test. Run: `cd backend && npm test -- test/unit/scan-run.test.ts && npm run build`  
Expected: PASS and TypeScript build exits 0.

- [ ] **Step 6: Commit the state foundation**

```bash
git add backend/prisma backend/src/modules/scan-runs/domain/scan-run.ts backend/test/unit/scan-run.test.ts
git commit -m "feat: add AI filter scan state"
```

### Task 2: Add Gemini configuration, keyword context, and strict filter contracts

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Create: `backend/config/document-filter-keywords.yaml`
- Modify: `backend/Dockerfile`
- Modify: `backend/src/config/env.ts`
- Create: `backend/src/modules/ai/application/ai-model-client.ts`
- Create: `backend/src/modules/scan-runs/application/document-filter-schemas.ts`
- Create: `backend/src/modules/scan-runs/application/document-filter-prompts.ts`
- Modify: `backend/test/unit/env.test.ts`
- Create: `backend/test/unit/document-filter-prompts.test.ts`

**Interfaces:**
- Produces: `AiModelClient.generateStructured(request: StructuredAiRequest): Promise<StructuredAiResult>`.
- Produces: `buildTitleFilterRequest(documents)` and `buildContentFilterRequest(documents)`.
- Produces: `parseTitleFilterResponse(raw, expectedIds)` and `parseContentFilterResponse(raw, expectedIds)`.

- [ ] **Step 1: Write failing configuration and schema tests**

Test these exact behaviors:

```ts
expect(loadEnv(base).gemini).toMatchObject({
  model: 'gemini-3.8-flash', timeoutMs: 30_000, maxAttempts: 3,
})

expect(() => parseTitleFilterResponse({ decisions: [
  { documentId: 'doc-1', decision: 'IN', reason: 'İthalatı düzenliyor.', confidence: 0.9 },
] }, ['doc-1', 'doc-2'])).toThrow('missing document IDs')

expect(() => parseContentFilterResponse({ decisions: [
  { documentId: 'doc-1', decision: 'MAYBE', reason: 'Kararsız.', confidence: 0.5 },
] }, ['doc-1'])).toThrow('final IN or OUT')
```

Also assert that the title prompt contains every stable ID/title and explicitly says keyword entries are contextual signals rather than exact rules.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd backend && npm test -- test/unit/env.test.ts test/unit/document-filter-prompts.test.ts`  
Expected: FAIL because Gemini config and filter modules do not exist.

- [ ] **Step 3: Install dependencies and copy the approved keyword guide**

Run: `cd backend && npm install @google/genai yaml`.

Create `backend/config/document-filter-keywords.yaml` with the exact `l1`, `l2`, and `l3` values from `/Users/ozkan/Documents/Codex/2026-08-16/https-www-resmigazete-gov-tr-https/config/keywords.yaml`. Update both Docker stages to `COPY config ./config`.

- [ ] **Step 4: Define the provider-neutral AI port**

```ts
export type AiInputPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }

export interface StructuredAiRequest {
  model: string
  systemInstruction: string
  parts: AiInputPart[]
  responseJsonSchema: Record<string, unknown>
}

export interface StructuredAiResult {
  json: unknown
  providerRequestId: string | null
  usage: { inputTokens: number | null; outputTokens: number | null }
}

export interface AiModelClient {
  generateStructured(request: StructuredAiRequest): Promise<StructuredAiResult>
}
```

- [ ] **Step 5: Implement strict response validation**

Use strict Zod objects. After parsing, compare sorted expected and returned ID sets, reject duplicates, and reject second-pass `MAYBE`. Export normalized decision arrays only after the whole payload passes.

- [ ] **Step 6: Implement versioned prompt builders**

Export constants `TITLE_FILTER_PROMPT_VERSION = 'document-filter-title-v1'` and `CONTENT_FILTER_PROMPT_VERSION = 'document-filter-content-v1'`. Load the YAML once, validate `l1/l2/l3` as non-empty string arrays, and calculate `configurationHash` with SHA-256 over canonical JSON. The system instruction must define customs/foreign-trade relevance, require Turkish reasons, and state that keywords are advisory examples.

- [ ] **Step 7: Add non-breaking environment defaults**

Add `GEMINI_API_KEY` as an optional non-empty string. Because Docker Compose deliberately supplies an empty default, normalize an empty or whitespace-only value to `undefined` before Zod validation:

```ts
GEMINI_API_KEY: z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(1).optional(),
)
```

Add these defaults:

```ts
GEMINI_MODEL: 'gemini-3.8-flash'
GEMINI_TIMEOUT_MS: 30_000
GEMINI_MAX_ATTEMPTS: 3
GEMINI_MAX_CONTENT_BYTES: 8_000_000
```

An absent key must not prevent the API or worker from starting; attempting the AI stage without it produces an `AUTHENTICATION` job error.

- [ ] **Step 8: Verify GREEN and commit**

Run: `cd backend && npm test -- test/unit/env.test.ts test/unit/document-filter-prompts.test.ts && npm run build`  
Expected: all selected tests pass.

```bash
git add backend/package.json backend/package-lock.json backend/config backend/Dockerfile backend/src/config/env.ts backend/src/modules/ai/application backend/src/modules/scan-runs/application/document-filter-schemas.ts backend/src/modules/scan-runs/application/document-filter-prompts.ts backend/test/unit/env.test.ts backend/test/unit/document-filter-prompts.test.ts
git commit -m "feat: define versioned Gemini filter contracts"
```

### Task 3: Implement the Gemini structured adapter and diagnostic retries

**Files:**
- Create: `backend/src/modules/ai/domain/ai-errors.ts`
- Create: `backend/src/modules/ai/infrastructure/gemini-ai-model-client.ts`
- Create: `backend/test/unit/gemini-ai-model-client.test.ts`

**Interfaces:**
- Consumes: `AiModelClient`, `StructuredAiRequest`, and `StructuredAiResult` from Task 2.
- Produces: `GeminiAiModelClient` and `AiProviderError` with stable `category`, `retryable`, `providerStatus`, and sanitized message.

- [ ] **Step 1: Write failing adapter tests around an injected transport**

Use a transport fake rather than a real API. Cover:

```ts
it('returns parsed JSON and token usage from a structured Gemini response')
it('maps 401 to non-retryable AUTHENTICATION')
it('maps 429 to retryable RATE_LIMITED and succeeds on the third attempt')
it('maps 5xx to PROVIDER_UNAVAILABLE')
it('maps timeout to TIMEOUT')
it('retries invalid JSON and then reports INVALID_RESPONSE')
it('never includes an API key or raw response body in its error message')
```

Inject `sleep(ms)` and `random()` so retry tests assert delays without actually waiting.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd backend && npm test -- test/unit/gemini-ai-model-client.test.ts`  
Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement stable errors and retry policy**

```ts
export type AiErrorCategory =
  | 'AUTHENTICATION' | 'PERMISSION' | 'QUOTA_EXCEEDED' | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE' | 'TIMEOUT' | 'INVALID_RESPONSE'
  | 'CONTENT_REJECTED' | 'UNKNOWN_PROVIDER_ERROR'

export class AiProviderError extends Error {
  constructor(
    readonly category: AiErrorCategory,
    readonly retryable: boolean,
    message: string,
    readonly providerStatus: number | null = null,
  ) { super(message) }
}
```

Retry only `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `TIMEOUT`, and corrective `INVALID_RESPONSE`. Use `min(10_000, 500 * 2 ** (attempt - 1)) + jitter` for at most `GEMINI_MAX_ATTEMPTS`. Stop immediately on authentication, permission, quota-exhaustion, and content rejection.

- [ ] **Step 4: Implement the official SDK transport**

Construct `GoogleGenAI` only in the worker composition root. Call:

```ts
client.models.generateContent({
  model: request.model,
  contents: [{ role: 'user', parts: request.parts }],
  config: {
    systemInstruction: request.systemInstruction,
    responseMimeType: 'application/json',
    responseJsonSchema: request.responseJsonSchema,
  },
})
```

Parse `response.text` as JSON, map usage metadata, and use only sanitized status/category messages. Do not log the request parts, raw response, or client configuration.

- [ ] **Step 5: Verify GREEN and commit**

Run: `cd backend && npm test -- test/unit/gemini-ai-model-client.test.ts && npm run build`  
Expected: adapter tests and build pass.

```bash
git add backend/src/modules/ai backend/test/unit/gemini-ai-model-client.test.ts
git commit -m "feat: add resilient Gemini structured output client"
```

### Task 4: Add atomic AI-job and decision repository operations

**Files:**
- Modify: `backend/src/modules/scan-runs/application/ports.ts`
- Modify: `backend/src/modules/scan-runs/infrastructure/prisma-scan-repository.ts`
- Create: `backend/test/integration/document-filter-repository.test.ts`

**Interfaces:**
- Produces: repository methods used by the filter and retry services.

```ts
getOrCreateDocumentFilterJob(runId: string, configuration: FilterConfiguration): Promise<AiJobRecord>
listFilterDocuments(runId: string): Promise<FilterDocumentRecord[]>
startAiCall(input: StartAiCallInput): Promise<AiCallRecord>
completeAiCall(callId: string, result: AiCallCompletion): Promise<void>
failAiCall(callId: string, error: AiProviderError): Promise<void>
saveTitleDecisions(jobId: string, decisions: TitleDecision[]): Promise<void>
saveContentDecisions(jobId: string, batchKey: string, decisions: ContentDecision[]): Promise<void>
getFilterProgress(jobId: string): Promise<FilterProgress>
markFilterRunning(runId: string, jobId: string, totalItems: number): Promise<void>
markFilterAwaitingRetry(runId: string, jobId: string, error: AiProviderError): Promise<void>
completeFilter(runId: string, jobId: string): Promise<void>
```

Define the neighboring types in `ports.ts` with these shapes so later tasks do not depend on Prisma-generated objects:

```ts
export interface FilterConfiguration {
  model: string
  titlePromptVersion: string
  contentPromptVersion: string
  configurationHash: string
}

export interface AiJobRecord {
  id: string
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'AWAITING_RETRY' | 'FAILED'
  configuration: FilterConfiguration
}

export interface FilterDocumentRecord {
  id: string
  title: string
  sourceUrl: string
  publicationOrder: number
  storedObject: null | { objectKey: string; sha256: string; mediaType: string; byteSize: bigint }
}

export interface TitleDecision {
  documentId: string
  decision: 'IN' | 'OUT' | 'MAYBE'
  reason: string
  confidence: number
}

export interface ContentDecision {
  documentId: string
  decision: 'IN' | 'OUT'
  reason: string
  confidence: number
}

export interface StartAiCallInput {
  aiJobId: string
  phase: 'TITLE' | 'CONTENT'
  batchKey: string
  attemptNo: number
  inputHash: string
}

export interface AiCallRecord { id: string }

export interface AiCallCompletion {
  providerRequestId: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number
}

export interface FilterProgress {
  titlePassComplete: boolean
  unresolvedDocumentIds: string[]
  completedContentBatchKeys: string[]
  finalCounts: { in: number; out: number; pending: number }
}
```

- [ ] **Step 1: Write failing integration tests**

Create a run and two documents, then verify:

- title decisions are all-or-nothing;
- direct `IN`/`OUT` populate `finalDecision` immediately;
- `MAYBE` leaves `finalDecision` null;
- content decisions fill only previously `MAYBE` rows;
- completed content `batchKey` values are returned for resume;
- no repository DTO exposes confidence even though Prisma rows contain it.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd backend && DATABASE_URL='postgresql://atez:atezpassword@localhost:5432/atez_db?schema=public' npm test -- test/integration/document-filter-repository.test.ts`  
Expected: FAIL because repository methods are absent.

- [ ] **Step 3: Implement repository transactions**

Use one Prisma transaction per validated response. `saveTitleDecisions` must upsert every row and update `StageExecution.completedItems` from the count of non-null final decisions, never by blind increment. `saveContentDecisions` must reject any document whose persisted title decision is not `MAYBE`.

Return stored-object metadata from `listFilterDocuments` so subsequent tasks can avoid repeated official downloads.

- [ ] **Step 4: Verify GREEN and commit**

Run the selected integration test and `npm run build`; both must pass.

```bash
git add backend/src/modules/scan-runs/application/ports.ts backend/src/modules/scan-runs/infrastructure/prisma-scan-repository.ts backend/test/integration/document-filter-repository.test.ts
git commit -m "feat: persist resumable AI filter decisions"
```

### Task 5: Implement content normalization, object reuse, and the two-pass filter service

**Files:**
- Create: `backend/src/modules/scan-runs/application/normalize-document-content.ts`
- Create: `backend/src/modules/scan-runs/application/execute-document-filter.ts`
- Modify: `backend/src/modules/scan-runs/application/ports.ts`
- Modify: `backend/src/modules/scan-runs/infrastructure/s3-object-store.ts`
- Create: `backend/test/unit/normalize-document-content.test.ts`
- Create: `backend/test/integration/execute-document-filter.test.ts`

**Interfaces:**
- Consumes: prompt builders, schemas, `AiModelClient`, repository methods, `OfficialHttp`, and `ObjectStore`.
- Produces: `executeDocumentFilter(runId, dependencies): Promise<void>`.
- Produces: `ObjectStore.getContent(objectKey: string): Promise<Buffer>`.

- [ ] **Step 1: Write failing normalization tests**

Verify that HTML removes script/style/navigation noise but retains headings, paragraphs, lists, and table cells in source order. Verify that PDF input becomes an `inlineData` part with its real MIME type and base64 bytes. Verify unsupported media returns `CONTENT_REJECTED` rather than silently guessing.

- [ ] **Step 2: Write failing two-pass service tests**

Cover two flows:

```ts
it('classifies all titles once and completes when there is no MAYBE')
it('downloads MAYBE content, resolves it to IN or OUT, and persists confidence without exposing it')
```

Assert exact AI call counts, stable IDs, final decisions, stored document objects, deterministic content batch keys, and absence of a second content call on resume for a completed batch.

- [ ] **Step 3: Run tests and verify RED**

Run: `cd backend && npm test -- test/unit/normalize-document-content.test.ts test/integration/execute-document-filter.test.ts`  
Expected: FAIL because the service and normalizer are absent.

- [ ] **Step 4: Implement archived-object reads**

Add `S3ObjectStore.getContent` using `GetObjectCommand` and collect the response body with `transformToByteArray()`. Enforce the existing maximum file size before returning a buffer.

- [ ] **Step 5: Implement deterministic content parts and batching**

For HTML, produce one text section per document delimited by its internal ID and title. For supported binary documents, produce a metadata text part followed by `inlineData`. Build batches in publication order and never exceed `GEMINI_MAX_CONTENT_BYTES`. Calculate `batchKey` as SHA-256 over ordered document IDs and their stored-object hashes.

- [ ] **Step 6: Implement `executeDocumentFilter`**

The service must:

1. get/create the filter job and mark the stage running;
2. skip the title call when validated title decisions already exist;
3. send all titles in one call otherwise;
4. download and archive only unresolved `MAYBE` documents at this point;
5. reuse an existing stored object from MinIO when present;
6. skip completed content batches;
7. validate and persist each batch atomically;
8. mark the filter complete only when every document has final `IN` or `OUT`.

On `AiProviderError`, persist the call error, move job/run/stage to `AWAITING_RETRY`, and throw `AiFilterAwaitingRetryError` so the worker can acknowledge the queue item without converting the run to generic `FAILED`.

Define that control-flow error in the same service module without embedding provider details:

```ts
export class AiFilterAwaitingRetryError extends Error {
  override readonly name = 'AiFilterAwaitingRetryError'
  constructor(readonly runId: string) {
    super(`AI filtering awaits retry for scan run ${runId}`)
  }
}
```

- [ ] **Step 7: Verify GREEN and commit**

Run selected tests and `npm run build`; both must pass.

```bash
git add backend/src/modules/scan-runs/application/normalize-document-content.ts backend/src/modules/scan-runs/application/execute-document-filter.ts backend/src/modules/scan-runs/application/ports.ts backend/src/modules/scan-runs/infrastructure/s3-object-store.ts backend/test/unit/normalize-document-content.test.ts backend/test/integration/execute-document-filter.test.ts
git commit -m "feat: classify documents with a two-pass AI filter"
```

### Task 6: Integrate filtering into scan execution and make retry commands reliable

**Files:**
- Modify: `backend/src/modules/scan-runs/application/execute-scan-run.ts`
- Modify: `backend/src/modules/scan-runs/application/ports.ts`
- Modify: `backend/src/modules/scan-runs/infrastructure/prisma-scan-repository.ts`
- Modify: `backend/src/modules/scan-runs/infrastructure/scan-run-queue.ts`
- Modify: `backend/src/modules/scan-runs/scan-runs.schemas.ts`
- Modify: `backend/src/modules/scan-runs/scan-runs.routes.ts`
- Modify: `backend/src/platform/queue.ts`
- Modify: `backend/src/worker.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/test/integration/execute-scan-run.test.ts`
- Modify: `backend/test/contract/scan-runs.routes.test.ts`

**Interfaces:**
- Produces: `ScanCommand = { outboxId: string; runId: string; type: 'START_SCAN' | 'RETRY_AI_FILTER' }`.
- Produces: `POST /api/v1/scan-runs/:runId/ai-filter/retry`.
- Produces: `executeScanRun(runId, dependencies, resumeFrom?: 'AI_FILTERING')`.

- [ ] **Step 1: Write failing orchestration tests**

Extend the integration test to assert stage order, one filter execution before document downloading, all `OUT` documents still stored, and an early-downloaded `MAYBE` document read from MinIO rather than fetched again from the official source.

Add a failure/resume test: fake Gemini fails during a later content batch, the run becomes `AWAITING_RETRY`, a retry resumes only the unfinished batch, and the same run reaches `COMPLETED`.

- [ ] **Step 2: Write failing retry contract tests**

Assert:

- retry on a non-paused run returns `409`;
- missing/invalid `Idempotency-Key` returns `400`;
- first valid retry returns `202` and creates one `RETRY_AI_FILTER` outbox row;
- repeating the same key returns the same command and creates no duplicate;
- a different key while already queued returns `409`.

- [ ] **Step 3: Run tests and verify RED**

Run: `cd backend && DATABASE_URL='postgresql://atez:atezpassword@localhost:5432/atez_db?schema=public' npm test -- test/integration/execute-scan-run.test.ts test/contract/scan-runs.routes.test.ts`  
Expected: FAIL on missing stage and endpoint.

- [ ] **Step 4: Refactor the outbox and queue payload**

`createManualRun` creates `START_SCAN`; retry creates `RETRY_AI_FILTER`. Dispatch with:

```ts
scanQueue.enqueue({ outboxId: row.id, runId: row.scanRunId, type: row.commandType })
```

Use `outboxId` as pg-boss `singletonKey`, not `runId`, so a later retry for the same run can enqueue exactly once.

- [ ] **Step 5: Add idempotent retry state transition**

In one transaction verify `ScanRun.status`, `currentStage`, and `AiJob.status` are `AWAITING_RETRY`; create or return the retry outbox command by request key; transition job/run to `QUEUED`; clear only the displayed last error. Do not delete calls, decisions, objects, editions, or completed stages.

- [ ] **Step 6: Integrate the second stage and resume path**

Call `executeDocumentFilter` after `DISCOVERING`. Extract the post-filter document/archive/asset/manifest sequence into a private function used by both normal and retry commands. Materialize already stored documents from MinIO into the run temp directory so asset discovery works without another official-source request.

Catch `AiFilterAwaitingRetryError` separately and return normally from the worker handler. Other errors retain the existing `PARTIAL`/`FAILED` behavior.

- [ ] **Step 7: Wire dependencies in the worker and API**

Construct the Gemini adapter with server-side env configuration. If the key is absent, inject a client that throws sanitized `AUTHENTICATION: Gemini API anahtarı yapılandırılmamış`. Pass a retry command service/queue dependency into `buildApp`; contract tests inject a fake so they do not start pg-boss.

- [ ] **Step 8: Verify GREEN and commit**

Run selected tests and backend build.

```bash
git add backend/src/modules/scan-runs backend/src/platform/queue.ts backend/src/worker.ts backend/src/app.ts backend/test/integration/execute-scan-run.test.ts backend/test/contract/scan-runs.routes.test.ts
git commit -m "feat: resume paused AI filters through the scan queue"
```

### Task 7: Expose safe filter results and include audit data in the manifest

**Files:**
- Modify: `backend/src/modules/scan-runs/application/ports.ts`
- Modify: `backend/src/modules/scan-runs/infrastructure/prisma-scan-repository.ts`
- Modify: `backend/src/modules/scan-runs/application/build-manifest.ts`
- Modify: `backend/src/modules/scan-runs/scan-runs.routes.ts`
- Modify: `backend/test/unit/build-manifest.test.ts`
- Modify: `backend/test/contract/scan-runs.routes.test.ts`

**Interfaces:**
- Produces safe `ScanRunDetailDto.filter` and `document.filter` objects without confidence.
- Produces manifest filter audit fields with confidence, prompt versions, configuration hash, and model.

- [ ] **Step 1: Write failing DTO redaction tests**

Assert the run detail response contains:

```ts
filter: {
  status: 'COMPLETED', counts: { in: 1, out: 2, pending: 0 },
  retryAvailable: false, errorCategory: null, errorMessage: null,
}
```

Each document returns `{ titleDecision, finalDecision, reason }`. Recursively stringify the response and assert it does not contain `confidence`, `titleConfidence`, or `contentConfidence`.

- [ ] **Step 2: Write a failing manifest test**

Expect `schemaVersion: 2` and, for each document:

```json
{
  "filter": {
    "titleDecision": "MAYBE",
    "titleReason": "Başlık tek başına dış ticaret bağını kesinleştirmiyor.",
    "titleConfidence": 0.63,
    "contentDecision": "IN",
    "contentReason": "Belge ithal ürünler için uygunluk denetimi getiriyor.",
    "contentConfidence": 0.91,
    "finalDecision": "IN",
    "model": "gemini-3.8-flash",
    "titlePromptVersion": "document-filter-title-v1",
    "contentPromptVersion": "document-filter-content-v1",
    "configurationHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
}
```

- [ ] **Step 3: Run tests and verify RED**

Run the two selected test files; expect missing filter fields.

- [ ] **Step 4: Implement separate public and manifest mappings**

Build public DTOs with an explicit field allowlist so confidence cannot leak from Prisma objects. Build manifest snapshots with the complete audit fields. Use the final decision reason: content reason after a title `MAYBE`, otherwise title reason.

- [ ] **Step 5: Verify GREEN and commit**

Run selected tests and backend build.

```bash
git add backend/src/modules/scan-runs/application/ports.ts backend/src/modules/scan-runs/infrastructure/prisma-scan-repository.ts backend/src/modules/scan-runs/application/build-manifest.ts backend/src/modules/scan-runs/scan-runs.routes.ts backend/test/unit/build-manifest.test.ts backend/test/contract/scan-runs.routes.test.ts
git commit -m "feat: expose safe filter results and manifest audit"
```

### Task 8: Build the AI-filter operation UI and manual retry interaction

**Files:**
- Modify: `frontend/src/features/scans/types.ts`
- Modify: `frontend/src/features/scans/api.ts`
- Modify: `frontend/src/features/scans/useScanRun.ts`
- Modify: `frontend/src/features/runs/OperationSteps.tsx`
- Modify: `frontend/src/features/runs/CollectedDocuments.tsx`
- Modify: `frontend/src/features/runs/RunDetail.tsx`
- Modify: `frontend/src/features/dashboard/RecentScanRuns.tsx`
- Modify: `frontend/src/features/runs/RunDetail.test.tsx`
- Modify: `frontend/src/features/dashboard/Dashboard.test.tsx`

**Interfaces:**
- Consumes: safe run-detail filter DTO and retry endpoint from Tasks 6–7.
- Produces: visible second operation step, final document labels/reasons, diagnosis, and `Tekrar Dene` action.

- [ ] **Step 1: Write failing UI tests**

Add tests that render an `AWAITING_RETRY` run and assert:

- `2. Belgeler yapay zekâ ile filtreleniyor` is visible;
- a Turkish diagnosis such as `Gemini geçici olarak yoğun` is visible;
- `Tekrar Dene` is visible and confidence text/value is absent;
- clicking once sends one POST with an `Idempotency-Key`, disables the button, refreshes the run, and reopens live updates;
- an `IN` document shows `İlgili`, an `OUT` document shows `İlgisiz`, and both show their short reason;
- the overview count uses `run.filter.counts.in`, not stage `completedItems`;
- the dashboard labels `AWAITING_RETRY` as `AI filtresi bekliyor`.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd frontend && npm test -- src/features/runs/RunDetail.test.tsx src/features/dashboard/Dashboard.test.tsx`  
Expected: FAIL because new types and UI are absent.

- [ ] **Step 3: Add safe frontend types and retry API**

Add `AI_FILTERING`, `AWAITING_RETRY`, filter counts/error fields, and document decisions. Implement:

```ts
export async function retryAiFilter(runId: string): Promise<{ runId: string; status: ScanRunStatus }> {
  const response = await fetch(`/api/v1/scan-runs/${runId}/ai-filter/retry`, {
    method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
  if (!response.ok) {
    throw new ScanApiError(response.status, await readError(response, 'AI filtresi yeniden başlatılamadı'))
  }
  return response.json() as Promise<{ runId: string; status: ScanRunStatus }>
}
```

Use the module's existing `ScanApiError` behavior rather than raw browser error strings.

- [ ] **Step 4: Make live updates restartable**

Add a connection generation counter to `useScanRun`. Expose `refreshAndReconnect()` that loads the accepted retry state and increments the counter; include it in the SSE effect dependency list. Add `AWAITING_RETRY` to stable/terminal statuses so idle SSE and polling stop until the user retries.

- [ ] **Step 5: Implement the operation and document presentation**

Insert `AI_FILTERING` as the second `steps` item. For `AWAITING_RETRY`, render the sanitized error message inside that row with an amber action panel. Keep the button local state `idle | submitting`; on success call `refreshAndReconnect`, and on failure display `ScanApiError.message` without hiding the original diagnosis.

Render decision badges and reasons in `CollectedDocuments`. Do not add any confidence property to frontend types.

- [ ] **Step 6: Verify GREEN and commit**

Run selected frontend tests, `npm run lint`, and `npm run build`.

```bash
git add frontend/src/features/scans frontend/src/features/runs frontend/src/features/dashboard/RecentScanRuns.tsx frontend/src/features/dashboard/Dashboard.test.tsx
git commit -m "feat: show and retry the AI filter stage"
```

### Task 9: Configure Docker, run the complete suite, and perform the authorized Gemini smoke test

**Files:**
- Modify: `docker-compose.yml`
- Modify: `backend/test/acceptance/manual-scan.test.ts`
- Modify: `.env.example` — document Gemini settings with an empty example key; never add a real key.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: reproducible local deployment and verified real-provider behavior.

- [ ] **Step 1: Add a failing acceptance test with fake Gemini**

Run a fixture scan containing title `IN`, `OUT`, and `MAYBE`; resolve the ambiguous document from content. Assert the run completes, all documents/assets are archived, only final decisions remain, and the public result contains no confidence.

- [ ] **Step 2: Run the acceptance test and verify RED, then implement only missing wiring**

Run: `cd backend && npm test -- test/acceptance/manual-scan.test.ts`  
Expected before wiring: FAIL on the missing filter dependency or result. Add the fake provider to the acceptance composition and run again until PASS.

- [ ] **Step 3: Pass Gemini settings only to server containers**

Add to the shared backend/worker environment:

```yaml
GEMINI_API_KEY: ${GEMINI_API_KEY:-}
GEMINI_MODEL: ${GEMINI_MODEL:-gemini-3.8-flash}
GEMINI_TIMEOUT_MS: ${GEMINI_TIMEOUT_MS:-30000}
GEMINI_MAX_ATTEMPTS: ${GEMINI_MAX_ATTEMPTS:-3}
GEMINI_MAX_CONTENT_BYTES: ${GEMINI_MAX_CONTENT_BYTES:-8000000}
```

Do not add any Gemini variable to the `web` service or Docker build arguments.

Add the same variable names to `.env.example` with `GEMINI_API_KEY=` left empty and the four non-secret defaults shown above.

- [ ] **Step 4: Run fresh full verification**

Backend:

```bash
cd backend
DATABASE_URL='postgresql://atez:atezpassword@localhost:5432/atez_db?schema=public' \
S3_ENDPOINT='http://localhost:9000' S3_REGION='eu-central-1' \
S3_BUCKET='resmi-gazete-test' S3_ACCESS_KEY_ID='atez-local-access' \
S3_SECRET_ACCESS_KEY='atez-local-secret-change-me' npm test
npm run build
```

Frontend:

```bash
cd frontend
npm test
npm run lint
npm run build
```

Expected: zero failed tests, zero lint errors, and both builds exit 0. Existing unrelated lint warnings may be reported separately but must not be attributed to this feature.

- [ ] **Step 5: Commit deployment wiring**

```bash
git add docker-compose.yml backend/test/acceptance/manual-scan.test.ts .env.example
git commit -m "build: configure Gemini document filtering"
```

- [ ] **Step 6: Request the API key only for the live test**

Have the user place `GEMINI_API_KEY=<secret>` in the untracked root `.env`, or enter it through their local secret mechanism. Never ask them to commit or paste it into source code, test snapshots, terminal history, or chat logs.

- [ ] **Step 7: Rebuild and run a real scan**

```bash
docker compose up -d --build
curl --fail http://localhost:8888/api/health
```

Create a manual run for a known fixture date through the UI. Verify from the public run endpoint and UI that title decisions exist, every `MAYBE` has final `IN`/`OUT`, all documents remain archived, confidence is absent, and the manifest contains the full audit record.

- [ ] **Step 8: Exercise a diagnosable retry without exposing the key**

Temporarily use an invalid key through the local untracked environment, start a disposable scan, and verify `AUTHENTICATION` plus `Tekrar Dene`. Restore the valid local key, restart only backend/worker, click retry, and verify the same run resumes and completes without repeating discovery or already stored downloads.

- [ ] **Step 9: Final repository and runtime checks**

Run:

```bash
git diff --check
git status --short
docker compose ps
```

Expected: only explicitly preserved user changes remain unstaged; backend, database, object storage, worker, and web are running, with health checks ready where defined.
