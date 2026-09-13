# Previous Source Discovery Design

**Date:** 2026-09-14
**Status:** Approved in conversation
**Scope:** Prepare verified preceding Resmi Gazete sources for every final `IN` document before deep analysis.

## Goal

After document filtering and archival, create one independent source-discovery work item for every final `IN` document. A short Gemini call extracts the identity of the regulation being amended. A deterministic Resmi Gazete adapter then searches, verifies, downloads, and archives the nearest preceding matching publication and its supported assets.

## Non-goals

- Producing the final legal/operational analysis JSON.
- Producing bulletin HTML, email drafts, or chat history.
- Reconstructing the entire historical consolidation chain in the first release.
- Treating an unverified search result as an authoritative preceding source.

## Pipeline Position

The scan stages become:

1. `DISCOVERING`
2. `AI_FILTERING`
3. `DOWNLOADING_DOCUMENTS`
4. `DISCOVERING_ASSETS`
5. `DOWNLOADING_ASSETS`
6. `VALIDATING`
7. `DISCOVERING_PREVIOUS_SOURCES`
8. `WRITING_MANIFEST`

Only documents with a final filter decision of `IN` receive a source-discovery job. Jobs run concurrently with a configured limit, persist their own status, and do not repeat completed work when another document fails.

## Short AI Preflight

The preflight receives the stable document ID, title, publication date, source URL, document type, and normalized visible text. Images and attachments are not sent during this inexpensive decision step; they remain archived for the later deep analysis.

The response is strict structured JSON:

```json
{
  "needsPreviousSource": true,
  "relationship": "AMENDS",
  "targetRegulationTitle": "Ithalatta Gozetim Uygulanmasina Iliskin Teblig",
  "targetRegulationIdentifier": "2018/5",
  "targetRegulationType": "TEBLIG",
  "targetInstitution": "Ticaret Bakanligi",
  "targetArticleReferences": ["1 inci madde", "tablo"],
  "queryCandidates": ["2018/5", "Ithalatta Gozetim Uygulanmasina Iliskin Teblig"],
  "reason": "The current publication changes the table in article 1."
}
```

`relationship` is one of `AMENDS`, `REPEALS`, `EXTENDS`, `IMPLEMENTS`, or `NONE`. If `needsPreviousSource` is false, `relationship` must be `NONE` and search fields may be null or empty. Prompt version, model, configuration hash, input hash, request ID, latency, and token usage are persisted. Raw source bytes and secrets are not duplicated in the database.

## Official Search and Matching

The adapter calls `POST https://www.resmigazete.gov.tr/Home/Filter` with title search mode and an end date one day before the current publication. Query candidates are tried in order, with the exact regulation identifier first.

The `2018/5` case establishes these rules:

- Identifier matching uses token boundaries, so `2018/5` does not match `2018/5552`.
- Exact target identifier and compatible regulation type are hard verification signals.
- Normalized base-title similarity and chronology rank verified candidates.
- The closest earlier verified publication wins.
- The first raw search result is never accepted without verification.

Search outcomes are `NOT_REQUIRED`, `VERIFIED`, `NOT_FOUND`, or `AMBIGUOUS`. `NOT_FOUND` and `AMBIGUOUS` are completed business outcomes and remain visible to later analysis; provider, network, parsing, and storage failures are retryable technical failures.

For a `/fihrist` result, the adapter derives the dated archive index, downloads it through the existing official HTTP policy, and selects the anchor whose text contains the exact identifier and compatible normalized title. It then downloads the direct HTML/PDF. For HTML, supported linked PDF/BMP/GIF/JPEG/JPG/PNG/WebP assets are discovered and archived with the same safe parser and object store used for current documents.

## Persistence

`PreviousSourceJob` is unique per current document and stores lifecycle, model/prompt audit, structured intent, outcome, and sanitized error information.

`PreviousSourceCandidate` stores every evaluated candidate, its official metadata, component scores, verification reasons, and whether it was selected.

`PreviousSourceDocument` stores the selected official source identity and points to the content-addressed `StoredObject`. `PreviousSourceAsset` stores supported assets discovered from a preceding HTML source and also points to `StoredObject`.

Existing current-document records are not duplicated. The later deep-analysis input builder will join the current `CollectedDocument` and `DocumentAsset` records with the selected `PreviousSourceDocument` and its assets.

## Failure and Retry

Gemini provider errors use the existing stable error categories and automatic retry policy. When attempts are exhausted, only that document job becomes `AWAITING_RETRY`. Other document jobs finish and stay persisted. The parent stage and scan run become `AWAITING_RETRY` when at least one source job needs retry.

`POST /api/v1/scan-runs/:runId/previous-sources/retry` creates an idempotent `RETRY_PREVIOUS_SOURCES` command. Resume executes only incomplete jobs, then writes the manifest and completes the original run.

## UI Contract

The Operation Steps list adds `Onceki kaynaklar hazirlaniyor` after validation. Progress is based on final `IN` documents. The run detail returns each relevant document's source-discovery status and selected preceding source metadata. Confidence and internal matching scores are retained for audit but not displayed.

## Security and Correctness

- Only allow-listed Resmi Gazete HTTPS URLs may be requested.
- Existing redirect, size, MIME, hashing, and content-addressed storage controls apply.
- API keys, raw provider error bodies, and full prompts are never persisted or returned.
- A preceding source is reportable only when its outcome is `VERIFIED`.
- Later analysis must not claim a before/after comparison from `NOT_FOUND` or `AMBIGUOUS` outcomes.

