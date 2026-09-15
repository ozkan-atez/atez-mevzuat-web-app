# Conversation Workspace Design

## Goal

Replace the placeholder `/chat` SSE test with a persistent, ChatGPT-style conversation workspace. A message submitted from the global docked assistant outside a report page must transition smoothly into the workspace, preserve the first message, show the generated answer, and allow the conversation to continue without returning to the dashboard.

## Scope

The feature covers general assistant conversations and a unified history view. It does not change the semantics of report revision prompts, draft approval, publishing, or topic analysis.

General conversations answer from the configured Gemini model and their conversation context. Retrieval-augmented search over stored gazette documents is not part of this iteration.

## Existing Constraints

- `feat/report-revision-editing` is the implementation base.
- Report pages register an `ActiveReport`; prompts submitted while a report is active must continue to use the existing revision workflow.
- `AnalysisThread` and `ChatMessage` are audit records for topic analysis and report revisions. Their lifecycle must remain unchanged.
- The current `ChatSession` model is incomplete and has no message relation.
- The current `/api/chat/stream` endpoint and `ChatScreen` are placeholders and must be replaced.
- The application uses React, React Router, Tailwind CSS, Fastify, Prisma/PostgreSQL, Vitest, and the existing Gemini infrastructure.

## Architecture

### Conversation aggregate

General chat uses its own aggregate instead of making the revision-oriented `AnalysisThread` polymorphic:

- `ChatSession`: id, optional owner id, generated title, created timestamp, updated timestamp.
- `GeneralChatMessage`: id, session id, `USER` or `ASSISTANT` role, content, status, optional error detail, created timestamp.

The separate message table protects the existing report revision audit trail from general-chat lifecycle operations. Deleting a general session cascades only to its general messages.

### Backend vertical slice

The chat module is divided into focused boundaries:

- Domain types define sessions, messages, roles, and message state.
- Application use cases create/list/delete sessions, read a transcript, and send a message.
- A repository port owns persistence; its Prisma adapter contains all database queries.
- A conversational model port generates text from the system instruction and bounded transcript; its Gemini adapter owns provider calls.
- Fastify routes validate inputs, map domain errors to HTTP responses, and expose the streaming response.

The existing structured-output AI client remains available to analysis and revision workflows. General chat receives a dedicated text-generation capability so its looser response contract cannot weaken structured report generation.

## API Contract

- `GET /api/v1/chat/sessions` returns general sessions and report revision threads in descending activity order. Each item includes a discriminant (`GENERAL` or `REPORT_REVISION`), title, updated timestamp, message preview/count, and the navigation target needed by the client.
- `POST /api/v1/chat/sessions` creates a general session and returns its identifier.
- `GET /api/v1/chat/sessions/:id/messages` returns an ordered general-chat transcript.
- `POST /api/v1/chat/sessions/:id/messages` accepts a non-empty user message and streams typed SSE events over the fetch response: `message`, `delta`, `complete`, and `error`.
- `DELETE /api/v1/chat/sessions/:id` deletes only a general session owned by the current application context.

The send endpoint persists the user message before contacting Gemini. It accumulates streamed model text and persists one completed assistant message. Provider failure produces an `error` event and a failed assistant record, allowing the transcript to explain the interruption without losing the user's message.

Until authentication is connected end-to-end, general sessions use the application's existing single-user context. The data model keeps owner identity optional so authentication can be introduced without changing the public chat contract.

## Frontend Structure

### Routing and handoff

The workspace supports `/chat` for a new conversation and `/chat/:sessionId` for an existing conversation.

When the global docked assistant is submitted:

- If an `ActiveReport` exists, the current report revision submission runs unchanged.
- Otherwise, the application navigates to `/chat` with the initial message in router navigation state.
- `ChatScreen` creates the session, replaces the URL with `/chat/:sessionId`, clears the navigation state, and sends the message exactly once.

Clearing the transient state after session creation prevents duplicate submissions after rerenders, refreshes, or browser navigation.

### Conversation workspace

The desktop layout has a fixed-width history sidebar and a flexible conversation column. The sidebar contains a new-chat action, unified history items, type/context labels, active state, deletion for general sessions, loading state, empty state, and retry state. Report revision items navigate to their report instead of opening as general chats.

The conversation column contains a compact header, scrollable transcript, distinct user/assistant message presentation, streaming indicator, failure/retry presentation, and a sticky composer. The composer supports Enter to send, Shift+Enter for a new line, disabled state while sending, and automatic focus.

On narrow screens the history becomes an overlay drawer. The existing dark navy, blue, indigo, restrained gradients, rounded cards, and subtle shadows are reused. The chat route suppresses the global docked assistant so two composers never appear simultaneously.

### State ownership

API functions and transport parsing live outside React components. A focused conversation hook owns transcript loading, streaming state, optimistic user messages, abort cleanup, and retryable errors. Components receive explicit data and callbacks and do not call persistence APIs directly.

## Data Flow

1. The user submits text from the dashboard dock.
2. The router carries the text to `/chat` without putting message content in the URL.
3. The workspace creates a session, canonicalizes the URL, and starts one streamed send request.
4. The server persists the user message and sends the bounded transcript to Gemini.
5. Delta events update the active assistant bubble.
6. Completion persists the assistant response and refreshes the history item's title, preview, count, and timestamp.
7. Selecting a general history item loads its transcript; selecting a report-revision item opens its report context.

## Reliability and Security

- Empty and over-limit messages are rejected on both client and server.
- Session identifiers are validated and unknown sessions return 404.
- One send is allowed per active composer to prevent accidental duplication.
- Request disconnect aborts provider work when supported and never persists a fabricated successful response.
- Model context is bounded by recent-message count and total characters.
- User text is rendered as text/Markdown through a safe renderer; raw model HTML is never injected.
- Deletion requires an explicit confirmation in the UI and is limited to general sessions.
- Streaming resources and `AbortController` instances are cleaned up on route changes and unmount.

## Testing

Backend tests cover session CRUD, ordered transcripts, the unified history projection, persistence before model invocation, successful streamed completion, provider failure, validation, missing sessions, and deletion boundaries. Application tests use real use-case code with in-memory ports; route contract tests stub ports rather than Prisma or Gemini internals.

Frontend tests cover dashboard handoff, exactly-once initial submission, route canonicalization, loading existing sessions, history navigation, report-history navigation, general-session deletion, streaming deltas, composer keyboard behavior, error recovery, mobile history behavior, and suppression of the global dock on chat routes.

Full backend and frontend suites, type checking, linting, and production builds are required before completion.

## Acceptance Criteria

- Submitting a non-empty message from the global assistant outside a report navigates smoothly to the conversation workspace and sends it once.
- The user sees the submitted message and the real Gemini response as it streams.
- Refreshing `/chat/:sessionId` restores the persisted transcript.
- The left history lists both general conversations and report revision threads with correct navigation behavior.
- Users can create, continue, and delete general conversations.
- Existing report revision, approval, draft, and publish behavior remains unchanged.
- The workspace is usable on desktop and mobile and matches the current visual language.
- No placeholder sessions, simulated answers, or timer-based fake responses remain.
