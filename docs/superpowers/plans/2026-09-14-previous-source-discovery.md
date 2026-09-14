# Previous Source Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a resumable, per-document source-discovery stage that extracts preceding-regulation search intent with Gemini and archives a verified preceding Resmi Gazete document and supported assets.

**Architecture:** Insert `DISCOVERING_PREVIOUS_SOURCES` after current-source validation. Persist one independent job per final `IN` document, execute jobs concurrently with a limit, use a provider-neutral short AI preflight followed by deterministic official search/matching, and resume only incomplete jobs after an idempotent retry.

**Tech Stack:** TypeScript, Fastify, Prisma/PostgreSQL, Gemini structured output, Resmi Gazete `/Home/Filter`, MinIO/S3, Cheerio, Vitest, React.

**Spec:** `docs/superpowers/specs/2026-09-14-previous-source-discovery-design.md`

## Global Constraints

- Process only final `IN` documents.
- Keep each document job independently persisted and resumable.
- Run document jobs concurrently with a configurable maximum.
- Prefer the exact target regulation identifier, using token-boundary matching.
- Never accept the first raw result without deterministic verification.
- Archive a verified preceding document and all supported HTML assets in MinIO.
- Treat `NOT_FOUND` and `AMBIGUOUS` as completed source outcomes, not provider failures.
- Do not implement deep analysis or report generation in this plan.
- Automated tests must not call Gemini or Resmi Gazete.

---

### Task 1: Add source-discovery domain state and persistence

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260914020000_add_previous_source_discovery/migration.sql`
- Modify: `backend/src/modules/scan-runs/domain/scan-run.ts`
- Modify: `backend/src/modules/scan-runs/application/ports.ts`
- Test: `backend/test/unit/scan-run.test.ts`

**Interfaces:**
- Produces scan stage `DISCOVERING_PREVIOUS_SOURCES` after `VALIDATING`.
- Produces Prisma models `PreviousSourceJob`, `PreviousSourceCandidate`, `PreviousSourceDocument`, and `PreviousSourceAsset`.
- Produces command `RETRY_PREVIOUS_SOURCES`.

- [ ] Write a failing stage-order test and a schema-level repository test proving one job is created for each final `IN` document and none for `OUT` documents.
- [ ] Run the focused tests and confirm failure is caused by the missing stage/models.
- [ ] Add enums, relations, indexes, migration SQL, DTOs, and repository ports.
- [ ] Generate the Prisma client, apply the migration, and make the focused tests pass.

### Task 2: Implement and validate the short preflight contract

**Files:**
- Create: `backend/src/modules/scan-runs/application/previous-source-schemas.ts`
- Create: `backend/src/modules/scan-runs/application/previous-source-prompts.ts`
- Create: `backend/test/unit/previous-source-prompts.test.ts`

**Interfaces:**
- Produces `buildPreviousSourcePreflightRequest(input, model)`.
- Produces `parsePreviousSourcePreflightResponse(raw)`.

- [ ] Write failing tests for the `2018/5` example, nullable non-search output, invalid relationship combinations, and capped query/article arrays.
- [ ] Run the tests and confirm the modules are missing.
- [ ] Implement a versioned prompt and strict Zod parser with cross-field validation.
- [ ] Run the focused tests until green.

### Task 3: Implement official search, exact matching, and fihrist resolution

**Files:**
- Create: `backend/src/modules/scan-runs/application/previous-source-matcher.ts`
- Create: `backend/src/modules/scan-runs/infrastructure/resmi-gazete-search.ts`
- Modify: `backend/src/modules/scan-runs/application/ports.ts`
- Create: `backend/test/unit/previous-source-matcher.test.ts`
- Create: `backend/test/integration/resmi-gazete-search.test.ts`

**Interfaces:**
- Produces `selectPreviousSource(current, intent, candidates)` returning `VERIFIED`, `NOT_FOUND`, or `AMBIGUOUS` plus audited candidate scores.
- Produces `ResmiGazeteSearch.search(query)` and `resolveDocumentUrl(candidate, intent)`.

- [ ] Write a failing test proving exact `2018/5` selects the 2025 teblig and rejects `2018/5552` court decisions.
- [ ] Write a failing boundary test for `/Home/Filter` request payload and `20251231M4.htm` to `20251231M4-39.pdf` resolution.
- [ ] Implement normalization, identifier boundaries, type compatibility, title similarity, chronology, ambiguity margin, official POST request, and fihrist parsing.
- [ ] Run focused tests until green.

### Task 4: Execute independent jobs, archive sources, and support retry

**Files:**
- Create: `backend/src/modules/scan-runs/application/execute-previous-source-discovery.ts`
- Modify: `backend/src/modules/scan-runs/infrastructure/prisma-scan-repository.ts`
- Modify: `backend/src/modules/scan-runs/application/execute-scan-run.ts`
- Modify: `backend/src/modules/scan-runs/infrastructure/scan-run-queue.ts`
- Modify: `backend/src/modules/scan-runs/scan-runs.routes.ts`
- Modify: `backend/src/worker.ts`
- Modify: `backend/src/config/env.ts`
- Modify: `docker-compose.yml`
- Create: `backend/test/integration/execute-previous-source-discovery.test.ts`
- Modify: `backend/test/integration/execute-scan-run.test.ts`
- Modify: `backend/test/contract/scan-runs.routes.test.ts`

**Interfaces:**
- Produces `executePreviousSourceDiscovery(runId, dependencies)` with bounded concurrency and resumability.
- Produces `POST /api/v1/scan-runs/:runId/previous-sources/retry`.

- [ ] Write failing integration tests for IN-only creation, concurrent independent completion, `NOT_REQUIRED`, verified HTML/PDF archival, partial provider failure, and resume without repeating completed jobs.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement repository transactions and per-job AI-call audit.
- [ ] Implement content materialization, search, matching, direct-source download, asset discovery/download, and outcome persistence.
- [ ] Insert fan-out/fan-in into the scan runner and add the retry command/route.
- [ ] Run focused integration and contract tests until green.

### Task 5: Expose progress, update the manifest, and render the operation step

**Files:**
- Modify: `backend/src/modules/scan-runs/application/build-manifest.ts`
- Modify: `backend/src/modules/scan-runs/application/ports.ts`
- Modify: `backend/src/modules/scan-runs/infrastructure/prisma-scan-repository.ts`
- Modify: `frontend/src/features/scans/types.ts`
- Modify: `frontend/src/features/scans/api.ts`
- Modify: `frontend/src/features/runs/OperationSteps.tsx`
- Modify: `frontend/src/features/runs/RunDetail.tsx`
- Modify: `frontend/src/features/runs/CollectedDocuments.tsx`
- Modify: `frontend/src/features/runs/RunDetail.test.tsx`
- Modify: `backend/test/unit/build-manifest.test.ts`

**Interfaces:**
- Adds safe `previousSources` progress and document outcome data to the run-detail DTO.
- Adds preceding-source audit metadata and stored-object references to manifest schema version 3.

- [ ] Write failing backend and frontend tests for progress, verified source metadata, retry UI, and absence of internal confidence scores.
- [ ] Run focused tests and confirm expected failures.
- [ ] Extend DTO/manifest builders and the run-detail UI.
- [ ] Run backend and frontend focused tests until green.

### Task 6: Full verification and live case smoke test

**Files:**
- Modify only files required by failures discovered in verification.

- [ ] Generate Prisma, run all backend tests, and run the backend typecheck.
- [ ] Run all frontend tests and the production frontend build.
- [ ] Rebuild Docker services and confirm health.
- [ ] Run the approved 2026-07-11 case and verify `2018/5` resolves to `20251231M4-39.pdf`, with archived current `image002.jpg` and preceding PDF.
- [ ] Inspect git diff for scope, secrets, generated noise, and unrelated changes.
