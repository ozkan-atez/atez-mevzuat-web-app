# Run-Scoped Workflow Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every manual and scheduled Resmî Gazete scan complete through one reliable run-scoped pipeline, require Gemini schema-constrained JSON, and keep backend/frontend status and detail views truthful.

**Architecture:** Keep `GazetteIssue`, `SourceDocument`, and downloaded artifacts canonical, while introducing run-owned issue/document executions and run-scoped step idempotency. Route all triggers through the existing transactional outbox, expose JSON-safe DTOs through query services, and let React render explicit API and workflow states instead of inferring them from legacy JSON.

**Tech Stack:** Node.js 22, TypeScript, Fastify 5, Prisma 5/PostgreSQL 15, pg-boss 12, `@google/generative-ai` 0.24, Zod 4, React 19, Axios, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-11-run-scoped-workflow-reliability-design.md`

## Global Constraints

- Scheduler timezone remains exactly `Europe/Istanbul` with slots `04:00`, `09:00`, `14:00`, and `22:00`.
- Manual and scheduled requests share the transactional outbox and `workflow-run` worker path.
- A later run must never rewrite or detach an earlier run's issue, document execution, assessment, report, or mail-draft history.
- Canonical source bytes may be reused by content hash; workflow decisions and step executions remain run-scoped.
- A terminal document failure must cause the owning run to reach a terminal, non-success state.
- Gemini receives a provider-level `responseSchema`, and every response is independently parsed by Zod.
- Invalid AI output never becomes a mock or fallback business result.
- API routes return DTOs, never raw Prisma objects containing `BigInt`.
- Existing data and user-owned working-tree changes are preserved; migrations are additive.
- Every behavior change follows a failing-test-first cycle.

---

## File Structure Map

### Backend domain and persistence

- `backend/prisma/schema.prisma`: add `RunIssueExecution` and `RunDocumentExecution`; attach steps, assessments, reports, and drafts to run execution ownership.
- `backend/prisma/migrations/20260911190000_run_scoped_pipeline/migration.sql`: additive schema, constraints, indexes, and safe backfill.
- `backend/src/modules/document-pipeline/domain/run-execution.types.ts`: run-execution statuses and claim outcomes.
- `backend/src/modules/document-pipeline/domain/document.policy.ts`: run-scoped step key and terminal status policies.
- `backend/src/modules/document-pipeline/ports/document-pipeline.repository.port.ts`: run-execution repository contracts.
- `backend/src/modules/document-pipeline/ports/workflow-queue.port.ts`: run-aware queue payload.
- `backend/src/modules/document-pipeline/infrastructure/prisma-document.repository.ts`: transactional canonical/run execution persistence and claim/finalization behavior.

### Backend AI and application

- `backend/src/modules/ai/gemini.service.ts`: provider-level structured-output call.
- `backend/src/modules/document-pipeline/domain/gemini-response.schemas.ts`: Gemini provider schemas corresponding to Zod contracts.
- `backend/src/modules/document-pipeline/infrastructure/gemini-document-ai.adapter.ts`: select classification/report schema and normalize invalid-output errors.
- `backend/src/modules/document-pipeline/application/discover-gazette-issue.use-case.ts`: create canonical issue plus run-owned executions.
- `backend/src/modules/document-pipeline/application/pipeline-coordinator.ts`: propagate execution IDs and handle claim outcomes explicitly.
- `backend/src/modules/document-pipeline/application/recalculate-run-status.use-case.ts`: derive terminal run status from run-owned documents.
- `backend/src/modules/document-pipeline/infrastructure/persistent-step-queue.adapter.ts`: run-scoped singleton keys.
- `backend/src/worker.ts` and `backend/src/bootstrap.ts`: wire finalization and failure recalculation.

### Backend delivery

- `backend/src/modules/runs/run-query.service.ts`: JSON-safe list/detail DTOs.
- `backend/src/modules/runs/run.dto.ts`: public run contracts and serializers.
- `backend/src/modules/runs/runs.routes.ts`: query service delegation and protected mutation.
- `backend/src/modules/document-pipeline/pipeline-query.service.ts`: run-scoped, JSON-safe pipeline DTO.
- `backend/src/modules/document-pipeline/document-pipeline.routes.ts`: query service delegation and run-aware retry.
- `backend/src/modules/stats/stats.routes.ts`: dynamic trigger/status breakdown.
- `backend/src/app.ts` and `backend/src/bootstrap.ts`: inject query/application services.

### Frontend

- `frontend/src/lib/api.ts`: typed runs, pipeline, stats, and error helpers.
- `frontend/src/features/dashboard/dashboard.types.ts`: dashboard DTO contracts.
- `frontend/src/features/dashboard/Dashboard.tsx`: source/status/KPI rendering from DTOs.
- `frontend/src/features/runs/run-detail.types.ts`: run detail contracts and view state.
- `frontend/src/features/runs/RunDetail.tsx`: distinct loading, empty, not-found, server-error, running, and terminal views.
- `frontend/src/features/runs/document-pipeline.types.ts`: run-execution IDs, safe byte strings, and step error fields.

---

### Task 1: Add run-scoped domain identities and additive persistence

**Files:**
- Create: `backend/src/modules/document-pipeline/domain/run-execution.types.ts`
- Modify: `backend/src/modules/document-pipeline/domain/document.types.ts`
- Modify: `backend/src/modules/document-pipeline/domain/document.policy.ts`
- Test: `backend/src/modules/document-pipeline/domain/document.policy.test.ts`
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260911190000_run_scoped_pipeline/migration.sql`

**Interfaces:**
- Produces: `StepClaimOutcome = 'CLAIMED' | 'ALREADY_COMPLETED' | 'IN_PROGRESS'`.
- Produces: `RunExecutionStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED'`.
- Replaces: `buildStepKey(input)` with run-aware input `{ runId, runDocumentExecutionId, step, inputHash, version }`.
- Produces database relations `WorkflowRun.runIssues`, `RunIssueExecution.documents`, `RunDocumentExecution.steps`.

- [ ] **Step 1: Write failing run-scoped key and final status tests**

```ts
test('same document and input in different runs have different step keys', () => {
  const shared = { runDocumentExecutionId: 'rde-1', step: 'CLASSIFY' as const, inputHash: 'abc', version: 'filter-v2' };
  assert.notEqual(
    buildStepKey({ ...shared, runId: 'run-1' }),
    buildStepKey({ ...shared, runId: 'run-2' }),
  );
});

test('terminal document failure completes the run with errors', () => {
  assert.equal(finalizeRunStatus(['COMPLETED', 'FAILED_FINAL']), 'COMPLETED_WITH_ERRORS');
});
```

- [ ] **Step 2: Run the domain test and verify RED**

Run: `cd backend && npx tsx --test src/modules/document-pipeline/domain/document.policy.test.ts`

Expected: FAIL because `runId`, `runDocumentExecutionId`, and `finalizeRunStatus` do not exist.

- [ ] **Step 3: Implement the run-scoped value types and pure policies**

```ts
export type StepClaimOutcome = 'CLAIMED' | 'ALREADY_COMPLETED' | 'IN_PROGRESS';
export type RunExecutionStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED';

export function buildStepKey(input: RunStepKeyInput): string {
  return [input.runId, input.runDocumentExecutionId, input.step, input.inputHash, input.version].join(':');
}

export function finalizeRunStatus(statuses: readonly DocumentStatus[]): RunExecutionStatus | null {
  if (statuses.length === 0 || statuses.some((status) => !terminalStatuses.has(status))) return null;
  return statuses.includes('FAILED_FINAL') ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
}
```

- [ ] **Step 4: Run the domain test and verify GREEN**

Run: `cd backend && npx tsx --test src/modules/document-pipeline/domain/document.policy.test.ts`

Expected: PASS.

- [ ] **Step 5: Add Prisma models and explicit ownership**

```prisma
model RunIssueExecution {
  id         String                 @id @default(uuid())
  runId      String
  run        WorkflowRun            @relation(fields: [runId], references: [id], onDelete: Cascade)
  issueId    String
  issue      GazetteIssue           @relation(fields: [issueId], references: [id], onDelete: Restrict)
  status     String                 @default("RUNNING")
  summary    String?
  error      String?
  documents  RunDocumentExecution[]
  startedAt  DateTime               @default(now())
  finishedAt DateTime?
  createdAt  DateTime               @default(now())
  updatedAt  DateTime               @updatedAt

  @@unique([runId, issueId])
  @@index([runId, status])
}

model RunDocumentExecution {
  id                  String                  @id @default(uuid())
  runIssueExecutionId String
  runIssueExecution   RunIssueExecution       @relation(fields: [runIssueExecutionId], references: [id], onDelete: Cascade)
  documentId          String
  document            SourceDocument          @relation(fields: [documentId], references: [id], onDelete: Restrict)
  status              String                  @default("DISCOVERED")
  inputHash           String
  steps               WorkflowStepExecution[]
  createdAt           DateTime                @default(now())
  updatedAt           DateTime                @updatedAt

  @@unique([runIssueExecutionId, documentId])
  @@index([runIssueExecutionId, status])
}
```

Add nullable `runDocumentExecutionId` to `WorkflowStepExecution`, `DocumentAssessment`, and `Report`, preserving current foreign keys during backfill.

- [ ] **Step 6: Write and inspect the additive SQL migration**

The migration creates both tables, adds nullable ownership columns, inserts one `RunIssueExecution` per existing non-null `GazetteIssue.runId`, inserts run-document rows for those issues, and links existing steps/assessments/reports by document. It does not drop `GazetteIssue.runId` or delete rows.

Run: `cd backend && npx prisma validate && npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`

Expected: generated diff contains only additions, indexes, foreign keys, and backfill-compatible alterations.

- [ ] **Step 7: Apply migration to a disposable/test database and verify constraints**

Run: `cd backend && npx prisma migrate deploy && npx prisma validate && npm run build`

Expected: migration succeeds, Prisma validates, TypeScript builds.

- [ ] **Step 8: Commit the domain and schema slice**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260911190000_run_scoped_pipeline/migration.sql backend/src/modules/document-pipeline/domain/run-execution.types.ts backend/src/modules/document-pipeline/domain/document.types.ts backend/src/modules/document-pipeline/domain/document.policy.ts backend/src/modules/document-pipeline/domain/document.policy.test.ts
git commit -m "feat: add run-scoped pipeline executions"
```

---

### Task 2: Make discovery, queue jobs, and step claims run-scoped

**Files:**
- Modify: `backend/src/modules/document-pipeline/ports/workflow-queue.port.ts`
- Modify: `backend/src/modules/document-pipeline/ports/document-pipeline.repository.port.ts`
- Modify: `backend/src/modules/document-pipeline/application/discover-gazette-issue.use-case.ts`
- Test: `backend/src/modules/document-pipeline/application/discover-gazette-issue.use-case.test.ts`
- Modify: `backend/src/modules/document-pipeline/application/pipeline-coordinator.ts`
- Test: `backend/src/modules/document-pipeline/application/pipeline-coordinator.test.ts`
- Modify: `backend/src/modules/document-pipeline/application/acquire-document-package.use-case.ts`
- Test: `backend/src/modules/document-pipeline/application/acquire-document-package.use-case.test.ts`
- Modify: `backend/src/modules/document-pipeline/application/extract-document-content.use-case.ts`
- Test: `backend/src/modules/document-pipeline/application/extract-document-content.use-case.test.ts`
- Modify: `backend/src/modules/document-pipeline/application/assess-document-relevance.use-case.ts`
- Test: `backend/src/modules/document-pipeline/application/assess-document-relevance.use-case.test.ts`
- Modify: `backend/src/modules/document-pipeline/application/resolve-previous-version.use-case.ts`
- Test: `backend/src/modules/document-pipeline/application/resolve-previous-version.use-case.test.ts`
- Modify: `backend/src/modules/document-pipeline/application/generate-document-report.use-case.ts`
- Test: `backend/src/modules/document-pipeline/application/generate-document-report.use-case.test.ts`
- Modify: `backend/src/modules/document-pipeline/application/create-document-mail-draft.use-case.ts`
- Test: `backend/src/modules/document-pipeline/application/create-document-mail-draft.use-case.test.ts`
- Modify: `backend/src/modules/document-pipeline/infrastructure/prisma-document.repository.ts`
- Test: `backend/src/modules/document-pipeline/infrastructure/prisma-document.repository.test.ts`
- Modify: `backend/src/modules/document-pipeline/infrastructure/persistent-step-queue.adapter.ts`

**Interfaces:**
- `DocumentStepJob` gains `runId`, `runIssueExecutionId`, and `runDocumentExecutionId`.
- `saveDiscoveredIssue(input)` returns canonical `issueId`, `runIssueExecutionId`, and document execution records.
- `claimStep(job)` returns `{ outcome: StepClaimOutcome }`.
- Every application use case reads/writes status through `runDocumentExecutionId`; `SourceDocument` remains canonical content metadata.
- Assessment keys become `{runDocumentExecutionId}:{inputHash}:{promptVersion}`; report uniqueness becomes `(runDocumentExecutionId, version)`.

- [ ] **Step 1: Write a failing discovery isolation test**

```ts
test('creates independent document executions for two runs sharing one canonical issue', async () => {
  const first = await useCase.execute({ publicationDate: '2026-09-11', variant: 'DAILY', runId: 'run-1' });
  const second = await useCase.execute({ publicationDate: '2026-09-11', variant: 'DAILY', runId: 'run-2' });
  assert.equal(first.issueId, second.issueId);
  assert.notEqual(first.runIssueExecutionId, second.runIssueExecutionId);
  assert.notEqual(enqueued[0].runDocumentExecutionId, enqueued[1].runDocumentExecutionId);
});
```

- [ ] **Step 2: Run the discovery test and verify RED**

Run: `cd backend && npx tsx --test src/modules/document-pipeline/application/discover-gazette-issue.use-case.test.ts`

Expected: FAIL because discovery returns only `issueId` and document count.

- [ ] **Step 3: Update repository ports and discovery use case**

```ts
interface SavedRunIssue {
  issueId: string;
  runIssueExecutionId: string;
  documents: Array<{
    documentId: string;
    runDocumentExecutionId: string;
    inputHash: string;
  }>;
}
```

Upsert the canonical issue without changing `GazetteIssue.runId`; then upsert `(runId, issueId)` and `(runIssueExecutionId, documentId)` execution rows. Enqueue `ACQUIRE` with all run/execution IDs.

- [ ] **Step 4: Run the discovery test and verify GREEN**

Run: `cd backend && npx tsx --test src/modules/document-pipeline/application/discover-gazette-issue.use-case.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing coordinator claim-state tests**

```ts
test('does not treat FAILED_FINAL as already completed', async () => {
  repository.claimStep = async () => ({ outcome: 'CLAIMED' });
  await coordinator.handle(job);
  assert.equal(handlerCalls, 1);
});

test('returns without executing while another worker owns the lease', async () => {
  repository.claimStep = async () => ({ outcome: 'IN_PROGRESS' });
  await coordinator.handle(job);
  assert.equal(handlerCalls, 0);
});
```

- [ ] **Step 6: Run coordinator tests and verify RED**

Run: `cd backend && npx tsx --test src/modules/document-pipeline/application/pipeline-coordinator.test.ts`

Expected: FAIL because the repository still returns `alreadyCompleted`.

- [ ] **Step 7: Implement explicit claim outcomes and run-aware successor jobs**

```ts
const claim = await repository.claimStep(job);
if (claim.outcome === 'ALREADY_COMPLETED' || claim.outcome === 'IN_PROGRESS') return;
```

Preserve `runId`, `runIssueExecutionId`, and `runDocumentExecutionId` on every successor. Build each successor idempotency key from the run execution identity.

- [ ] **Step 8: Write failing Prisma claim tests for completed, leased, retryable, and final states**

Assert:

```ts
assert.deepEqual(await repository.claimStep(completedJob), { outcome: 'ALREADY_COMPLETED' });
assert.deepEqual(await repository.claimStep(activeLeaseJob), { outcome: 'IN_PROGRESS' });
assert.deepEqual(await repository.claimStep(retryableJob), { outcome: 'CLAIMED' });
assert.deepEqual(await repository.claimStep(finalJobWithNewVersion), { outcome: 'CLAIMED' });
```

- [ ] **Step 9: Run repository tests and verify RED**

Run: `cd backend && npx tsx --test src/modules/document-pipeline/infrastructure/prisma-document.repository.test.ts`

Expected: FAIL on old boolean claim behavior and missing run execution fields.

- [ ] **Step 10: Implement transactional execution upserts and lease-aware claims**

Only `COMPLETED` returns `ALREADY_COMPLETED`. A recent `RUNNING` row returns `IN_PROGRESS`; an expired `RUNNING` or `FAILED_RETRYABLE` row is atomically claimed and increments attempts. A `FAILED_FINAL` row requires a new version/key and is never silently accepted.

- [ ] **Step 11: Write failing use-case ownership tests**

For acquire, extract, classify, previous resolution, report generation, and draft creation, pass both `documentId` and `runDocumentExecutionId`. Assert status updates target the execution ID and that classification/report records include it:

```ts
assert.deepEqual(statusUpdates[0], {
  runDocumentExecutionId: 'rde-1',
  status: 'FILTERING',
});
assert.equal(savedAssessment.runDocumentExecutionId, 'rde-1');
assert.equal(savedReport.runDocumentExecutionId, 'rde-1');
```

- [ ] **Step 12: Run use-case tests and verify RED**

Run: `cd backend && npx tsx --test src/modules/document-pipeline/application/acquire-document-package.use-case.test.ts src/modules/document-pipeline/application/extract-document-content.use-case.test.ts src/modules/document-pipeline/application/assess-document-relevance.use-case.test.ts src/modules/document-pipeline/application/resolve-previous-version.use-case.test.ts src/modules/document-pipeline/application/generate-document-report.use-case.test.ts src/modules/document-pipeline/application/create-document-mail-draft.use-case.test.ts`

Expected: FAIL because current repositories update canonical `SourceDocument.status` and reports/assessments are document-global.

- [ ] **Step 13: Move workflow state and outputs to run execution ownership**

Change repository reads to join `RunDocumentExecution -> SourceDocument -> GazetteIssue`. Keep acquisition artefacts canonical and reusable, but persist every status on `RunDocumentExecution`. Build assessment keys from run execution identity and create reports with `runId`, `sourceDocumentId`, and `runDocumentExecutionId`. Replace the legacy `Report @@unique([sourceDocumentId, version])` constraint with `@@unique([runDocumentExecutionId, version])`; preserve the old columns for reads and migrate existing reports before applying the new constraint.

- [ ] **Step 14: Run focused tests and build**

Run: `cd backend && npx tsx --test src/modules/document-pipeline/application/discover-gazette-issue.use-case.test.ts src/modules/document-pipeline/application/pipeline-coordinator.test.ts src/modules/document-pipeline/application/acquire-document-package.use-case.test.ts src/modules/document-pipeline/application/extract-document-content.use-case.test.ts src/modules/document-pipeline/application/assess-document-relevance.use-case.test.ts src/modules/document-pipeline/application/resolve-previous-version.use-case.test.ts src/modules/document-pipeline/application/generate-document-report.use-case.test.ts src/modules/document-pipeline/application/create-document-mail-draft.use-case.test.ts src/modules/document-pipeline/infrastructure/prisma-document.repository.test.ts && npm run build`

Expected: PASS with no TypeScript errors.

- [ ] **Step 15: Commit run-scoped orchestration**

```bash
git add backend/src/modules/document-pipeline/ports/workflow-queue.port.ts backend/src/modules/document-pipeline/ports/document-pipeline.repository.port.ts backend/src/modules/document-pipeline/application/discover-gazette-issue.use-case.ts backend/src/modules/document-pipeline/application/discover-gazette-issue.use-case.test.ts backend/src/modules/document-pipeline/application/pipeline-coordinator.ts backend/src/modules/document-pipeline/application/pipeline-coordinator.test.ts backend/src/modules/document-pipeline/application/acquire-document-package.use-case.ts backend/src/modules/document-pipeline/application/acquire-document-package.use-case.test.ts backend/src/modules/document-pipeline/application/extract-document-content.use-case.ts backend/src/modules/document-pipeline/application/extract-document-content.use-case.test.ts backend/src/modules/document-pipeline/application/assess-document-relevance.use-case.ts backend/src/modules/document-pipeline/application/assess-document-relevance.use-case.test.ts backend/src/modules/document-pipeline/application/resolve-previous-version.use-case.ts backend/src/modules/document-pipeline/application/resolve-previous-version.use-case.test.ts backend/src/modules/document-pipeline/application/generate-document-report.use-case.ts backend/src/modules/document-pipeline/application/generate-document-report.use-case.test.ts backend/src/modules/document-pipeline/application/create-document-mail-draft.use-case.ts backend/src/modules/document-pipeline/application/create-document-mail-draft.use-case.test.ts backend/src/modules/document-pipeline/infrastructure/prisma-document.repository.ts backend/src/modules/document-pipeline/infrastructure/prisma-document.repository.test.ts backend/src/modules/document-pipeline/infrastructure/persistent-step-queue.adapter.ts
git commit -m "fix: isolate document work by workflow run"
```

---

### Task 3: Guarantee terminal run finalization on success and failure

**Files:**
- Create: `backend/src/modules/document-pipeline/application/recalculate-run-status.use-case.ts`
- Test: `backend/src/modules/document-pipeline/application/recalculate-run-status.use-case.test.ts`
- Modify: `backend/src/modules/document-pipeline/application/finalize-gazette-issue.use-case.ts`
- Modify: `backend/src/modules/document-pipeline/ports/document-pipeline.repository.port.ts`
- Modify: `backend/src/modules/document-pipeline/infrastructure/prisma-document.repository.ts`
- Modify: `backend/src/modules/document-pipeline/application/pipeline-coordinator.ts`
- Modify: `backend/src/bootstrap.ts`

**Interfaces:**
- Produces: `RecalculateRunStatus.execute(runId: string): Promise<RunExecutionStatus | null>`.
- Repository produces `getRunDocumentStatuses(runId)` and `finishRun(runId, status, summary)`.
- `failStep` returns whether the document became terminal.

- [ ] **Step 1: Write failing status-recalculation tests**

```ts
test('finishes a run after its final document reaches FAILED_FINAL', async () => {
  repository.statuses = ['EXCLUDED', 'FAILED_FINAL'];
  assert.equal(await useCase.execute('run-1'), 'COMPLETED_WITH_ERRORS');
  assert.equal(repository.finished?.status, 'COMPLETED_WITH_ERRORS');
});

test('keeps a run active while one document is retryable', async () => {
  repository.statuses = ['EXCLUDED', 'FAILED_RETRYABLE'];
  assert.equal(await useCase.execute('run-1'), null);
  assert.equal(repository.finished, null);
});
```

- [ ] **Step 2: Run status tests and verify RED**

Run: `cd backend && npx tsx --test src/modules/document-pipeline/application/recalculate-run-status.use-case.test.ts`

Expected: FAIL because the use case does not exist.

- [ ] **Step 3: Implement one run finalization use case**

The use case reads statuses through the port, applies `finalizeRunStatus`, and writes `finishedAt`, truthful summary, and either `COMPLETED`, `COMPLETED_WITH_ERRORS`, or `FAILED`. It is safe when called more than once.

- [ ] **Step 4: Invoke recalculation from both FINALIZE and terminal failure paths**

`FinalizeGazetteIssue` finalizes the run-document execution, not the canonical `SourceDocument`. `PipelineCoordinator` calls recalculation after a terminal `failStep`. Issue discovery failure continues to set run `FAILED` directly because no document execution may exist.

- [ ] **Step 5: Run status, coordinator, and repository tests**

Run: `cd backend && npx tsx --test src/modules/document-pipeline/application/recalculate-run-status.use-case.test.ts src/modules/document-pipeline/application/pipeline-coordinator.test.ts src/modules/document-pipeline/infrastructure/prisma-document.repository.test.ts`

Expected: PASS; no run remains active after all run-document executions are terminal.

- [ ] **Step 6: Commit finalization behavior**

```bash
git add backend/src/modules/document-pipeline/application/recalculate-run-status.use-case.ts backend/src/modules/document-pipeline/application/recalculate-run-status.use-case.test.ts backend/src/modules/document-pipeline/application/finalize-gazette-issue.use-case.ts backend/src/modules/document-pipeline/ports/document-pipeline.repository.port.ts backend/src/modules/document-pipeline/infrastructure/prisma-document.repository.ts backend/src/modules/document-pipeline/application/pipeline-coordinator.ts backend/src/bootstrap.ts
git commit -m "fix: finalize workflow runs from document outcomes"
```

---

### Task 4: Enforce Gemini provider schemas and validated errors

**Files:**
- Create: `backend/src/modules/document-pipeline/domain/gemini-response.schemas.ts`
- Test: `backend/src/modules/document-pipeline/domain/gemini-response.schemas.test.ts`
- Modify: `backend/src/modules/ai/gemini.service.ts`
- Test: `backend/src/modules/ai/gemini.service.test.ts`
- Modify: `backend/src/modules/document-pipeline/infrastructure/gemini-document-ai.adapter.ts`
- Test: `backend/src/modules/document-pipeline/infrastructure/gemini-document-ai.adapter.test.ts`
- Modify: `backend/src/modules/document-pipeline/application/pipeline-coordinator.ts`

**Interfaces:**
- Produces `assessmentResponseSchema` and `reportResponseSchema` using `SchemaType`/`ResponseSchema`.
- Produces `GeminiService.generateStructuredJSON<T>(input)`.
- Produces `AiInvalidStructuredOutputError` with code `AI_INVALID_STRUCTURED_OUTPUT`.

- [ ] **Step 1: Write failing provider-schema parity tests**

```ts
test('assessment provider schema requires every Zod field', () => {
  assert.deepEqual(assessmentResponseSchema.required?.sort(), [
    'confidence', 'decision', 'evidence', 'matchedTopics', 'reason',
  ]);
  assert.deepEqual(assessmentResponseSchema.properties?.decision.enum, ['IN', 'OUT', 'UNCERTAIN']);
});
```

- [ ] **Step 2: Run schema tests and verify RED**

Run: `cd backend && npx tsx --test src/modules/document-pipeline/domain/gemini-response.schemas.test.ts`

Expected: FAIL because provider schemas do not exist.

- [ ] **Step 3: Define exact Gemini response schemas**

```ts
export const assessmentResponseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    decision: { type: SchemaType.STRING, enum: ['IN', 'OUT', 'UNCERTAIN'] },
    confidence: { type: SchemaType.NUMBER },
    reason: { type: SchemaType.STRING },
    matchedTopics: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    evidence: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          artifactId: { type: SchemaType.STRING },
          page: { type: SchemaType.INTEGER, nullable: true },
          quote: { type: SchemaType.STRING },
        },
        required: ['artifactId', 'page', 'quote'],
      },
    },
  },
  required: ['decision', 'confidence', 'reason', 'matchedTopics', 'evidence'],
};
```

Define the complete report schema from `reportAnalysisSchema`, including nested identity, comparison, citations, and email fields.

- [ ] **Step 4: Write a failing Gemini service configuration test**

Inject a fake generative-model factory and assert that `getGenerativeModel` receives:

```ts
generationConfig: {
  responseMimeType: 'application/json',
  responseSchema: assessmentResponseSchema,
}
```

- [ ] **Step 5: Run Gemini service tests and verify RED**

Run: `cd backend && npx tsx --test src/modules/ai/gemini.service.test.ts`

Expected: FAIL because the service accepts no response schema.

- [ ] **Step 6: Implement schema-aware Gemini calls**

```ts
public async generateStructuredJSON<T>(input: GeminiStructuredInput<T>): Promise<T> {
  const model = this.getModel(input.systemInstruction, input.responseSchema);
  const raw = JSON.parse((await (await model.generateContent(input.parts)).response).text());
  const parsed = input.schema.safeParse(raw);
  if (!parsed.success) throw new AiInvalidStructuredOutputError(parsed.error);
  return parsed.data;
}
```

Do not catch `AiInvalidStructuredOutputError` as provider unavailability. Preserve it for workflow retry classification.

- [ ] **Step 7: Write failing adapter tests for malformed array and missing fields**

```ts
await assert.rejects(() => adapter.classify(input), (error: unknown) => (
  error instanceof AiInvalidStructuredOutputError && error.code === 'AI_INVALID_STRUCTURED_OUTPUT'
));
```

Assert the gateway receives `assessmentResponseSchema`; the report path receives `reportResponseSchema`.

- [ ] **Step 8: Run adapter tests and verify RED**

Run: `cd backend && npx tsx --test src/modules/document-pipeline/infrastructure/gemini-document-ai.adapter.test.ts`

Expected: FAIL because the gateway has no schema contract and raw Zod errors escape.

- [ ] **Step 9: Update the adapter and retry classification**

Remove duplicate parsing from the adapter after the typed gateway returns parsed data. Map `AI_INVALID_STRUCTURED_OUTPUT` to `retryable: true`; schema errors consume the normal five-attempt queue policy before terminal failure.

- [ ] **Step 10: Run all AI and pipeline tests**

Run: `cd backend && npx tsx --test src/modules/ai/gemini.service.test.ts src/modules/document-pipeline/domain/gemini-response.schemas.test.ts src/modules/document-pipeline/infrastructure/gemini-document-ai.adapter.test.ts src/modules/document-pipeline/application/pipeline-coordinator.test.ts && npm run build`

Expected: PASS; provider-level schema is observable in the fake gateway call.

- [ ] **Step 11: Commit structured AI output**

```bash
git add backend/src/modules/document-pipeline/domain/gemini-response.schemas.ts backend/src/modules/document-pipeline/domain/gemini-response.schemas.test.ts backend/src/modules/ai/gemini.service.ts backend/src/modules/ai/gemini.service.test.ts backend/src/modules/document-pipeline/infrastructure/gemini-document-ai.adapter.ts backend/src/modules/document-pipeline/infrastructure/gemini-document-ai.adapter.test.ts backend/src/modules/document-pipeline/application/pipeline-coordinator.ts
git commit -m "fix: constrain Gemini outputs to validated schemas"
```

---

### Task 5: Replace raw Prisma responses with JSON-safe query DTOs

**Files:**
- Create: `backend/src/modules/runs/run.dto.ts`
- Test: `backend/src/modules/runs/run.dto.test.ts`
- Create: `backend/src/modules/runs/run-query.service.ts`
- Test: `backend/src/modules/runs/run-query.service.test.ts`
- Modify: `backend/src/modules/runs/runs.routes.ts`
- Test: `backend/src/modules/runs/runs.routes.test.ts`
- Create: `backend/src/modules/document-pipeline/pipeline-query.service.ts`
- Test: `backend/src/modules/document-pipeline/pipeline-query.service.test.ts`
- Modify: `backend/src/modules/document-pipeline/document-pipeline.routes.ts`
- Test: `backend/src/modules/document-pipeline/document-pipeline.routes.test.ts`
- Modify: `backend/src/bootstrap.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Produces `RunListItemDto`, `RunDetailDto`, `RunPipelineDto`.
- Produces `serializeByteSize(value: bigint): string`.
- Active run with undiscovered pipeline returns `200 { runId, summary, issues: [], documents: [] }`.

- [ ] **Step 1: Write a failing BigInt serialization test**

```ts
test('run detail DTO converts artifact BigInt sizes to decimal strings', () => {
  const dto = toRunDetailDto(runWithArtifactSize(243316n));
  assert.equal(dto.issues[0].documents[0].artifacts[0].sizeBytes, '243316');
  assert.doesNotThrow(() => JSON.stringify(dto));
});
```

- [ ] **Step 2: Run DTO tests and verify RED**

Run: `cd backend && npx tsx --test src/modules/runs/run.dto.test.ts`

Expected: FAIL because no DTO serializer exists.

- [ ] **Step 3: Implement explicit DTO mappers**

Map only fields used by the UI. Convert dates to ISO strings and byte sizes to decimal strings. Expose `triggerSource`, `slotTime`, `mode`, `targetDate`, counts, run-owned issues/documents, safe step errors, reports, and drafts.

- [ ] **Step 4: Write failing route tests for 200, 404, and 500**

```ts
assert.equal((await app.inject({ method: 'GET', url: `/api/runs/${id}`, headers: auth })).statusCode, 200);
assert.equal((await app.inject({ method: 'GET', url: '/api/runs/missing', headers: auth })).statusCode, 404);
assert.equal((await app.inject({ method: 'GET', url: `/api/runs/${id}`, headers: auth })).json().issues[0].documents[0].artifacts[0].sizeBytes, '243316');
```

- [ ] **Step 5: Run route tests and verify RED**

Run: `cd backend && npx tsx --test src/modules/runs/runs.routes.test.ts src/modules/document-pipeline/document-pipeline.routes.test.ts`

Expected: FAIL because routes use Prisma directly and serialize raw `BigInt`.

- [ ] **Step 6: Implement and inject query services**

Routes accept narrow service options and contain only auth, input parsing, status-code mapping, and reply logic. Query services perform Prisma includes/selects and DTO mapping. Add admin protection to run reads/deletes and CSRF to delete.

- [ ] **Step 7: Return empty active pipelines as a valid state**

If the run exists but its `RunIssueExecution` has not been created, return a zeroed summary and empty lists with 200. Return 404 only when the `WorkflowRun` itself does not exist.

- [ ] **Step 8: Run backend route/query tests and build**

Run: `cd backend && npx tsx --test src/modules/runs/run.dto.test.ts src/modules/runs/run-query.service.test.ts src/modules/runs/runs.routes.test.ts src/modules/document-pipeline/pipeline-query.service.test.ts src/modules/document-pipeline/document-pipeline.routes.test.ts && npm run build`

Expected: PASS and `JSON.stringify` succeeds for every DTO fixture.

- [ ] **Step 9: Commit the API boundary**

```bash
git add backend/src/modules/runs/run.dto.ts backend/src/modules/runs/run.dto.test.ts backend/src/modules/runs/run-query.service.ts backend/src/modules/runs/run-query.service.test.ts backend/src/modules/runs/runs.routes.ts backend/src/modules/runs/runs.routes.test.ts backend/src/modules/document-pipeline/pipeline-query.service.ts backend/src/modules/document-pipeline/pipeline-query.service.test.ts backend/src/modules/document-pipeline/document-pipeline.routes.ts backend/src/modules/document-pipeline/document-pipeline.routes.test.ts backend/src/bootstrap.ts backend/src/app.ts
git commit -m "refactor: expose JSON-safe run query DTOs"
```

---

### Task 6: Make dashboard and detail states match backend truth

**Files:**
- Create: `frontend/src/features/dashboard/dashboard.types.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/features/dashboard/Dashboard.tsx`
- Test: `frontend/src/features/dashboard/Dashboard.test.tsx`
- Create: `frontend/src/features/runs/run-detail.types.ts`
- Modify: `frontend/src/features/runs/RunDetail.tsx`
- Test: `frontend/src/features/runs/RunDetail.test.tsx`
- Modify: `frontend/src/features/runs/document-pipeline.types.ts`
- Modify: `backend/src/modules/stats/stats.routes.ts`
- Test: `backend/src/modules/stats/stats.routes.test.ts`

**Interfaces:**
- `getRuns()`, `getRunDetail(id)`, `getStats()`, and `getRunPipeline(id)` all use the shared Axios client.
- `RunDetailViewState = 'loading' | 'loaded' | 'notFound' | 'serverError'`.
- Stats DTO includes `manualScans`, `automaticScans`, `completedScans`, `failedScans`, and `successPercent`.

- [ ] **Step 1: Write failing dashboard source/status tests**

```tsx
renderDashboardWithRun({ triggerSource: 'MANUAL', status: 'RUNNING' });
expect(screen.getByText('Manuel Tarama')).toBeInTheDocument();
expect(screen.queryByText('Zamanlanmış (Cron)')).not.toBeInTheDocument();

renderDashboardWithRun({ triggerSource: 'SCHEDULED', status: 'FAILED' });
expect(screen.getByText('Hata Oluştu')).toBeInTheDocument();
```

- [ ] **Step 2: Run dashboard tests and verify RED**

Run: `cd frontend && npm run test:run -- src/features/dashboard/Dashboard.test.tsx`

Expected: FAIL because source is inferred from `parameters.triggeredBy`.

- [ ] **Step 3: Replace legacy inference and fixed KPI breakdowns**

Use `run.triggerSource === 'MANUAL'` for manual; `SCHEDULED` and `CATCH_UP` for automatic. Render KPI breakdown, success percentage, and counts only from stats DTO fields. Remove hard-coded “4 Otomatik”, “3 Manuel”, “%100 Başarı”, and equivalent fixed distribution values.

- [ ] **Step 4: Write failing run-detail error and terminal-state tests**

```tsx
vi.mocked(getRunDetail).mockRejectedValueOnce(new ApiRequestError(500, 'boom'));
renderRunDetail();
expect(await screen.findByText('Tarama detayları yüklenemedi')).toBeInTheDocument();
expect(screen.queryByText('Kayıt bulunamadı')).not.toBeInTheDocument();

vi.mocked(getRunDetail).mockResolvedValueOnce(runFixture({ status: 'FAILED' }));
renderRunDetail();
expect(await screen.findByText('Hata Oluştu')).toBeInTheDocument();
expect(screen.queryByText('İnceleniyor')).not.toBeInTheDocument();
```

- [ ] **Step 5: Run run-detail tests and verify RED**

Run: `cd frontend && npm run test:run -- src/features/runs/RunDetail.test.tsx`

Expected: FAIL because non-2xx responses collapse to `run=null` and all non-completed runs look active.

- [ ] **Step 6: Implement typed API errors and explicit view states**

Use `axios.isAxiosError(error)` to distinguish `404` from other failures. Display retry action for server/network errors, a separate not-found message for 404, and unique badges for each run status. Treat empty pipeline with active run as “Belge keşfi bekleniyor”.

- [ ] **Step 7: Prevent overlapping polling**

Use one abort controller/in-flight ref. Refresh detail and pipeline on one interval only while status is `PENDING` or `RUNNING`; abort on unmount and stop on terminal states.

- [ ] **Step 8: Extend the stats endpoint and pass backend/frontend tests**

Run: `cd backend && npx tsx --test src/modules/stats/stats.routes.test.ts && cd ../frontend && npm run test:run -- src/features/dashboard/Dashboard.test.tsx src/features/runs/RunDetail.test.tsx && npm run lint && npm run build`

Expected: PASS; rendered counts come from fixtures, not constants.

- [ ] **Step 9: Commit the connected frontend behavior**

```bash
git add frontend/src/features/dashboard/dashboard.types.ts frontend/src/lib/api.ts frontend/src/features/dashboard/Dashboard.tsx frontend/src/features/dashboard/Dashboard.test.tsx frontend/src/features/runs/run-detail.types.ts frontend/src/features/runs/RunDetail.tsx frontend/src/features/runs/RunDetail.test.tsx frontend/src/features/runs/document-pipeline.types.ts backend/src/modules/stats/stats.routes.ts backend/src/modules/stats/stats.routes.test.ts
git commit -m "fix: render truthful workflow states in the UI"
```

---

### Task 7: Prove manual and scheduled paths share the same workflow

**Files:**
- Test: `backend/src/modules/cron/cron.routes.test.ts`
- Test: `backend/src/modules/jobs/jobs.routes.test.ts`
- Test: `backend/src/modules/orchestrator/workflow-runner.service.test.ts`
- Create: `backend/src/modules/orchestrator/workflow-flow.integration.test.ts`
- Modify: `backend/src/modules/jobs/jobs.routes.ts`
- Modify: `backend/src/modules/cron/cron.routes.ts`
- Modify: `backend/src/modules/orchestrator/workflow-runner.service.ts`
- Modify: `backend/src/bootstrap.ts`
- Modify: `docs/operations.md`

**Interfaces:**
- Both HTTP triggers produce the same `StartWorkflowRunCommand` shape.
- Worker runner preserves persisted `triggerSource`, `slotTime`, `mode`, and `targetDate`.
- Integration fixture records outbox, workflow-run job, issue job, and first document job IDs.

- [ ] **Step 1: Write failing trigger convergence tests**

```ts
assert.deepEqual(manualCommand.pipeline, scheduledCommand.pipeline);
assert.equal(manualCommand.triggerSource, 'MANUAL');
assert.equal(scheduledCommand.triggerSource, 'SCHEDULED');
assert.equal(manualOutbox.queueName, 'workflow-run');
assert.equal(scheduledOutbox.queueName, 'workflow-run');
```

- [ ] **Step 2: Run trigger tests and verify RED**

Run: `cd backend && npx tsx --test src/modules/jobs/jobs.routes.test.ts src/modules/cron/cron.routes.test.ts src/modules/orchestrator/workflow-runner.service.test.ts`

Expected: FAIL until both delivery paths call one application command and expose the same persisted fields.

- [ ] **Step 3: Extract and wire one start-run use case**

Move run/outbox creation behind one injected service used by jobs and cron routes. `slotTime: '04:00'` remains the manual FULL default for `/api/jobs/run`; `/api/cron/trigger` derives mode from the selected slot. Neither route invokes the runner directly.

- [ ] **Step 4: Add an integration test through terminal state**

Use fake source/storage/AI adapters with real application/repository behavior. Start one manual and one scheduled run for the same issue, drain their jobs, and assert:

```ts
assert.notEqual(manual.runIssueExecutionId, scheduled.runIssueExecutionId);
assert.equal(manual.status, 'COMPLETED');
assert.equal(scheduled.status, 'COMPLETED');
assert.equal(manual.triggerSource, 'MANUAL');
assert.equal(scheduled.triggerSource, 'SCHEDULED');
```

- [ ] **Step 5: Run integration and full automated verification**

Run: `cd backend && npm run test:unit && npm run build && npx prisma validate && cd ../frontend && npm run test:run && npm run lint && npm run build`

Expected: all tests, builds, lint, and Prisma validation pass.

- [ ] **Step 6: Rebuild Docker and run live API acceptance**

Run:

```bash
docker compose up -d --build
docker compose ps
curl -fsS -H 'Authorization: Bearer mock-token' http://localhost:8090/api/cron/status
```

Expected: API, worker, database, Gotenberg, and web are up; status returns four Istanbul slots.

Trigger a manual FULL run with a fresh idempotency key, follow `/api/runs/:id` and `/api/runs/:id/pipeline` until terminal, and assert no response is 500 and every artifact `sizeBytes` is a string. Trigger the same target date again and verify the first run's execution IDs and detail response remain unchanged.

- [ ] **Step 7: Document recovery and verification commands**

Update `docs/operations.md` with run-execution tables, Gemini invalid-output error code, non-overlapping polling symptoms, and read-only checks for a stuck run. Keep TLS verification enabled.

- [ ] **Step 8: Commit integration coverage and operations guide**

```bash
git add backend/src/modules/cron/cron.routes.test.ts backend/src/modules/jobs/jobs.routes.test.ts backend/src/modules/orchestrator/workflow-runner.service.test.ts backend/src/modules/orchestrator/workflow-flow.integration.test.ts backend/src/modules/jobs/jobs.routes.ts backend/src/modules/cron/cron.routes.ts backend/src/modules/orchestrator/workflow-runner.service.ts backend/src/bootstrap.ts docs/operations.md
git commit -m "test: verify manual and scheduled workflow parity"
```

---

## Final Verification Checklist

- [ ] `cd backend && npm run test:unit` passes.
- [ ] `cd backend && npm run build` passes.
- [ ] `cd backend && npx prisma validate` passes.
- [ ] `cd frontend && npm run test:run` passes.
- [ ] `cd frontend && npm run lint` passes.
- [ ] `cd frontend && npm run build` passes.
- [ ] `docker compose config` passes.
- [ ] `docker compose -f docker-compose.prod.yml config` passes.
- [ ] `docker compose -f deploy/docker-compose.prod.yml config` passes.
- [ ] Live detail and pipeline endpoints return JSON-safe responses without `BigInt` failures.
- [ ] Live Gemini calls include provider `responseSchema` and produce Zod-valid classification/report values.
- [ ] Two runs of the same issue preserve independent histories and both reach terminal status.
- [ ] Manual runs render as manual and never advance the scheduled cron timeline.
- [ ] Scheduled/telafi runs render in their own Istanbul slot and reach a terminal status.
- [ ] `git diff --check` reports no whitespace errors.
