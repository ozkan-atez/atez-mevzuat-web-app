# Reliable Cron Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement four reliable `Europe/Istanbul` scan slots with atomic outbox delivery, a separate scheduler/worker process, mode-correct scraping, protected APIs, and an accurate live dashboard.

**Architecture:** Pure cron definitions and status policies sit behind injected repository, clock, queue, and workflow ports. Prisma stores structured run metadata plus an outbox created in the same transaction; the worker dispatches outbox records to pg-boss and consumes workflow jobs. Fastify exposes validated admin-only endpoints, while React renders the server-owned slot state without reinterpreting `PENDING` as active.

**Tech Stack:** TypeScript, Fastify 5, Zod 4, Prisma 5/PostgreSQL, pg-boss 12, node-cron 4, React 19, Vitest, Testing Library, Docker Compose

**Spec:** `docs/superpowers/specs/2026-09-11-reliable-cron-dashboard-design.md`

## Global Constraints

- Scheduler and publication date use `Europe/Istanbul`.
- 04:00 is `FULL`; 09:00, 14:00, and 22:00 are `MUKERRER_CHECK`.
- API and worker run from the same image as separate processes.
- Cron-originated workflows create mail drafts and never send mail.
- Existing `parameters` JSON remains readable during migration.
- Existing unrelated working-tree changes must not be reverted or reformatted.
- Production startup must not run `prisma db push --accept-data-loss`.

---

### Task 1: Test Harness and Pure Cron Domain

**Files:**
- Modify: `backend/package.json`
- Create: `backend/src/modules/cron/cron.types.ts`
- Create: `backend/src/modules/cron/cron.definitions.ts`
- Create: `backend/src/modules/cron/cron.definitions.test.ts`

**Interfaces:**
- Produces: `CRON_TIMEZONE`, `CRON_SLOTS`, `CronSlotTime`, `ScanMode`, `formatDateInTimeZone(date, timezone)`, `formatTimeInTimeZone(date, timezone)`, `getSlotLifecycle(slot, now)`.
- Consumes: JavaScript `Intl.DateTimeFormat`; no database or framework dependency.

```ts
export type ScanMode = 'FULL' | 'MUKERRER_CHECK';
export type CronSlotTime = '04:00' | '09:00' | '14:00' | '22:00';
export type TriggerSource = 'SCHEDULED' | 'MANUAL' | 'CATCH_UP';
export type SlotStatus = 'COMPLETED' | 'RUNNING' | 'PENDING' | 'WAITING' | 'FAILED';
export interface ClockPort { now(): Date }
export interface WorkflowJobPayload {
  dbJobId: string;
  targetDate: string;
  mode: ScanMode;
  triggeredBy: string;
  triggerSource: TriggerSource;
}
```

- [ ] **Step 1: Add the backend unit-test command**

```json
{
  "scripts": {
    "test:unit": "tsx --test src/**/*.test.ts",
    "test": "npm run test:unit"
  }
}
```

- [ ] **Step 2: Write failing tests for Istanbul date/time and slot boundaries**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDateInTimeZone,
  formatTimeInTimeZone,
  getSlotLifecycle,
} from './cron.definitions';

test('uses Istanbul publication date across UTC midnight', () => {
  const instant = new Date('2026-09-10T21:30:00.000Z');
  assert.equal(formatDateInTimeZone(instant, 'Europe/Istanbul'), '2026-09-11');
  assert.equal(formatTimeInTimeZone(instant, 'Europe/Istanbul'), '00:30');
});

test('future slot is PENDING and elapsed slot without a run is WAITING', () => {
  const instant = new Date('2026-09-11T07:23:00.000Z'); // 10:23 Istanbul
  assert.equal(getSlotLifecycle('09:00', instant), 'WAITING');
  assert.equal(getSlotLifecycle('14:00', instant), 'PENDING');
});
```

- [ ] **Step 3: Run the test and confirm RED**

Run: `npm run test:unit -- cron.definitions.test.ts`  
Expected: FAIL because `cron.definitions.ts` and exported functions do not exist.

- [ ] **Step 4: Implement the pure domain API**

```ts
export const CRON_TIMEZONE = 'Europe/Istanbul' as const;
export const CRON_SLOTS = [
  { time: '04:00', title: '04:00 Ana Sayı', mode: 'FULL', triggerKey: 'CRON_04_00' },
  { time: '09:00', title: '09:00 1. Mükerrer', mode: 'MUKERRER_CHECK', triggerKey: 'CRON_09_00' },
  { time: '14:00', title: '14:00 2. Mükerrer', mode: 'MUKERRER_CHECK', triggerKey: 'CRON_14_00' },
  { time: '22:00', title: '22:00 Gün Sonu', mode: 'MUKERRER_CHECK', triggerKey: 'CRON_22_00' },
] as const;
```

Use `Intl.DateTimeFormat(...).formatToParts()` so both date and hour comparisons are evaluated in `Europe/Istanbul`, not in UTC or the host timezone.

- [ ] **Step 5: Run the unit tests**

Run: `npm run test:unit`  
Expected: both cron definition tests PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add backend/package.json backend/src/modules/cron/cron.types.ts backend/src/modules/cron/cron.definitions.ts backend/src/modules/cron/cron.definitions.test.ts
git commit -m "test: define Istanbul cron slot policy"
```

---

### Task 2: Structured Run Metadata and Transactional Outbox

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260911_reliable_cron_outbox/migration.sql`
- Create: `backend/src/modules/cron/cron.repository.ts`
- Create: `backend/src/modules/cron/cron.repository.test.ts`

**Interfaces:**
- Consumes: `CronSlotTime`, `ScanMode` from Task 1 and injected `PrismaClient`.
- Produces: `CronRepository.createScheduledRun()`, `createManualRun()`, `findRunsForDate()`, `claimPendingOutbox()`, `markOutboxDelivered()`, and `markOutboxFailed()`.

```ts
export interface ScheduledRunInput {
  workflowId: string;
  targetDate: string;
  slotTime: CronSlotTime;
  mode: ScanMode;
  triggerSource: 'SCHEDULED' | 'CATCH_UP';
  scheduleKey: string;
}
export interface ManualRunInput {
  workflowId: string;
  targetDate: string;
  slotTime: CronSlotTime;
  mode: ScanMode;
  actorId: string;
  idempotencyKey: string;
}
export interface CronRunRecord {
  id: string;
  targetDate: string | null;
  slotTime: CronSlotTime | null;
  mode: ScanMode | null;
  triggerSource: TriggerSource | null;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt: Date;
  finishedAt: Date | null;
  summary: string | null;
  itemsCount: number;
  reportsCount: number;
}
export interface OutboxRecord { id: string; runId: string; queueName: 'workflow-run'; payload: WorkflowJobPayload; attempts: number }
export interface CreateRunResult { run: CronRunRecord; created: boolean }
export interface CronRepositoryPort {
  createScheduledRun(input: ScheduledRunInput): Promise<CreateRunResult>;
  createManualRun(input: ManualRunInput): Promise<CreateRunResult>;
  findRunsForDate(targetDate: string): Promise<CronRunRecord[]>;
  claimPendingOutbox(limit: number, now: Date): Promise<OutboxRecord[]>;
  markOutboxDelivered(outboxId: string, runId: string, queuedAt: Date): Promise<void>;
  markOutboxFailed(outboxId: string, runId: string, error: string, terminal: boolean): Promise<void>;
}
```

- [ ] **Step 1: Write failing repository contract tests with an in-memory repository fixture**

```ts
test('returns the existing scheduled run for the same date and slot', async () => {
  const first = await repository.createScheduledRun(input);
  const second = await repository.createScheduledRun(input);
  assert.equal(second.run.id, first.run.id);
  assert.equal(repository.outboxCount(), 1);
});

test('manual slot runs keep slot metadata and do not consume schedule key', async () => {
  const result = await repository.createManualRun({
    targetDate: '2026-09-11', slotTime: '14:00', mode: 'MUKERRER_CHECK',
    idempotencyKey: 'manual-request-1', actorId: 'admin-123',
  });
  assert.equal(result.run.slotTime, '14:00');
  assert.equal(result.run.scheduleKey, null);
});
```

- [ ] **Step 2: Run the repository tests and confirm RED**

Run: `npm run test:unit -- cron.repository.test.ts`  
Expected: FAIL because the repository contract is absent.

- [ ] **Step 3: Extend the Prisma schema**

```prisma
model WorkflowRun {
  // existing fields remain
  targetDate    String?
  mode          String?
  triggerSource String?
  slotTime      String?
  scheduleKey   String?  @unique
  requestKey    String?  @unique
  queuedAt      DateTime?
  outbox        WorkflowOutbox?

  @@index([targetDate, slotTime, startedAt])
}

model WorkflowOutbox {
  id          String      @id @default(uuid())
  runId       String      @unique
  run         WorkflowRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  queueName   String
  payload     Json
  status      String      @default("PENDING")
  attempts    Int         @default(0)
  lastError   String?
  availableAt DateTime    @default(now())
  processedAt DateTime?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  @@index([status, availableAt])
}
```

- [ ] **Step 4: Add the SQL migration**

The migration adds the nullable `WorkflowRun` columns, unique indexes for `scheduleKey` and `requestKey`, the date/slot lookup index, and the `WorkflowOutbox` table with its foreign key. It must contain only additive statements so existing records remain valid.

- [ ] **Step 5: Implement the Prisma repository and in-memory test fixture against the same contract**

`createScheduledRun()` must call `prisma.$transaction()`, resolve workflow key `resmi-gazete-gumruk`, and create both run and outbox. On Prisma unique-key conflict it must fetch and return the existing run instead of creating another outbox record.

- [ ] **Step 6: Verify schema and tests**

Run: `npx prisma validate && npx prisma generate && npm run test:unit`  
Expected: Prisma validation succeeds and repository tests PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add backend/prisma backend/src/modules/cron/cron.repository.ts backend/src/modules/cron/cron.repository.test.ts
git commit -m "feat: persist cron metadata and workflow outbox"
```

---

### Task 3: Cron Application Service and Accurate Status Compiler

**Files:**
- Replace: `backend/src/modules/cron/cron.service.ts`
- Create: `backend/src/modules/cron/cron.service.test.ts`

**Interfaces:**
- Consumes: `CronRepositoryPort`, `ClockPort`, `CRON_SLOTS`, `CRON_TIMEZONE`.
- Produces: `CronService.triggerScheduledSlot(slotTime)`, `triggerManualSlot(input)`, `getDashboardStatus()`, and `enqueueCatchUpIfNeeded()`.

- [ ] **Step 1: Write failing service tests for status matching**

```ts
test('does not map an old or unscoped manual run to 04:00', async () => {
  repository.runs = [{
    id: 'july-run', targetDate: '2026-07-11', slotTime: null,
    triggerSource: 'MANUAL', status: 'COMPLETED', startedAt: new Date(),
  }];
  const status = await service.getDashboardStatus();
  assert.equal(status.slots[0]?.runId, undefined);
  assert.equal(status.completedSlotsCount, 0);
});

test('reports only RUNNING as active and progress starts at zero', async () => {
  repository.runs = [];
  const status = await service.getDashboardStatus();
  assert.equal(status.activeScan, null);
  assert.equal(status.progressPercent, 0);
});
```

- [ ] **Step 2: Write failing tests for scheduled, manual, and catch-up triggers**

Assert that scheduled keys equal `cron:2026-09-11:04:00`, manual mode is derived from `CRON_SLOTS`, and startup recovery creates only the most recent missed slot.

- [ ] **Step 3: Run service tests and confirm RED**

Run: `npm run test:unit -- cron.service.test.ts`  
Expected: FAIL against the current singleton service and 24-hour fallback logic.

- [ ] **Step 4: Implement the injected service**

```ts
export class CronService {
  constructor(
    private readonly repository: CronRepositoryPort,
    private readonly clock: ClockPort = { now: () => new Date() },
  ) {}
}
```

Query only `targetDate === formatDateInTimeZone(now, CRON_TIMEZONE)`. Match by structured `slotTime`; prefer `SCHEDULED`/`CATCH_UP` over `MANUAL`, then newest `startedAt`. Preserve legacy JSON only when its `targetDate` and `slotTime` are both present and valid. Compute `activeScan` from `RUNNING` only and progress as `completedSlotsCount * 25`.

- [ ] **Step 5: Run service tests**

Run: `npm run test:unit`  
Expected: cron domain, repository, and service tests PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add backend/src/modules/cron/cron.service.ts backend/src/modules/cron/cron.service.test.ts
git commit -m "fix: compile cron dashboard from exact slot runs"
```

---

### Task 4: Outbox Dispatcher, Scheduler, and Process Separation

**Files:**
- Create: `backend/src/modules/cron/outbox-dispatcher.ts`
- Create: `backend/src/modules/cron/outbox-dispatcher.test.ts`
- Create: `backend/src/modules/cron/cron.scheduler.ts`
- Create: `backend/src/modules/cron/cron.scheduler.test.ts`
- Create: `backend/src/bootstrap.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/src/worker.ts`
- Modify: `backend/src/platform/queue.ts`
- Modify: `backend/Dockerfile`
- Modify: `docker-compose.prod.yml`
- Modify: `deploy/docker-compose.prod.yml`

**Interfaces:**
- Consumes: `CronService`, `CronRepositoryPort`, `JobQueuePort`, node-cron.
- Produces: `OutboxDispatcher.dispatchBatch()`, `CronScheduler.start()`, `CronScheduler.stop()`, `buildApiDependencies()`, and `buildWorkerDependencies()`.

```ts
export interface JobQueuePort {
  send(name: 'workflow-run', payload: WorkflowJobPayload, options: { singletonKey: string }): Promise<string | null>;
}
```

- [ ] **Step 1: Write failing dispatcher tests**

Test that a successful send marks `DELIVERED` and writes `queuedAt`; a failed send increments attempts and keeps the outbox retryable; exceeding the configured attempt limit marks both outbox and run `FAILED`.

- [ ] **Step 2: Write failing scheduler tests**

Inject a fake scheduler adapter and assert the exact expressions `0 4 * * *`, `0 9 * * *`, `0 14 * * *`, `0 22 * * *`, each with `{ timezone: 'Europe/Istanbul' }`. Assert rejected callbacks are logged rather than becoming unhandled promises.

- [ ] **Step 3: Run the new tests and confirm RED**

Run: `npm run test:unit -- outbox-dispatcher.test.ts cron.scheduler.test.ts`  
Expected: FAIL because dispatcher/scheduler ports do not exist.

- [ ] **Step 4: Implement dispatcher and scheduler**

Use pg-boss `singletonKey` equal to the run ID when sending `workflow-run`. Run `dispatchBatch()` immediately at worker startup and on a bounded interval. `CronScheduler.start()` registers the four tasks and invokes `enqueueCatchUpIfNeeded()` once.

- [ ] **Step 5: Create composition roots and graceful shutdown**

`server.ts` builds Fastify dependencies and listens only. `worker.ts` starts pg-boss, registers `workflow-run`, starts dispatcher and scheduler, and on `SIGTERM`/`SIGINT` stops cron tasks, dispatcher interval, pg-boss, and Prisma.

- [ ] **Step 6: Split production services**

```yaml
backend-api:
  command: ["npm", "run", "start:api"]

backend-worker:
  command: ["npm", "run", "start:worker"]
```

Build the backend once via a multi-stage Dockerfile, run `prisma migrate deploy` as an explicit one-shot release service, and remove runtime `db push --accept-data-loss`.

- [ ] **Step 7: Verify unit tests and Compose rendering**

Run: `npm run test:unit && docker compose -f docker-compose.prod.yml config`  
Expected: tests PASS and Compose contains distinct `backend-api` and `backend-worker` services.

- [ ] **Step 8: Commit Task 4**

```bash
git add backend/src/modules/cron backend/src/bootstrap.ts backend/src/server.ts backend/src/worker.ts backend/src/platform/queue.ts backend/Dockerfile docker-compose.prod.yml deploy/docker-compose.prod.yml
git commit -m "feat: separate cron worker with outbox delivery"
```

---

### Task 5: Mode-Correct Workflow and Cron Mail Drafts

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/prisma/migrations/20260911_reliable_cron_outbox/migration.sql`
- Modify: `backend/src/modules/orchestrator/workflow-runner.service.ts`
- Create: `backend/src/modules/orchestrator/workflow-runner.service.test.ts`
- Create: `backend/src/modules/mail/mail-draft.service.ts`
- Create: `backend/src/modules/mail/mail-draft.service.test.ts`

**Interfaces:**
- Consumes: injected scraper, report generator, `MailDraftService`, and `MailService` ports.
- Produces: mode-aware `CustomsWorkflowRunner.executeWorkflow()` and a persisted `MailDraft` for scheduled/catch-up runs.

```ts
export interface WorkflowRunOptions {
  mode: ScanMode;
  triggeredBy: string;
  triggerSource: TriggerSource;
}
```

- [ ] **Step 1: Write failing mode-selection test**

```ts
test('MUKERRER_CHECK fetches only mukerrer issues', async () => {
  await runner.executeWorkflow('2026-09-11', 'run-1', {
    mode: 'MUKERRER_CHECK', triggeredBy: 'CRON_09_00',
  });
  assert.equal(scraper.fetchMukerrerIssuesCalls, 1);
  assert.equal(scraper.fetchDailyAndMukerrerGazetteCalls, 0);
});
```

- [ ] **Step 2: Write failing cron-mail policy test**

For `triggerSource: 'SCHEDULED'`, assert `MailDraftService.createForRun()` is called once and `MailService.sendReportEmail()` is never called. For `MANUAL`, preserve the explicitly approved existing manual behavior.

- [ ] **Step 3: Run runner tests and confirm RED**

Run: `npm run test:unit -- workflow-runner.service.test.ts`  
Expected: FAIL because the runner always calls `fetchDailyAndMukerrerGazette()` and sends email.

- [ ] **Step 4: Add the mail-draft model and service**

```prisma
model MailDraft {
  id          String      @id @default(uuid())
  runId       String      @unique
  run         WorkflowRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  recipients  String
  subject     String
  contentHtml String
  status      String      @default("DRAFT")
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
}
```

Add the corresponding additive SQL statements to the Task 2 migration.

- [ ] **Step 5: Refactor runner dependencies and preserve structured metadata**

Select scraper method from `mode`. When updating a supplied run ID, update status only; do not overwrite `slotTime`, `targetDate`, `triggerSource`, or `scheduleKey`. Route scheduled/catch-up results to `MailDraftService`; route only explicitly manual flows to the existing sender.

- [ ] **Step 6: Run runner and full backend tests**

Run: `npm run test:unit`  
Expected: all backend unit tests PASS without calling external Gazette, Gemini, Graph, or PostgreSQL services.

- [ ] **Step 7: Commit Task 5**

```bash
git add backend/prisma backend/src/modules/orchestrator backend/src/modules/mail
git commit -m "fix: honor mukerrer mode and draft cron mail"
```

---

### Task 6: Protected and Validated Cron HTTP API

**Files:**
- Create: `backend/src/modules/cron/cron.schemas.ts`
- Modify: `backend/src/modules/cron/cron.routes.ts`
- Create: `backend/src/modules/cron/cron.routes.test.ts`
- Modify: `backend/src/modules/auth/auth.routes.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: injected `CronService`, reusable `requireAdmin`, and Zod request schemas.
- Produces: authenticated `GET /api/cron/status` and idempotent `POST /api/cron/trigger`.

- [ ] **Step 1: Write failing Fastify injection tests**

Cover `401` without credentials, `403` for non-admin, `403` for a missing/mismatched CSRF header, `400` for `08:00`, `400` for malformed dates, mode derivation from `14:00`, sanitized `500`, and reuse of `Idempotency-Key`.

- [ ] **Step 2: Run route tests and confirm RED**

Run: `npm run test:unit -- cron.routes.test.ts`  
Expected: current unprotected route accepts invalid slot values, so assertions fail.

- [ ] **Step 3: Extract reusable admin authentication**

Move the existing mock-token verification into an application-level decorator/hook function that routes can opt into. The cron plugin must apply it to both routes. Keep the adapter replaceable by the future OIDC implementation.

- [ ] **Step 4: Implement request schemas and safe errors**

```ts
export const triggerCronSchema = z.object({
  slotTime: z.enum(['04:00', '09:00', '14:00', '22:00']),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
```

Require an `Idempotency-Key` header for POST. Require `X-CSRF-Token` to match the authenticated session's CSRF token through an injected `requireCsrf` hook; in the current mock adapter use the fixed test-session token returned by `/api/auth/me`. Derive mode from the slot definition, and return a request ID rather than the internal exception message on `500`.

- [ ] **Step 5: Run route and backend tests**

Run: `npm run test:unit && npm run build`  
Expected: route tests PASS and TypeScript compilation exits zero.

- [ ] **Step 6: Commit Task 6**

```bash
git add backend/src/modules/cron backend/src/modules/auth backend/src/app.ts
git commit -m "feat: validate and protect cron endpoints"
```

---

### Task 7: Dashboard State Rendering and Polling

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/features/dashboard/cron-status.ts`
- Create: `frontend/src/features/dashboard/CronTimeline.tsx`
- Create: `frontend/src/features/dashboard/CronTimeline.test.tsx`
- Modify: `frontend/src/features/dashboard/Dashboard.tsx`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: `CronDashboardStatus` from `cron-status.ts` and the shared authenticated API client.
- Produces: `CronTimeline`, `isActiveSlot(status)`, and abort-safe five-second polling.

- [ ] **Step 1: Add Vitest and Testing Library**

Add `vitest`, `jsdom`, `@testing-library/react`, and `@testing-library/jest-dom` as dev dependencies and scripts `test` and `test:run`.

- [ ] **Step 2: Write failing rendering tests**

```tsx
it('renders only RUNNING as active', () => {
  render(<CronTimeline status={fixtureWithPendingFutureSlots} onTrigger={vi.fn()} />);
  expect(screen.queryByText('İşleniyor')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Şimdi Çalıştır/i })).toHaveLength(3);
});

it('does not show fake completed slots while loading', () => {
  render(<CronTimeline status={null} loading onTrigger={vi.fn()} />);
  expect(screen.queryByText('Tamamlandı')).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run frontend tests and confirm RED**

Run: `npm run test:run -- CronTimeline.test.tsx`  
Expected: FAIL because `CronTimeline` does not exist and current Dashboard treats `PENDING` as running.

- [ ] **Step 4: Extract and implement CronTimeline**

Use exact status predicates: `status === 'RUNNING'`, `status === 'COMPLETED'`, and `status === 'FAILED'`. Permit trigger for `PENDING`, `WAITING`, and `FAILED` when no request is already in flight. Show a neutral skeleton for `null` status and compute no client-side fallback completion.

- [ ] **Step 5: Replace raw fetches with the shared API client**

Add `getCronStatus(signal)` and `triggerCronSlot(input, idempotencyKey)` functions. Poll with an `AbortController`, skip a tick while the prior request is in flight, abort on unmount, and refresh status/runs after a successful trigger without automatically navigating away from the timeline.

- [ ] **Step 6: Run frontend tests, lint, and build**

Run: `npm run test:run && npm run lint && npm run build`  
Expected: tests PASS, lint has no newly introduced warnings, and production build exits zero.

- [ ] **Step 7: Commit Task 7**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/features/dashboard frontend/src/lib/api.ts
git commit -m "fix: render cron slot lifecycle accurately"
```

---

### Task 8: Documentation, Migration, and End-to-End Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-11-reliable-cron-dashboard-design.md`
- Create: `docs/operations.md`

**Interfaces:**
- Consumes: all completed tasks.
- Produces: documented API/worker startup, migration, recovery, and operational checks.

- [ ] **Step 1: Update architecture and operations documentation**

Document `Europe/Istanbul` as the approved scheduler timezone, API/worker commands, release-time `prisma migrate deploy`, outbox retry/recovery, duplicate-slot behavior, and the rule that cron creates drafts without sending mail.

- [ ] **Step 2: Run the full automated verification suite**

Run: `cd backend && npm run test:unit && npm run build && npx prisma validate`  
Expected: all commands exit zero.

Run: `cd frontend && npm run test:run && npm run lint && npm run build`  
Expected: all commands exit zero with no newly introduced warnings.

Run: `docker compose -f docker-compose.prod.yml config`  
Expected: Compose renders successfully with separate API, worker, and migration services.

- [ ] **Step 3: Apply the additive migration to the local development database**

Run: `cd backend && npx prisma migrate deploy`  
Expected: `20260911_reliable_cron_outbox` is applied without destructive warnings.

- [ ] **Step 4: Perform live read-only verification**

Start/restart the API and worker through the existing project workflow. Query `/api/cron/status` with admin credentials and verify:

```json
{
  "targetDate": "2026-09-11",
  "timezone": "Europe/Istanbul",
  "completedSlotsCount": 0,
  "progressPercent": 0
}
```

The exact counts may differ with valid current-day slot records, but an old/manual unscoped run must not appear under 04:00, and future `PENDING` slots must not render as active.

- [ ] **Step 5: Perform one controlled manual trigger verification**

POST the 14:00 slot with a fresh `Idempotency-Key`, repeat the same request, and verify both responses return the same run ID. Confirm one outbox record, one pg-boss job, preserved `slotTime=14:00`, and no automatic `EmailDispatch` for the cron-style run.

- [ ] **Step 6: Review the final diff for generated artifacts and unrelated changes**

Run: `git status --short && git diff --check && git diff --stat`  
Expected: no new compiled `.js`, `.d.ts`, source maps, credentials, or unrelated file changes are included.

- [ ] **Step 7: Commit Task 8**

```bash
git add README.md docs backend/prisma/migrations
git commit -m "docs: document reliable cron operations"
```
