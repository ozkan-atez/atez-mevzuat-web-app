# Resmî Gazete Manual Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real manual scan that collects every official Resmî Gazete publication and supported in-document asset for a selected date, stores bytes in an S3-compatible object store, records auditable metadata in PostgreSQL, and exposes truthful progress in the existing UI.

**Architecture:** Keep scan rules in a dedicated domain/application module and put PostgreSQL, pg-boss, S3 and HTTPS behind adapters. A durable outbox hands API requests to a worker; the worker executes ordered stages and never marks a run complete until the final manifest and required database relations are verified.

**Tech Stack:** Node.js 22, TypeScript, Fastify 5, Prisma 5/PostgreSQL 15, pg-boss 12, AWS SDK v3, Cheerio, Luxon, Zod 4, React 19, React Router 7, Vitest, Testing Library, Docker Compose, pinned MinIO development image.

**Spec:** `docs/plans/2026-09-13-resmi-gazete-manual-ingestion-design.md`

## Global Constraints

- The only source in this phase is `https://www.resmigazete.gov.tr` (also permit the canonical host without `www`).
- Default dates are calculated in `Europe/Istanbul`; an explicitly selected `YYYY-MM-DD` date is preserved exactly.
- A deliberate rescan creates a new run; an identical request with the same `Idempotency-Key` returns the original run.
- Original HTML, PDF and supported image bytes go to the object store, never PostgreSQL BLOB columns.
- SHA-256 is the content identity and `StoredObject.sha256` is unique.
- TLS verification stays enabled; redirects to unapproved hosts and `..` path traversal are rejected.
- Requests are source-friendly: at least 750 ms apart, with explicit timeouts and no more than three attempts for `429` or transient `5xx` responses.
- A run is never `COMPLETED` when a required publication or asset is missing or invalid.
- Cron execution, AI analysis, relevance filtering, reports and email are out of scope.
- No frontend fallback may invent a run ID, counter, result, or successful state.

---

## Planned File Structure

### Backend

```text
backend/
  src/
    config/env.ts                         validated environment values
    modules/scan-runs/
      domain/scan-run.ts                  enums, transitions and progress DTOs
      domain/source-policy.ts             official host/path policy
      application/ports.ts                repository, queue, storage and HTTP ports
      application/create-scan-run.ts      idempotent manual-run creation
      application/execute-scan-run.ts     ordered stage orchestration
      application/build-manifest.ts       deterministic manifest generation
      infrastructure/prisma-scan-repository.ts
      infrastructure/s3-object-store.ts
      infrastructure/official-http-client.ts
      infrastructure/resmi-gazete-parser.ts
      infrastructure/file-validator.ts
      infrastructure/scan-run-queue.ts
      scan-runs.routes.ts                 POST/GET/SSE API
      scan-runs.schemas.ts                Zod HTTP schemas
    platform/database.ts
    platform/queue.ts
    app.ts
    worker.ts
  test/
    unit/scan-run.test.ts
    unit/source-policy.test.ts
    unit/resmi-gazete-parser.test.ts
    unit/file-validator.test.ts
    unit/build-manifest.test.ts
    integration/create-scan-run.test.ts
    integration/s3-object-store.test.ts
    integration/execute-scan-run.test.ts
    contract/scan-runs.routes.test.ts
    fixtures/resmi-gazete/2026-07-11/*
  prisma/schema.prisma
  prisma/migrations/20260913190000_add_manual_scan_ingestion/migration.sql
  vitest.config.ts
```

### Frontend and deployment

```text
frontend/
  src/features/scans/api.ts
  src/features/scans/types.ts
  src/features/scans/useScanRun.ts
  src/features/dashboard/TriggerWorkflowModal.tsx
  src/features/runs/RunDetail.tsx
  src/features/runs/OperationSteps.tsx
  src/features/runs/CollectedDocuments.tsx
  src/features/dashboard/TriggerWorkflowModal.test.tsx
  src/features/runs/RunDetail.test.tsx
  src/test/setup.ts
  vitest.config.ts
.env.example
docker-compose.yml
docker-compose.prod.yml
backend/Dockerfile
```

---

### Task 1: Establish test and configuration foundations

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/tsconfig.json`
- Create: `backend/vitest.config.ts`
- Create: `backend/test/setup.ts`
- Create: `backend/src/config/env.ts`
- Create: `backend/test/unit/env.test.ts`

**Interfaces:**
- Produces: `loadEnv(input?: NodeJS.ProcessEnv): AppEnv`
- Produces: `AppEnv` with database, source, throttling and S3 configuration used by every later adapter.

- [ ] **Step 1: Add backend test and runtime dependencies**

Run:

```bash
cd backend
npm install @aws-sdk/client-s3 @aws-sdk/lib-storage cheerio file-type luxon
npm install --save-dev vitest @vitest/coverage-v8 @types/luxon
```

Set these scripts in `backend/package.json`:

```json
{
  "scripts": {
    "build": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "start:api": "tsx src/server.ts",
    "start:worker": "tsx src/worker.ts",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy"
  }
}
```

Create `backend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
})
```

Create `backend/test/setup.ts`:

```ts
process.env.NODE_ENV = 'test'
```

- [ ] **Step 2: Write failing environment tests**

Create `backend/test/unit/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadEnv } from '../../src/config/env'

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'eu-central-1',
  S3_BUCKET: 'resmi-gazete',
  S3_ACCESS_KEY_ID: 'local-access',
  S3_SECRET_ACCESS_KEY: 'local-secret',
}

describe('loadEnv', () => {
  it('applies the approved source defaults', () => {
    const env = loadEnv(base)
    expect(env.sourceHosts).toEqual(['resmigazete.gov.tr', 'www.resmigazete.gov.tr'])
    expect(env.sourceDelayMs).toBe(750)
    expect(env.sourceMaxAttempts).toBe(3)
    expect(env.timezone).toBe('Europe/Istanbul')
  })

  it('rejects a non-positive download limit', () => {
    expect(() => loadEnv({ ...base, MAX_FILE_BYTES: '0' })).toThrow()
  })
})
```

- [ ] **Step 3: Run the test and confirm the missing module failure**

Run: `cd backend && npm test -- test/unit/env.test.ts`

Expected: FAIL because `src/config/env.ts` does not exist.

- [ ] **Step 4: Implement validated environment loading**

Create `backend/src/config/env.ts` with a Zod schema that returns this exact shape:

```ts
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  SCAN_TIMEZONE: z.string().default('Europe/Istanbul'),
  SOURCE_HOSTS: z.string().default('resmigazete.gov.tr,www.resmigazete.gov.tr'),
  SOURCE_DELAY_MS: z.coerce.number().int().min(750).default(750),
  SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  SOURCE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(3).default(3),
  MAX_FILE_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
  MAX_RUN_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024 * 1024),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('eu-central-1'),
  S3_BUCKET: z.string().default('resmi-gazete'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
})

export interface AppEnv {
  databaseUrl: string
  port: number
  timezone: string
  sourceHosts: string[]
  sourceDelayMs: number
  sourceTimeoutMs: number
  sourceMaxAttempts: number
  maxFileBytes: number
  maxRunBytes: number
  s3: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean }
}

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const value = schema.parse(input)
  return {
    databaseUrl: value.DATABASE_URL,
    port: value.PORT,
    timezone: value.SCAN_TIMEZONE,
    sourceHosts: value.SOURCE_HOSTS.split(',').map((host) => host.trim()).filter(Boolean),
    sourceDelayMs: value.SOURCE_DELAY_MS,
    sourceTimeoutMs: value.SOURCE_TIMEOUT_MS,
    sourceMaxAttempts: value.SOURCE_MAX_ATTEMPTS,
    maxFileBytes: value.MAX_FILE_BYTES,
    maxRunBytes: value.MAX_RUN_BYTES,
    s3: {
      endpoint: value.S3_ENDPOINT,
      region: value.S3_REGION,
      bucket: value.S3_BUCKET,
      accessKeyId: value.S3_ACCESS_KEY_ID,
      secretAccessKey: value.S3_SECRET_ACCESS_KEY,
      forcePathStyle: value.S3_FORCE_PATH_STYLE === 'true',
    },
  }
}
```

- [ ] **Step 5: Run tests and type checking**

Run: `cd backend && npm test -- test/unit/env.test.ts && npm run build`

Expected: both commands PASS.

- [ ] **Step 6: Commit the foundation**

```bash
git add backend/package.json backend/package-lock.json backend/tsconfig.json backend/vitest.config.ts backend/src/config/env.ts backend/test/setup.ts backend/test/unit/env.test.ts
git commit -m "test: establish scan backend foundations"
```

---

### Task 2: Define scan domain contracts and state transitions

**Files:**
- Create: `backend/src/modules/scan-runs/domain/scan-run.ts`
- Create: `backend/src/modules/scan-runs/domain/source-policy.ts`
- Create: `backend/src/modules/scan-runs/application/ports.ts`
- Create: `backend/test/unit/scan-run.test.ts`
- Create: `backend/test/unit/source-policy.test.ts`

**Interfaces:**
- Produces: `ScanRunStatus`, `ScanStage`, `assertStageTransition(from, to)`
- Produces: `SourcePolicy.assertAllowedUrl(url, documentBaseUrl?)`
- Produces: `ScanRepository`, `ObjectStore`, `OfficialHttp`, `ScanQueue` interfaces.

- [ ] **Step 1: Write failing state-machine and URL-policy tests**

```ts
import { describe, expect, it } from 'vitest'
import { assertStageTransition } from '../../src/modules/scan-runs/domain/scan-run'
import { SourcePolicy } from '../../src/modules/scan-runs/domain/source-policy'

describe('scan state machine', () => {
  it('allows only the next ordered stage', () => {
    expect(() => assertStageTransition('DISCOVERING', 'DOWNLOADING_DOCUMENTS')).not.toThrow()
    expect(() => assertStageTransition('DISCOVERING', 'VALIDATING')).toThrow('Invalid stage transition')
  })
})

describe('official source policy', () => {
  const policy = new SourcePolicy(['resmigazete.gov.tr', 'www.resmigazete.gov.tr'])

  it('accepts official HTTPS URLs', () => {
    expect(policy.assertAllowedUrl('https://www.resmigazete.gov.tr/eskiler/2026/07/20260711.htm').hostname)
      .toBe('www.resmigazete.gov.tr')
  })

  it.each([
    'http://www.resmigazete.gov.tr/eskiler/2026/07/file.pdf',
    'https://example.com/file.pdf',
    'https://www.resmigazete.gov.tr/eskiler/2026/07/../06/file.pdf',
  ])('rejects unsafe URL %s', (url) => expect(() => policy.assertAllowedUrl(url)).toThrow())
})
```

- [ ] **Step 2: Run tests and verify missing modules**

Run: `cd backend && npm test -- test/unit/scan-run.test.ts test/unit/source-policy.test.ts`

Expected: FAIL because the domain files do not exist.

- [ ] **Step 3: Implement exact domain values and transitions**

Use these values in `scan-run.ts`:

```ts
export type ScanRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED'
export type ScanStage =
  | 'DISCOVERING'
  | 'DOWNLOADING_DOCUMENTS'
  | 'DISCOVERING_ASSETS'
  | 'DOWNLOADING_ASSETS'
  | 'VALIDATING'
  | 'WRITING_MANIFEST'

const stages: ScanStage[] = [
  'DISCOVERING', 'DOWNLOADING_DOCUMENTS', 'DISCOVERING_ASSETS',
  'DOWNLOADING_ASSETS', 'VALIDATING', 'WRITING_MANIFEST',
]

export function assertStageTransition(from: ScanStage, to: ScanStage): void {
  if (stages.indexOf(to) !== stages.indexOf(from) + 1) {
    throw new Error(`Invalid stage transition: ${from} -> ${to}`)
  }
}
```

Define ports in `application/ports.ts` using these signatures:

```ts
export interface StoredBlob {
  sha256: string; bucket: string; objectKey: string; mediaType: string; byteSize: bigint; versionId?: string
}
export interface DownloadedFile {
  tempPath: string; sha256: string; mediaType: string; byteSize: bigint; sourceUrl: string
}
export interface ObjectStore {
  ensureBucket(): Promise<void>
  putContent(file: DownloadedFile): Promise<StoredBlob>
  putRunFile(key: string, body: Buffer, mediaType: string): Promise<StoredBlob>
  exists(key: string): Promise<boolean>
}
export interface OfficialHttp {
  download(url: string, tempDirectory: string): Promise<DownloadedFile>
}
export interface ScanQueue { enqueue(runId: string): Promise<string> }

export interface DiscoveredAsset {
  sourceUrl: string
  role: 'ATTACHMENT' | 'IMAGE' | 'STYLESHEET_ASSET' | 'OTHER_SUPPORTED'
  referenceText?: string
}
export interface DiscoveredDocument {
  title: string
  documentType?: string
  sourceUrl: string
  publicationOrder: number
}
export interface DiscoveredEdition {
  type: 'MAIN' | 'SUPPLEMENT'
  supplementNo: number | null
  indexUrl: string
  discoveryOrder: number
  documents: DiscoveredDocument[]
}
export interface FetchAttemptInput {
  runId: string
  sourceUrl: string
  attemptNo: number
  status: 'SUCCESS' | 'FAILED'
  httpStatus?: number
  redirectUrl?: string
  byteSize?: bigint
  errorClass?: string
  errorMessage?: string
}
export interface ScanRunDetailDto {
  id: string
  status: ScanRunStatus
  currentStage: ScanStage | null
  targetDate: string
  startedAt: string | null
  completedAt: string | null
  errorSummary: string | null
  counts: { editions: number; documents: number; assets: number; completedItems: number; totalItems: number; failedItems: number }
  stages: Array<{ stage: ScanStage; status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'; completedItems: number; totalItems: number; failedItems: number }>
  editions: Array<{ id: string; type: 'MAIN' | 'SUPPLEMENT'; supplementNo: number | null; documents: Array<{ id: string; title: string; sourceUrl: string; validationStatus: 'PENDING' | 'VALID' | 'INVALID'; assetCount: number }> }>
}
export interface CompletedRunSnapshot {
  run: ScanRunDetailDto
  index: { sourceUrl: string; objectKey: string; sha256: string }
  objects: Array<{ documentId?: string; assetId?: string; sourceUrl: string; role?: string; objectKey: string; sha256: string; mediaType: string; byteSize: bigint }>
}

export interface ScanRepository {
  createManualRun(input: { requestKey: string; targetDate: string }): Promise<{ id: string; status: ScanRunStatus; targetDate: string }>
  getRun(runId: string): Promise<ScanRunDetailDto | null>
  claimPendingOutbox(limit: number): Promise<Array<{ id: string; scanRunId: string; attempts: number }>>
  markOutboxDispatched(outboxId: string, queueJobId: string): Promise<void>
  deferOutbox(outboxId: string, error: string, availableAt: Date): Promise<void>
  startRun(runId: string): Promise<void>
  startStage(runId: string, stage: ScanStage, totalItems: number): Promise<void>
  advanceStage(runId: string, stage: ScanStage, downloadedBytes: bigint): Promise<void>
  completeStage(runId: string, stage: ScanStage): Promise<void>
  failStage(runId: string, stage: ScanStage, error: string): Promise<void>
  saveEditions(runId: string, editions: DiscoveredEdition[]): Promise<void>
  attachDocumentObject(documentId: string, object: StoredBlob): Promise<void>
  saveAssets(documentId: string, assets: DiscoveredAsset[]): Promise<void>
  attachAssetObject(assetId: string, object: StoredBlob): Promise<void>
  recordFetchAttempt(attempt: FetchAttemptInput): Promise<void>
  completedSnapshot(runId: string): Promise<CompletedRunSnapshot>
  verifyManifestCounts(runId: string): Promise<void>
  completeRun(runId: string, manifestObjectKey: string): Promise<void>
  failRun(runId: string, status: 'PARTIAL' | 'FAILED', error: string): Promise<void>
}
```

Date and byte fields crossing HTTP/JSON boundaries are strings; internal byte counters are `bigint`. `ScanRunDetailDto` is the single response shape consumed by both GET and SSE.

- [ ] **Step 4: Run tests and commit**

Run: `cd backend && npm test -- test/unit/scan-run.test.ts test/unit/source-policy.test.ts && npm run build`

```bash
git add backend/src/modules/scan-runs backend/test/unit/scan-run.test.ts backend/test/unit/source-policy.test.ts
git commit -m "feat: define manual scan domain contracts"
```

---

### Task 3: Add the auditable PostgreSQL model and durable outbox

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260913190000_add_manual_scan_ingestion/migration.sql` via Prisma
- Create: `backend/src/modules/scan-runs/infrastructure/prisma-scan-repository.ts`
- Create: `backend/test/integration/create-scan-run.test.ts`

**Interfaces:**
- Consumes: domain status and stage strings from Task 2.
- Produces: `PrismaScanRepository.createManualRun(input)` and `claimPendingOutbox(limit)`.
- Produces: a unique `requestKey` idempotency boundary and SHA-256 object deduplication.

- [ ] **Step 1: Extend Prisma with exact ingestion entities**

Add these exact Prisma enums and models:

```prisma
enum ScanTrigger {
  MANUAL
  CRON
}

enum ScanRunStatus {
  QUEUED
  RUNNING
  COMPLETED
  PARTIAL
  FAILED
  CANCELLED
}

enum ScanStage {
  DISCOVERING
  DOWNLOADING_DOCUMENTS
  DISCOVERING_ASSETS
  DOWNLOADING_ASSETS
  VALIDATING
  WRITING_MANIFEST
}

enum EditionType {
  MAIN
  SUPPLEMENT
}

enum ValidationStatus {
  PENDING
  VALID
  INVALID
}

enum AssetRole {
  ATTACHMENT
  IMAGE
  STYLESHEET_ASSET
  OTHER_SUPPORTED
}

enum StageExecutionStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
}

enum FetchAttemptStatus {
  SUCCESS
  FAILED
}

model ScanRun {
  id              String        @id @default(uuid())
  requestKey      String        @unique
  trigger         ScanTrigger   @default(MANUAL)
  targetDate      DateTime      @db.Date
  timezone        String        @default("Europe/Istanbul")
  status          ScanRunStatus @default(QUEUED)
  currentStage    ScanStage?
  totalItems      Int           @default(0)
  completedItems  Int           @default(0)
  failedItems     Int           @default(0)
  downloadedBytes BigInt        @default(0)
  errorSummary    String?
  queueJobId      String?
  startedAt       DateTime?
  completedAt     DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  editions        GazetteEdition[]
  stages          StageExecution[]
  attempts        FetchAttempt[]
  outbox           ScanOutbox?
  @@index([targetDate, createdAt])
  @@index([status, createdAt])
}

model ScanOutbox {
  id           String   @id @default(uuid())
  scanRunId    String   @unique
  scanRun      ScanRun  @relation(fields: [scanRunId], references: [id], onDelete: Cascade)
  attempts     Int      @default(0)
  availableAt  DateTime @default(now())
  dispatchedAt DateTime?
  lastError    String?
  createdAt    DateTime @default(now())
  @@index([dispatchedAt, availableAt])
}

model GazetteEdition {
  id              String      @id @default(uuid())
  scanRunId       String
  scanRun         ScanRun     @relation(fields: [scanRunId], references: [id], onDelete: Cascade)
  publicationDate DateTime    @db.Date
  type            EditionType
  supplementNo    Int?
  indexUrl        String
  discoveryOrder  Int
  documents       Document[]
  @@unique([scanRunId, indexUrl])
}

model Document {
  id             String          @id @default(uuid())
  editionId      String
  edition        GazetteEdition  @relation(fields: [editionId], references: [id], onDelete: Cascade)
  title          String
  documentType   String?
  sourceUrl      String
  publicationOrder Int
  storedObjectId String?
  storedObject   StoredObject?   @relation(fields: [storedObjectId], references: [id])
  validationStatus ValidationStatus @default(PENDING)
  assets         DocumentAsset[]
  @@unique([editionId, sourceUrl])
}

model StoredObject {
  id         String   @id @default(uuid())
  sha256     String   @unique @db.Char(64)
  bucket     String
  objectKey  String   @unique
  mediaType  String
  byteSize   BigInt
  versionId  String?
  createdAt  DateTime @default(now())
  documents  Document[]
  assets     DocumentAsset[]
}

model DocumentAsset {
  id             String       @id @default(uuid())
  documentId     String
  document       Document     @relation(fields: [documentId], references: [id], onDelete: Cascade)
  storedObjectId String?
  storedObject   StoredObject? @relation(fields: [storedObjectId], references: [id])
  sourceUrl      String
  referenceText  String?
  role           AssetRole
  validationStatus ValidationStatus @default(PENDING)
  @@unique([documentId, sourceUrl])
}

model StageExecution {
  id             String               @id @default(uuid())
  scanRunId      String
  scanRun        ScanRun              @relation(fields: [scanRunId], references: [id], onDelete: Cascade)
  stage          ScanStage
  status         StageExecutionStatus @default(PENDING)
  totalItems     Int                  @default(0)
  completedItems Int                  @default(0)
  failedItems    Int                  @default(0)
  errorSummary   String?
  startedAt      DateTime?
  completedAt    DateTime?
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt
  @@unique([scanRunId, stage])
}

model FetchAttempt {
  id           String             @id @default(uuid())
  scanRunId    String
  scanRun      ScanRun            @relation(fields: [scanRunId], references: [id], onDelete: Cascade)
  sourceUrl    String
  attemptNo    Int
  status       FetchAttemptStatus
  httpStatus   Int?
  redirectUrl  String?
  byteSize     BigInt?
  errorClass   String?
  errorMessage String?
  startedAt    DateTime           @default(now())
  completedAt  DateTime?
  createdAt    DateTime           @default(now())
  @@index([scanRunId, createdAt])
}
```

- [ ] **Step 2: Generate and apply the migration locally**

Run:

```bash
cd backend
npx prisma format
npx prisma migrate dev --name add_manual_scan_ingestion
npx prisma generate
```

Expected: migration succeeds against the local PostgreSQL service and Prisma Client contains `scanRun`, `scanOutbox`, `gazetteEdition`, `document`, `storedObject`, `documentAsset`, `stageExecution`, and `fetchAttempt` delegates.

- [ ] **Step 3: Write the failing idempotency integration test**

```ts
it('returns the same run for the same request key', async () => {
  const first = await repository.createManualRun({ requestKey: 'request-1', targetDate: '2026-07-11' })
  const second = await repository.createManualRun({ requestKey: 'request-1', targetDate: '2026-07-11' })
  expect(second.id).toBe(first.id)
  expect(await prisma.scanOutbox.count({ where: { scanRunId: first.id } })).toBe(1)
})
```

- [ ] **Step 4: Implement creation in one database transaction**

`createManualRun` must first query `requestKey`; otherwise it creates the run and its outbox row in one Prisma transaction:

```ts
return prisma.$transaction(async (tx) => {
  const existing = await tx.scanRun.findUnique({ where: { requestKey: input.requestKey } })
  if (existing) return existing
  return tx.scanRun.create({
    data: {
      requestKey: input.requestKey,
      targetDate: new Date(`${input.targetDate}T00:00:00.000Z`),
      timezone: 'Europe/Istanbul',
      outbox: { create: {} },
    },
  })
})
```

- [ ] **Step 5: Run integration tests and commit**

Run: `cd backend && npm test -- test/integration/create-scan-run.test.ts && npm run build`

```bash
git add backend/prisma backend/src/modules/scan-runs/infrastructure/prisma-scan-repository.ts backend/test/integration/create-scan-run.test.ts
git commit -m "feat: persist auditable scan runs and outbox"
```

---

### Task 4: Implement content-addressed S3 storage

**Files:**
- Create: `backend/src/modules/scan-runs/infrastructure/s3-object-store.ts`
- Create: `backend/test/integration/s3-object-store.test.ts`
- Create: `backend/test/helpers/s3.ts`
- Create: `backend/test/helpers/files.ts`

**Interfaces:**
- Consumes: `ObjectStore`, `DownloadedFile`, `StoredBlob`, and `AppEnv`.
- Produces: `S3ObjectStore.ensureBucket`, `putContent`, `putRunFile`, `exists`.
- Object key rule: `objects/sha256/{hash[0..2]}/{hash[2..4]}/{hash}.{extension}`.

- [ ] **Step 1: Create deterministic file and S3 test helpers**

Create `backend/test/helpers/files.ts`:

```ts
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DownloadedFile } from '../../src/modules/scan-runs/application/ports'

export async function fixtureFile(body: string | Buffer, mediaType: string): Promise<DownloadedFile> {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const directory = await mkdtemp(join(tmpdir(), 'atez-test-'))
  const tempPath = join(directory, 'download')
  await writeFile(tempPath, bytes)
  return {
    tempPath,
    mediaType,
    byteSize: BigInt(bytes.byteLength),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sourceUrl: 'https://www.resmigazete.gov.tr/test',
  }
}
```

Create `backend/test/helpers/s3.ts` with an `S3Client` built from `loadEnv()` and:

```ts
export async function countObjects(bucket: string, prefix: string): Promise<number> {
  const response = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }))
  return response.KeyCount ?? 0
}
```

- [ ] **Step 2: Write failing deduplication and key tests**

```ts
it('stores equal bytes at one content-addressed key', async () => {
  const file = await fixtureFile('%PDF-1.7\nfixture', 'application/pdf')
  const first = await store.putContent(file)
  const second = await store.putContent(file)
  expect(second.objectKey).toBe(first.objectKey)
  expect(first.objectKey).toMatch(/^objects\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.pdf$/)
  expect(await countObjects(first.bucket, first.objectKey)).toBe(1)
})
```

- [ ] **Step 3: Run the test against the local S3 endpoint**

Run: `cd backend && npm test -- test/integration/s3-object-store.test.ts`

Expected: FAIL because `S3ObjectStore` does not exist.

- [ ] **Step 4: Implement the S3 adapter**

Construct `S3Client` with `endpoint`, `region`, explicit credentials, and `forcePathStyle`. `putContent` must issue `HeadObject`; only a missing key may trigger `PutObject`. Upload from `createReadStream(file.tempPath)` and pass `ContentType` plus `ChecksumSHA256` derived from the hex digest:

```ts
function contentKey(file: DownloadedFile): string {
  const extension = extensionForMediaType(file.mediaType)
  return `objects/sha256/${file.sha256.slice(0, 2)}/${file.sha256.slice(2, 4)}/${file.sha256}.${extension}`
}
```

Treat `404`, `NotFound`, and `NoSuchKey` as “not present”; rethrow authentication, timeout, and permission errors.

- [ ] **Step 5: Verify integration behavior and commit**

Run: `cd backend && npm test -- test/integration/s3-object-store.test.ts && npm run build`

```bash
git add backend/src/modules/scan-runs/infrastructure/s3-object-store.ts backend/test/integration/s3-object-store.test.ts backend/test/helpers/s3.ts backend/test/helpers/files.ts
git commit -m "feat: add content-addressed S3 storage"
```

---

### Task 5: Build the safe official HTTP downloader

**Files:**
- Create: `backend/src/modules/scan-runs/infrastructure/official-http-client.ts`
- Create: `backend/src/modules/scan-runs/infrastructure/file-validator.ts`
- Create: `backend/test/unit/file-validator.test.ts`
- Create: `backend/test/integration/official-http-client.test.ts`

**Interfaces:**
- Consumes: `SourcePolicy`, `AppEnv`, and the `OfficialHttp` port.
- Produces: validated `DownloadedFile` values backed by per-run temporary files.
- Produces: `detectAndValidate(path, declaredType, url): Promise<{ mediaType: string }>`.

- [ ] **Step 1: Write failing content validation tests**

```ts
it('rejects HTML returned for a PDF URL', async () => {
  const file = await fixtureFile('<html>blocked</html>', 'application/pdf')
  await expect(detectAndValidate(file.tempPath, 'application/pdf', 'https://www.resmigazete.gov.tr/a.pdf'))
    .rejects.toThrow('PDF signature is missing')
})

it('recognizes a PNG by bytes rather than extension', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64')
  const file = await fixtureFile(png, 'application/octet-stream')
  await expect(detectAndValidate(file.tempPath, 'application/octet-stream', 'https://www.resmigazete.gov.tr/a'))
    .resolves.toEqual({ mediaType: 'image/png' })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd backend && npm test -- test/unit/file-validator.test.ts`

Expected: FAIL because the validator does not exist.

- [ ] **Step 3: Implement streamed download, hashing and limits**

The downloader must:

```text
1. Validate the initial URL with SourcePolicy.
2. Wait until 750 ms has elapsed since the previous official request.
3. Request with redirect: "manual" and AbortSignal timeout.
4. Validate every Location before following, with a maximum of three redirects.
5. Stream into a unique mkdtemp directory while computing SHA-256 and byte count.
6. Abort and delete the temporary file when MAX_FILE_BYTES is exceeded.
7. Validate real file bytes; return DownloadedFile only after success.
8. Retry 429/500/502/503/504 using exponential delay plus jitter, at most three attempts.
```

Use this retry classification:

```ts
const retryableStatuses = new Set([429, 500, 502, 503, 504])
const delayMs = Math.min(4_000, 500 * 2 ** (attempt - 1)) + Math.floor(random() * 250)
```

Inject `fetch`, `sleep`, `clock`, and `random` functions so tests are deterministic. Preserve standard Node TLS verification and never configure `rejectUnauthorized: false`.

- [ ] **Step 4: Test redirects, throttling, retries and byte limits**

Add cases proving that an official redirect succeeds, an external redirect fails without a second request, `404` makes one attempt, `503` makes three attempts, and downloads are at least 750 ms apart under the injected clock.

Run: `cd backend && npm test -- test/unit/file-validator.test.ts test/integration/official-http-client.test.ts`

- [ ] **Step 5: Commit the downloader**

```bash
git add backend/src/modules/scan-runs/infrastructure/official-http-client.ts backend/src/modules/scan-runs/infrastructure/file-validator.ts backend/test/unit/file-validator.test.ts backend/test/integration/official-http-client.test.ts backend/test/fixtures
git commit -m "feat: download official files with strict validation"
```

---

### Task 6: Parse editions, documents and in-document assets

**Files:**
- Create: `backend/src/modules/scan-runs/infrastructure/resmi-gazete-parser.ts`
- Create: `backend/test/unit/resmi-gazete-parser.test.ts`
- Create: `backend/test/fixtures/resmi-gazete/2026-07-11/index.html`
- Create: `backend/test/fixtures/resmi-gazete/2026-07-11/document.html`

**Interfaces:**
- Produces: `candidateIndexUrls(date: string): string[]`
- Produces: `parseEditions(html, indexUrl, targetDate): DiscoveredEdition[]`
- Produces: `parseAssets(html, documentUrl): DiscoveredAsset[]`
- `DiscoveredEdition` contains ordered `DiscoveredDocument[]`; assets contain `url`, `role`, and optional `referenceText`.

- [ ] **Step 1: Save minimal sanitized fixtures from the reference collector behavior**

Create `index.html` with four accepted documents, a duplicate and one wrong-date document:

```html
<!doctype html><html><body>
  <a href="./20260711-1.htm">Ana karar</a>
  <a href="./20260711-2.htm">Ana tebliğ</a>
  <a href="./20260711M1-1.htm">1. Mükerrer</a>
  <a href="./20260711M2-1.htm">2. Mükerrer</a>
  <a href="./20260711-1.htm">Tekrarlanan ana karar</a>
  <a href="./20260710-1.htm">Yanlış tarih</a>
</body></html>
```

Create `document.html` with five accepted assets plus unsafe references:

```html
<!doctype html><html><head>
  <base href="https://www.resmigazete.gov.tr/eskiler/2026/07/">
  <style>.seal { background-image: url('./assets/seal.gif'); }</style>
</head><body>
  <img src="./assets/chart.png" alt="Çizelge">
  <img src="./assets/chart.png" alt="Tekrar">
  <picture><source srcset="./assets/chart.webp 1x, ./assets/chart-large.webp 2x"></picture>
  <a href="./attachments/ek.pdf">Ek PDF</a>
  <a href="https://example.com/external.pdf">Haricî bağlantı</a>
  <img src="../outside.png" alt="Dizin dışı">
</body></html>
```

- [ ] **Step 2: Write failing parser tests**

```ts
it('builds daily and archive candidates', () => {
  expect(candidateIndexUrls('2026-07-11')).toEqual([
    'https://www.resmigazete.gov.tr/11.07.2026',
    'https://www.resmigazete.gov.tr/eskiler/2026/07/20260711.htm',
  ])
})

it('keeps ordered same-date main and supplement documents only', () => {
  const editions = parseEditions(indexFixture, archiveUrl, '2026-07-11')
  expect(editions.map((item) => [item.type, item.supplementNo])).toEqual([
    ['MAIN', null], ['SUPPLEMENT', 1], ['SUPPLEMENT', 2],
  ])
  expect(new Set(editions.flatMap((item) => item.documents.map((doc) => doc.sourceUrl))).size)
    .toBe(editions.flatMap((item) => item.documents).length)
})

it('discovers supported official assets and rejects unsafe ones', () => {
  const assets = parseAssets(documentFixture, documentUrl)
  expect(assets.map((asset) => asset.role)).toContain('ATTACHMENT')
  expect(assets.map((asset) => asset.role)).toContain('IMAGE')
  expect(assets.every((asset) => new URL(asset.url).hostname.endsWith('resmigazete.gov.tr'))).toBe(true)
})
```

- [ ] **Step 3: Implement parsing with Cheerio and SourcePolicy**

Resolve URLs in this order: valid `<base href>`, document URL, candidate relative reference. Parse `img[src]`, `source[src]`, comma-separated `srcset`, style attributes, `<style>` blocks and PDF anchors. Deduplicate by normalized absolute URL while preserving first-seen order. Only admit PDF, BMP, GIF, JPEG, PNG and WebP extensions at discovery time; byte validation remains authoritative after download.

- [ ] **Step 4: Run parser tests and commit**

Run: `cd backend && npm test -- test/unit/resmi-gazete-parser.test.ts && npm run build`

```bash
git add backend/src/modules/scan-runs/infrastructure/resmi-gazete-parser.ts backend/test/unit/resmi-gazete-parser.test.ts backend/test/fixtures/resmi-gazete
git commit -m "feat: discover official gazette documents and assets"
```

---

### Task 7: Execute ordered scan stages and write the final manifest

**Files:**
- Create: `backend/src/modules/scan-runs/application/build-manifest.ts`
- Create: `backend/src/modules/scan-runs/application/execute-scan-run.ts`
- Create: `backend/test/unit/build-manifest.test.ts`
- Create: `backend/test/integration/execute-scan-run.test.ts`

**Interfaces:**
- Consumes: all ports, parsers and repository operations from Tasks 2–6.
- Produces: `executeScanRun(runId: string): Promise<void>`.
- Produces: `buildManifest(snapshot: CompletedRunSnapshot): Buffer` with stable ordering.

- [ ] **Step 1: Write the failing happy-path orchestration test**

```ts
it('executes every stage in order and completes after writing the manifest', async () => {
  await executeScanRun('run-1', dependencies)
  expect(repository.stageCalls).toEqual([
    'DISCOVERING', 'DOWNLOADING_DOCUMENTS', 'DISCOVERING_ASSETS',
    'DOWNLOADING_ASSETS', 'VALIDATING', 'WRITING_MANIFEST',
  ])
  expect(objectStore.runFiles.at(-1)?.key).toBe('runs/2026/07/11/run-1/manifest.json')
  expect(repository.finalStatus).toBe('COMPLETED')
})
```

- [ ] **Step 2: Write the failing incomplete-run test**

```ts
it('marks the run partial and never writes a manifest when an asset fails', async () => {
  dependencies.http.failUrl = 'https://www.resmigazete.gov.tr/asset.png'
  await expect(executeScanRun('run-1', dependencies)).rejects.toThrow()
  expect(repository.finalStatus).toBe('PARTIAL')
  expect(objectStore.runFiles.some((file) => file.key.endsWith('/manifest.json'))).toBe(false)
})
```

- [ ] **Step 3: Implement the stage orchestrator**

For each stage, create/update one `StageExecution`, persist progress after each document or asset, and check accumulated run bytes against `MAX_RUN_BYTES`. Use a unique temporary directory per run and remove it in `finally`. Upload `index.html` to `runs/YYYY/MM/DD/{runId}/index.html`; upload content-addressed documents/assets; then create the manifest from the persisted snapshot.

Finalization order must be:

```ts
const manifest = buildManifest(await repository.completedSnapshot(runId))
const storedManifest = await objectStore.putRunFile(manifestKey(run), manifest, 'application/json')
await repository.verifyManifestCounts(runId)
await repository.completeRun(runId, storedManifest.objectKey)
```

On failure, record a sanitized error and choose `PARTIAL` if at least one document/object was saved, otherwise `FAILED`.

- [ ] **Step 4: Implement deterministic manifest output**

The JSON root must contain:

```ts
interface RunManifest {
  schemaVersion: 1
  runId: string
  source: 'RESMI_GAZETE'
  targetDate: string
  createdAt: string
  index: { sourceUrl: string; objectKey: string; sha256: string }
  editions: Array<{
    type: 'MAIN' | 'SUPPLEMENT'; supplementNo: number | null; indexUrl: string
    documents: Array<{
      title: string; sourceUrl: string; objectKey: string; sha256: string; mediaType: string; byteSize: string
      assets: Array<{ sourceUrl: string; role: string; objectKey: string; sha256: string; mediaType: string; byteSize: string }>
    }>
  }>
  totals: { editions: number; documents: number; assets: number; bytes: string }
}
```

Sort editions by discovery order, documents by publication order, and assets by source URL before `JSON.stringify(manifest, null, 2)`.

- [ ] **Step 5: Run orchestration tests and commit**

Run: `cd backend && npm test -- test/unit/build-manifest.test.ts test/integration/execute-scan-run.test.ts && npm run build`

```bash
git add backend/src/modules/scan-runs/application/build-manifest.ts backend/src/modules/scan-runs/application/execute-scan-run.ts backend/test/unit/build-manifest.test.ts backend/test/integration/execute-scan-run.test.ts
git commit -m "feat: orchestrate complete manual ingestion runs"
```

---

### Task 8: Connect the durable outbox, pg-boss worker and real API

**Files:**
- Modify: `backend/src/platform/queue.ts`
- Create: `backend/src/modules/scan-runs/infrastructure/scan-run-queue.ts`
- Create: `backend/src/modules/scan-runs/application/create-scan-run.ts`
- Create: `backend/src/modules/scan-runs/scan-runs.schemas.ts`
- Create: `backend/src/modules/scan-runs/scan-runs.routes.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/worker.ts`
- Delete: `backend/src/modules/jobs/jobs.routes.ts`
- Create: `backend/test/contract/scan-runs.routes.test.ts`

**Interfaces:**
- Produces: `POST /api/v1/scan-runs`, `GET /api/v1/scan-runs/:id`, `GET /api/v1/scan-runs/:id/events`.
- Queue name: `resmi-gazete-manual-scan`.
- SSE event name: `scan.snapshot` with the same DTO returned by the GET endpoint.

- [ ] **Step 1: Write failing POST contract tests**

```ts
it('accepts a valid manual scan and returns 202', async () => {
  const response = await app.inject({
    method: 'POST', url: '/api/v1/scan-runs',
    headers: { 'idempotency-key': '55a7f2ac-2f19-4e1b-b46d-3ca1f1be3d42' },
    payload: { trigger: 'MANUAL', targetDate: '2026-07-11' },
  })
  expect(response.statusCode).toBe(202)
  expect(response.json()).toMatchObject({ status: 'QUEUED', targetDate: '2026-07-11' })
})

it('rejects an invalid calendar date', async () => {
  const response = await app.inject({
    method: 'POST', url: '/api/v1/scan-runs',
    headers: { 'idempotency-key': crypto.randomUUID() },
    payload: { trigger: 'MANUAL', targetDate: '2026-02-30' },
  })
  expect(response.statusCode).toBe(400)
})
```

- [ ] **Step 2: Implement the API schemas and routes**

Validate the idempotency header as UUID and `targetDate` with Luxon:

```ts
const targetDate = z.string().refine(
  (value) => DateTime.fromFormat(value, 'yyyy-MM-dd', { zone: 'Europe/Istanbul' }).isValid,
  'targetDate must be a valid YYYY-MM-DD calendar date',
)
```

When omitted, calculate `DateTime.now().setZone('Europe/Istanbul').toISODate()`. Return `202` for both first and idempotent repeated requests. Return a safe `404` body for an unknown run.

In `app.ts`, remove `jobsRoutes` registration and the API process's `startQueue()` call. Register `scanRunsRoutes` at `/api/v1/scan-runs`; only the worker owns queue startup and job consumption.

- [ ] **Step 3: Implement outbox dispatch and queue consumption**

`worker.ts` must start pg-boss, ensure queue and bucket, recover stale `RUNNING` runs, then:

```ts
await queue.work('resmi-gazete-manual-scan', { batchSize: 1 }, async ([job]) => {
  await executeScanRun(String(job.data.runId), dependencies)
})
```

Run an outbox dispatcher every second. It claims undispatched rows with PostgreSQL `FOR UPDATE SKIP LOCKED`, sends the queue job with singleton key `scanRunId`, then records `queueJobId` and `dispatchedAt`. Failed dispatch increments attempts, records the error, and sets `availableAt` using bounded backoff.

- [ ] **Step 4: Implement SSE snapshots with disconnect cleanup**

The SSE route sends an immediate snapshot and then a changed snapshot at most once per second. End the stream on `COMPLETED`, `PARTIAL`, `FAILED`, or `CANCELLED`; clear timers and listeners when `request.raw` closes. Emit:

```text
event: scan.snapshot
data: {serialized ScanRunDetailDto}

```

- [ ] **Step 5: Run contract tests and remove the test job**

Run: `cd backend && npm test -- test/contract/scan-runs.routes.test.ts && npm run build`

Verify: `rg -n "test-job|/api/jobs/test" backend/src` returns no matches.

- [ ] **Step 6: Commit API and worker wiring**

```bash
git add backend/src backend/test/contract/scan-runs.routes.test.ts
git commit -m "feat: expose and execute manual scan runs"
```

---

### Task 9: Replace frontend mock behavior with truthful manual scan progress

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/features/scans/types.ts`
- Create: `frontend/src/features/scans/api.ts`
- Create: `frontend/src/features/scans/useScanRun.ts`
- Modify: `frontend/src/features/dashboard/TriggerWorkflowModal.tsx`
- Modify: `frontend/src/features/runs/RunDetail.tsx`
- Create: `frontend/src/features/runs/OperationSteps.tsx`
- Create: `frontend/src/features/runs/CollectedDocuments.tsx`
- Create: `frontend/src/features/dashboard/TriggerWorkflowModal.test.tsx`
- Create: `frontend/src/features/runs/RunDetail.test.tsx`
- Create: `frontend/src/test/setup.ts`

**Interfaces:**
- Consumes: scan API DTOs and `scan.snapshot` SSE events from Task 8.
- Produces: real navigation to `/runs/{runId}`, an operations-first detail screen, and no mock fallback.

- [ ] **Step 1: Add frontend test tooling**

Run:

```bash
cd frontend
npm install --save-dev vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

Add `"test": "vitest run"` to `frontend/package.json`. Create `frontend/vitest.config.ts`:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
})
```

Create `frontend/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 2: Write a failing modal test proving no fake navigation**

```tsx
it('keeps the dialog open and shows the backend error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ message: 'Nesne deposuna ulaşılamadı' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  )))
  const onTriggered = vi.fn()
  render(<TriggerWorkflowModal onClose={vi.fn()} onTriggered={onTriggered} />)
  await userEvent.click(screen.getByRole('button', { name: 'Taramayı Başlat' }))
  expect(onTriggered).not.toHaveBeenCalled()
  expect(screen.getByText('Nesne deposuna ulaşılamadı')).toBeVisible()
})
```

- [ ] **Step 3: Implement typed scan API and Istanbul default date**

`createManualScan` must generate one `crypto.randomUUID()` per button action and call:

```ts
fetch('/api/v1/scan-runs', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey },
  body: JSON.stringify({ trigger: 'MANUAL', targetDate }),
})
```

Calculate the modal default with `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' })`. Remove the catch block that calls `onTriggered('job-test')`. Disable close and submit controls while the request is pending, then navigate only with the returned real `runId`.

- [ ] **Step 4: Write failing run-detail tests**

```tsx
it('renders backend operation stages and collected documents', async () => {
  const run = {
    id: 'run-1', status: 'RUNNING', currentStage: 'DOWNLOADING_ASSETS', targetDate: '2026-07-11',
    startedAt: '2026-07-11T04:00:00.000Z', completedAt: null, errorSummary: null,
    counts: { editions: 1, documents: 1, assets: 2, completedItems: 1, totalItems: 2, failedItems: 0 },
    stages: [],
    editions: [{ id: 'edition-1', type: 'MAIN', supplementNo: null, documents: [{
      id: 'document-1', title: 'Örnek Resmî Gazete Kararı', sourceUrl: 'https://www.resmigazete.gov.tr/20260711-1.htm',
      validationStatus: 'VALID', assetCount: 2,
    }] }],
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(run), { status: 200 })))
  vi.stubGlobal('EventSource', class { close() {} addEventListener() {} } as unknown as typeof EventSource)
  render(<MemoryRouter initialEntries={['/runs/run-1']}><Routes><Route path="/runs/:id" element={<RunDetail />} /></Routes></MemoryRouter>)
  expect(await screen.findByText('Varlıklar indiriliyor')).toBeVisible()
  expect(screen.getByText('Örnek Resmî Gazete Kararı')).toBeVisible()
  expect(screen.queryByText('39 gümrük & dış ticaret maddesi')).not.toBeInTheDocument()
})

it('shows a real not-found state instead of dummy data', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
  render(<MemoryRouter initialEntries={['/runs/missing']}><Routes><Route path="/runs/:id" element={<RunDetail />} /></Routes></MemoryRouter>)
  expect(await screen.findByText('Tarama bulunamadı')).toBeVisible()
  expect(screen.queryByText('PET Resin')).not.toBeInTheDocument()
})
```

- [ ] **Step 5: Implement the operations-first run screen**

`useScanRun` first fetches the GET endpoint, opens `EventSource`, merges each `scan.snapshot`, and falls back to a five-second GET poll after SSE error. Stop polling at terminal status and on unmount.

`OperationSteps` renders exactly these labels in order:

```ts
const labels = {
  DISCOVERING: 'Resmî Gazete yayınları bulunuyor',
  DOWNLOADING_DOCUMENTS: 'Belgeler indiriliyor',
  DISCOVERING_ASSETS: 'Belge ekleri bulunuyor',
  DOWNLOADING_ASSETS: 'Varlıklar indiriliyor',
  VALIDATING: 'Dosyalar doğrulanıyor',
  WRITING_MANIFEST: 'Tarama kaydı tamamlanıyor',
}
```

Remove `DUMMY_RUN_DETAILS`, hard-coded counts, relevance analysis, report cards and email sections from `RunDetail.tsx`. Keep the dashboard cron visual unchanged.

- [ ] **Step 6: Run frontend tests, lint and build**

Run: `cd frontend && npm test && npm run lint && npm run build`

Expected: all commands PASS and `rg -n "DUMMY_RUN_DETAILS|job-test|/api/jobs/test" frontend/src` returns no matches.

- [ ] **Step 7: Commit frontend integration**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/src/features frontend/src/test/setup.ts
git commit -m "feat: show truthful manual scan progress"
```

---

### Task 10: Make local Docker and deployment configuration reproducible

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.prod.yml`
- Create: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Local S3 endpoint: `http://object-storage:9000` inside Compose.
- Local bucket: `resmi-gazete` created idempotently by API/worker startup.
- Frontend: `http://localhost:8888`; API remains proxied under `/api`.

- [ ] **Step 1: Replace the Alpine backend runtime that breaks Prisma OpenSSL loading**

Use this `backend/Dockerfile`; it retains `tsx` and Prisma CLI because the same image runs both TypeScript entrypoints and migrations:

```dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node --from=build /app/package.json /app/package-lock.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/src ./src
USER node
EXPOSE 3001
CMD ["npm", "run", "start:api"]
```

- [ ] **Step 2: Add the pinned local object store and separate API/worker services**

Use the locally verified MinIO image digest:

```yaml
object-storage:
  image: minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e
  command: server /data --console-address :9001
  environment:
    MINIO_ROOT_USER: ${S3_ACCESS_KEY_ID:-atez-local-access}
    MINIO_ROOT_PASSWORD: ${S3_SECRET_ACCESS_KEY:-atez-local-secret-change-me}
  ports:
    - "9000:9000"
    - "9001:9001"
  volumes:
    - miniodata:/data
```

Create separate `backend` and `worker` services from the same image, with `npm run start:api` and `npm run start:worker`. Supply identical database and S3 environment variables. Add `miniodata` to named volumes. Do not expose object-store credentials to the frontend.

- [ ] **Step 3: Document exact local commands and production differences**

Create `.env.example` with safe development values:

```dotenv
DATABASE_URL=postgresql://atez:atezpassword@db:5432/atez_db?schema=public
PORT=3001
SCAN_TIMEZONE=Europe/Istanbul
SOURCE_HOSTS=resmigazete.gov.tr,www.resmigazete.gov.tr
SOURCE_DELAY_MS=750
SOURCE_TIMEOUT_MS=30000
SOURCE_MAX_ATTEMPTS=3
MAX_FILE_BYTES=104857600
MAX_RUN_BYTES=2147483648
S3_ENDPOINT=http://object-storage:9000
S3_REGION=eu-central-1
S3_BUCKET=resmi-gazete
S3_ACCESS_KEY_ID=atez-local-access
S3_SECRET_ACCESS_KEY=atez-local-secret-change-me
S3_FORCE_PATH_STYLE=true
```

README must document:

```bash
docker compose up --build -d
docker compose exec backend npm run prisma:migrate
docker compose logs -f backend worker
```

State that the pinned MinIO container is for development only. Production uses its S3 endpoint, region, bucket and credentials from the deployment secret store, with `S3_FORCE_PATH_STYLE=false`; production Compose must not embed access keys or run a local object-store service.

- [ ] **Step 4: Verify the complete local stack**

Run:

```bash
docker compose config
docker compose up --build -d
docker compose ps
curl --fail http://localhost:8888/api/health
```

Expected: Compose config validates; PostgreSQL, object storage, backend, worker and frontend remain running; health returns HTTP 200 and reports database, queue and object-store readiness.

- [ ] **Step 5: Commit deployment configuration**

```bash
git add backend/Dockerfile docker-compose.yml docker-compose.prod.yml .env.example README.md
git commit -m "build: run scans with PostgreSQL and S3 storage"
```

---

### Task 11: Run final acceptance and regression verification

**Files:**
- Modify only files required by failures discovered in this task.
- Create: `backend/test/acceptance/manual-scan.test.ts`

**Interfaces:**
- Exercises the public HTTP API, worker, PostgreSQL and S3-compatible store as one system.

- [ ] **Step 1: Add a deterministic fixture-backed acceptance mode**

Inject the official HTTP adapter into the application composition root. In the acceptance test, supply an adapter that serves the saved 2026-07-11 fixtures while retaining the real parser, validator, repository, queue and S3 adapter.

- [ ] **Step 2: Write the acceptance assertions**

```ts
expect(finalRun.status).toBe('COMPLETED')
expect(finalRun.editions.map((edition) => edition.type)).toEqual(['MAIN', 'SUPPLEMENT', 'SUPPLEMENT'])
expect(finalRun.counts.documents).toBe(4)
expect(finalRun.counts.assets).toBe(5)
expect(await objectExists(finalRun.manifestObjectKey)).toBe(true)
expect(await allStoredObjectsHaveValidSha256()).toBe(true)
```

Submit the same idempotency key twice and assert one run; submit a new key for the same date and assert a second run with no duplicate `StoredObject.sha256` rows.

- [ ] **Step 3: Run all automated verification**

Run:

```bash
cd backend && npm test && npm run build
cd ../frontend && npm test && npm run lint && npm run build
cd .. && docker compose config
```

Expected: every command exits 0.

- [ ] **Step 4: Perform one controlled live-source smoke test**

Start a manual scan for a known Resmî Gazete publication date. Verify that the run reaches a terminal state, every requested URL uses an approved HTTPS host, the manifest totals match PostgreSQL, and object-store checksums match recorded SHA-256 values. If the live source is unavailable, record the external failure separately; do not weaken TLS, host or content validation to make the smoke test pass.

- [ ] **Step 5: Confirm the UI has no fabricated state**

Stop the backend, press “Taramayı Başlat,” and verify the dialog shows a real connection error and does not navigate. Restart the backend, perform a fixture-backed run, and verify `OperationSteps` progresses in order and the collected document list matches the API response.

- [ ] **Step 6: Commit acceptance coverage**

```bash
git add backend/test/acceptance/manual-scan.test.ts
git commit -m "test: verify manual gazette ingestion end to end"
```

---

## Completion Gate

Implementation is complete only when all eleven task-level checks pass, the full backend and frontend suites are green, Docker services remain healthy, the fixture-backed scan produces a valid manifest, a deliberate rescan reuses stored content by SHA-256, and no code path fabricates success when the API, source or object store fails.
