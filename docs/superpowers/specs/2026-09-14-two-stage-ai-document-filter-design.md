# Two-Stage AI Document Filter Design

**Date:** 2026-09-14
**Status:** Approved in conversation
**Scope:** Add the second operation step to manual Resmî Gazete runs. The step classifies collected documents for customs and foreign-trade relevance with Gemini 3.8 Flash.

## Goals

- Classify every discovered Resmî Gazete document using semantic AI reasoning rather than exact keyword matching.
- Send all document titles in one first-pass request and produce `IN`, `OUT`, or `MAYBE` for every document.
- Send the contents of first-pass `MAYBE` documents through a second pass that must produce a final `IN` or `OUT`.
- Download and archive every document regardless of its classification.
- Make Gemini failures diagnosable and allow a user to retry the filter without creating another run or repeating completed downloads.
- Create a reusable Gemini integration boundary for future report, revision, email-draft, and conversational features without coupling those features to the filter.
- Keep the filter stateless. Conversation history is not needed for classification.

## Non-goals

- Building the report, report-revision, email-draft, or general chat experiences.
- Creating a general-purpose agent framework or workflow designer.
- Showing confidence scores in the UI.
- Using keyword matches as hard inclusion or exclusion rules.
- Filtering which source documents are archived.

## Architectural Direction

The system will use a shared Gemini infrastructure adapter behind an application port. Domain-specific AI use cases remain separate:

- `DocumentFilterService` owns stateless title and content classification.
- Future report and revision jobs will own their own prompts, state, and job lifecycles.
- Future user chat will have separate conversation and message persistence. It may reuse the low-level Gemini client and configuration, but it will not reuse filter job state.

This avoids embedding provider calls in the scan orchestrator and avoids prematurely building a generic agent platform. The boundary permits replacing Gemini or testing without external API traffic.

Gemini 3.7 Flash is addressed by the stable model ID `gemini-3.7-flash`. Structured output is required for both filtering passes.

## Operation Flow

The ordered scan stages become:

1. `DISCOVERING`
2. `AI_FILTERING`
3. `DOWNLOADING_DOCUMENTS`
4. `DISCOVERING_ASSETS`
5. `DOWNLOADING_ASSETS`
6. `VALIDATING`
7. `WRITING_MANIFEST`

### First pass: titles

After discovery, all persisted documents are sent in one request. Each item contains only a stable internal document ID, publication order, edition information, and title. The prompt includes the business scope and the versioned keyword guide.

The response must contain exactly one result for every supplied document ID:

```json
{
  "decisions": [
    {
      "documentId": "uuid",
      "decision": "IN | OUT | MAYBE",
      "reason": "short Turkish explanation",
      "confidence": 0.0
    }
  ]
}
```

Confidence is constrained to `0..1`, persisted for audit and evaluation, and omitted from user-facing API responses and UI components.

The entire response is rejected if an ID is missing, duplicated, unknown, or associated with an unsupported decision. Results are persisted only after the complete response validates, preventing partial first-pass state.

### Second pass: ambiguous documents

If there are no `MAYBE` results, the filter finishes immediately. Otherwise:

1. Each `MAYBE` document is downloaded through the existing safe official-source HTTP client.
2. The original bytes are saved in MinIO and attached to the existing document record.
3. HTML is normalized to visible text while retaining headings, paragraphs, list items, and table content. PDF or other Gemini-supported document formats are supplied as document input.
4. Content is sent with the stable document ID, title, first-pass reason, and the same business scope.
5. The structured response permits only `IN` or `OUT`.

When all ambiguous contents fit below the configured safe input budget, they are submitted together. Otherwise, they are split into deterministic batches. Successful batches are persisted and are not repeated after a later batch failure.

Only the main document content is used by this filtering step. Linked images and attachments are still discovered, downloaded, and archived by the subsequent scan stages; richer multimodal analysis belongs to the later document-analysis jobs.

### Continuing the scan

After the final filter decisions are stored, document downloading resumes. Documents already downloaded for second-pass filtering are detected by their attached stored object and skipped. Every remaining document, including final `OUT` documents, is downloaded and archived. Asset discovery, asset downloading, validation, and manifest writing proceed unchanged.

The manifest will include each document's final filter decision, decision reasons, prompt version, and model ID, but not the API key or duplicated full prompts.

Only final `IN` documents are eligible for future per-document analysis jobs. Each such document will become an independent job/work item so unrelated legislation changes are not combined. That downstream job creation is outside this implementation.

## Prompt and Keyword Configuration

The supplied `keywords.yaml` is copied into the repository as a versioned filter configuration. Its levels are interpreted as contextual signals:

- `l1`: strong customs and foreign-trade relevance signals.
- `l2`: context-dependent signals that often require semantic interpretation.
- `l3`: common irrelevance signals.

The prompt explicitly says these are examples, not exact-match rules. Gemini must consider synonyms, legal context, regulatory effect, institutions, goods, trade flows, and customs procedures even when none of the keywords appears verbatim.

Prompts have explicit versions such as `document-filter-title-v1` and `document-filter-content-v1`. The version and a configuration fingerprint are persisted with every AI job. Prompt changes therefore remain auditable and can be evaluated against older decisions.

## Persistence Model

### `AiJob`

Represents one logical AI operation for a run.

- `id`
- `scanRunId`
- `kind`: initially `DOCUMENT_FILTER`
- `status`: `QUEUED`, `RUNNING`, `COMPLETED`, `AWAITING_RETRY`, `FAILED`
- `model`
- `titlePromptVersion`
- `contentPromptVersion`
- `configurationHash`
- `startedAt`, `completedAt`, `createdAt`, `updatedAt`
- `lastErrorCategory`, `lastErrorMessage`

There is one active document-filter job per scan run.

### `AiCall`

Represents an actual provider request or retry attempt.

- `id`, `aiJobId`
- `phase`: `TITLE` or `CONTENT`
- deterministic `batchKey`
- `attemptNo`
- `status`
- `providerRequestId`
- `inputHash`
- latency and token-usage fields when returned by Gemini
- sanitized response metadata
- error category, provider status, and sanitized error message
- timestamps

The original source content remains in MinIO. `AiCall` stores fingerprints and operational metadata rather than duplicating entire documents or secrets.

### `DocumentFilterDecision`

One record per collected document and filter job:

- `documentId`, `aiJobId`
- `titleDecision`: `IN`, `OUT`, or `MAYBE`
- `titleReason`, `titleConfidence`
- `contentDecision`: nullable `IN` or `OUT`
- `contentReason`, `contentConfidence`
- `finalDecision`: `IN` or `OUT`
- timestamps

For first-pass `IN` and `OUT`, `finalDecision` equals `titleDecision`. For `MAYBE`, it remains unset until a valid second-pass response is stored.

## Run and Stage State

`AI_FILTERING` is added to `ScanStage`. A run that exhausts provider retries during this stage moves to `AWAITING_RETRY`, and the filter stage also exposes `AWAITING_RETRY`. This state is stable: the worker stops, downloaded data remains intact, and live updates close cleanly.

Retrying transitions the same run and AI job back to queued/running state. The orchestrator resumes from the incomplete filter phase or batch; it does not repeat discovery, completed Gemini batches, stored document downloads, or earlier decisions.

A permanent internal invariant failure that cannot be corrected by another provider call uses `FAILED`. Provider authentication, quota, congestion, timeout, and invalid structured responses remain retryable after configuration or service conditions change.

## Provider Error Handling

The Gemini adapter maps errors to stable internal categories:

- `AUTHENTICATION`
- `PERMISSION`
- `QUOTA_EXCEEDED`
- `RATE_LIMITED`
- `PROVIDER_UNAVAILABLE`
- `TIMEOUT`
- `INVALID_RESPONSE`
- `CONTENT_REJECTED`
- `UNKNOWN_PROVIDER_ERROR`

Timeouts, rate limits, and 5xx failures receive up to three automatic attempts using exponential backoff with jitter. Invalid structured output is retried with a corrective instruction within the same maximum. Authentication and permission errors stop immediately because repetition without configuration changes is not useful.

The persisted and displayed message explains whether the likely cause is an invalid key, quota, temporary congestion, timeout, safety rejection, or response-format failure. Raw provider bodies are sanitized, and `GEMINI_API_KEY` is never returned, logged, or persisted.

## Retry API and UI

`POST /api/v1/scan-runs/:runId/ai-filter/retry` accepts an `Idempotency-Key`. It succeeds only when the run and filter job are in `AWAITING_RETRY`. The transaction records a retry command and outbox item so enqueueing remains reliable. Repeating the same request key does not create another attempt.

The run-detail response adds:

- filter status and final `IN`/`OUT`/pending counts;
- document-level title and final decisions with short reasons;
- a sanitized filter error category and message;
- whether manual retry is currently available.

The Operation Steps component shows AI filtering as step second row. When waiting for retry it displays the diagnosis and a `Tekrar Dene` button. The button disables while a request is in flight, prevents duplicate submission, and reconnects to run updates after the retry is accepted. Confidence values are never shown.

## Gemini Configuration

The worker receives configuration through server-side environment variables:

- `GEMINI_API_KEY`
- `GEMINI_MODEL=gemini-3.7-flash`
- request timeout and automatic attempt count
- safe content input budget

The key is placed only in the untracked local environment or deployment secret manager. It is not compiled into the frontend or committed to the repository.

## Testing Strategy

Tests follow red-green-refactor and use a fake `AiModelClient`; ordinary test runs never spend Gemini quota.

- Domain tests verify stage ordering and legal state transitions.
- Prompt tests verify that the full title set, stable IDs, scope, and keyword context are included.
- Schema tests reject missing, duplicate, unknown, and illegal decisions, including second-pass `MAYBE`.
- Service tests cover no-`MAYBE`, mixed results, content batching, final decisions, and download reuse.
- Adapter tests cover structured request construction and every provider error mapping.
- Retry tests verify automatic attempt limits and exponential backoff behavior without real waiting.
- Repository and contract tests verify atomic decision persistence, `AWAITING_RETRY`, idempotent retry commands, and resumability.
- Worker integration tests fail a later content batch, retry, and prove earlier discovery, decisions, and downloads are not repeated.
- Frontend tests verify the second operation row, diagnosis, retry button behavior, reconnect, counts, reasons, and absence of confidence values.
- A manually authorized smoke run with the user's API key verifies the real Gemini model after automated tests pass.

## Operational and Security Constraints

- Only the backend worker calls Gemini.
- All model outputs are treated as untrusted and validated against strict schemas.
- Source document IDs, not model-produced URLs, determine database updates.
- Logs use correlation IDs and error categories without document bodies, prompts, or secrets.
- Each call records latency and available token usage to support later cost monitoring.
- The first release does not use Gemini conversation history, Files API persistence, context caching, RAG, or tool calling. Those capabilities can be introduced independently when report revision or conversational access requires them.

## Acceptance Criteria

- AI filtering is the second visible and executable scan stage.
- One first-pass Gemini request classifies all titles as `IN`, `OUT`, or `MAYBE`.
- Every `MAYBE` obtains a final `IN` or `OUT` from document content.
- All source documents and supported assets are still archived.
- Final decisions and reasons are visible; confidence is stored but not visible.
- A diagnosable Gemini failure leaves the run resumable in `AWAITING_RETRY`.
- Manual retry continues the same run without repeating completed work.
- The API key remains server-side and out of persistence and logs.
- The Gemini integration can later support separate report jobs and chat infrastructure without using filter history as conversation history.
