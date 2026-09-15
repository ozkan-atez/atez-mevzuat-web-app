# Conversation Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent, responsive conversation workspace that receives dashboard messages, streams real Gemini answers, and unifies general-chat and report-revision history without changing revision behavior.

**Architecture:** General conversations form a separate `ChatSession` aggregate with their own messages, repository, application use case, and Gemini text-streaming port. Fastify exposes CRUD plus an SSE-over-fetch send route; React owns transport parsing and conversation state in focused modules while the docked assistant only decides between report revision submission and chat navigation.

**Tech Stack:** TypeScript 7/6, Fastify 5, Prisma 5/PostgreSQL, `@google/genai` 2, React 19, React Router 7, Tailwind CSS 4, Vitest 5, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-15-conversation-workspace-design.md`

## Global Constraints

- Implement only on `feat/report-revision-editing`.
- Preserve `AnalysisThread`, `ChatMessage`, `ActiveReport`, report draft approval, and publishing behavior.
- General chat has no gazette-document retrieval in this iteration.
- Render user/model output without raw HTML injection.
- Limit message content to 8,000 characters, model context to 24 messages and 48,000 characters, and one active send per composer.
- Desktop uses a persistent history sidebar; narrow screens use an overlay drawer.
- `/chat` creates a conversation and `/chat/:sessionId` restores one.
- No placeholder sessions, timer-generated answers, or simulated SSE content remain.

---

### Task 1: General conversation persistence model

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260915130000_add_general_chat_messages/migration.sql`
- Create: `backend/test/integration/chat-repository.test.ts`
- Create: `backend/src/modules/chat/application/ports.ts`
- Create: `backend/src/modules/chat/infrastructure/prisma-chat-repository.ts`

**Interfaces:**
- Consumes: Prisma's existing `ChatSession` model and `AnalysisThread`/`ChatMessage` report audit records.
- Produces: `ChatRepository`, `PrismaChatRepository`, `ChatSessionView`, `ChatMessageView`, and `ChatHistoryItem` used by later application and route tasks.

- [ ] **Step 1: Write repository integration tests that fail because general messages and repository methods do not exist**

```ts
it('creates a session, appends ordered messages, and lists it first', async () => {
  const session = await repository.createSession()
  await repository.appendMessage({ sessionId: session.id, role: 'USER', content: 'İthalat rejimi nedir?', status: 'COMPLETED' })
  await repository.appendMessage({ sessionId: session.id, role: 'ASSISTANT', content: 'İthalat rejimi...', status: 'COMPLETED' })

  expect(await repository.getMessages(session.id)).toMatchObject([
    { role: 'USER', content: 'İthalat rejimi nedir?', status: 'COMPLETED' },
    { role: 'ASSISTANT', content: 'İthalat rejimi...', status: 'COMPLETED' },
  ])
  expect((await repository.listHistory())[0]).toMatchObject({
    id: session.id, type: 'GENERAL', title: 'İthalat rejimi nedir?', messageCount: 2,
  })
})

it('combines report threads with general sessions without allowing report deletion', async () => {
  const session = await repository.createSession()
  await seedTopicThread('PET reçine revizyonu')
  expect((await repository.listHistory()).map((item) => item.type).sort()).toEqual(['GENERAL', 'REPORT_REVISION'])
  expect(await repository.deleteSession('analysis-thread-id')).toBe(false)
  expect(await repository.deleteSession(session.id)).toBe(true)
})
```

- [ ] **Step 2: Run the focused test and verify the RED state**

Run: `cd backend && npm test -- test/integration/chat-repository.test.ts`

Expected: FAIL because `PrismaChatRepository`, the Prisma enums, and `GeneralChatMessage` do not exist.

- [ ] **Step 3: Add the Prisma model and exact migration**

```prisma
enum GeneralChatRole {
  USER
  ASSISTANT
}

enum GeneralChatMessageStatus {
  COMPLETED
  FAILED
}

model ChatSession {
  id        String               @id @default(uuid())
  ownerId   String?
  title     String?
  messages  GeneralChatMessage[]
  createdAt DateTime             @default(now())
  updatedAt DateTime             @updatedAt
}

model GeneralChatMessage {
  id          String                   @id @default(uuid())
  sessionId   String
  session     ChatSession              @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  role        GeneralChatRole
  content     String
  status      GeneralChatMessageStatus @default(COMPLETED)
  errorDetail String?
  createdAt   DateTime                 @default(now())

  @@index([sessionId, createdAt])
}
```

```sql
ALTER TABLE "ChatSession" ALTER COLUMN "ownerId" DROP NOT NULL;
CREATE TYPE "GeneralChatRole" AS ENUM ('USER', 'ASSISTANT');
CREATE TYPE "GeneralChatMessageStatus" AS ENUM ('COMPLETED', 'FAILED');
CREATE TABLE "GeneralChatMessage" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "role" "GeneralChatRole" NOT NULL,
  "content" TEXT NOT NULL,
  "status" "GeneralChatMessageStatus" NOT NULL DEFAULT 'COMPLETED',
  "errorDetail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeneralChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GeneralChatMessage_sessionId_createdAt_idx" ON "GeneralChatMessage"("sessionId", "createdAt");
ALTER TABLE "GeneralChatMessage" ADD CONSTRAINT "GeneralChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Define the repository port and errors**

```ts
export type ChatSessionView = {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
}

export type ChatMessageView = {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  status: 'COMPLETED' | 'FAILED'
  errorDetail: string | null
  createdAt: string
}

export type ChatHistoryItem = {
  id: string
  type: 'GENERAL' | 'REPORT_REVISION'
  title: string
  preview: string | null
  messageCount: number
  updatedAt: string
  target: string
}

export interface ChatRepository {
  createSession(): Promise<ChatSessionView>
  sessionExists(id: string): Promise<boolean>
  getMessages(sessionId: string): Promise<ChatMessageView[]>
  appendMessage(input: { sessionId: string; role: 'USER' | 'ASSISTANT'; content: string; status: 'COMPLETED' | 'FAILED'; errorDetail?: string | null }): Promise<ChatMessageView>
  listHistory(): Promise<ChatHistoryItem[]>
  deleteSession(id: string): Promise<boolean>
}

export class ChatSessionNotFoundError extends Error {
  override name = 'ChatSessionNotFoundError'
}
```

- [ ] **Step 5: Implement `PrismaChatRepository` with atomic title/timestamp updates and the unified projection**

```ts
async appendMessage(input: AppendMessageInput): Promise<ChatMessageView> {
  return this.prisma.$transaction(async (tx) => {
    const session = await tx.chatSession.findUnique({ where: { id: input.sessionId } })
    if (!session) throw new ChatSessionNotFoundError('Sohbet bulunamadı.')
    const message = await tx.generalChatMessage.create({ data: input })
    await tx.chatSession.update({
      where: { id: input.sessionId },
      data: {
        updatedAt: new Date(),
        ...(session.title || input.role !== 'USER' ? {} : { title: input.content.trim().slice(0, 72) }),
      },
    })
    return toMessageView(message)
  })
}
```

`listHistory()` must query general sessions with their latest message/count and analysis threads with topic/report context, map report targets to `/reports/${topicId}`, concatenate, and sort by `updatedAt` descending. `deleteSession()` must call `chatSession.deleteMany({ where: { id } })` so an analysis-thread identifier cannot delete revision history.

```ts
async deleteSession(id: string): Promise<boolean> {
  return (await this.prisma.chatSession.deleteMany({ where: { id } })).count === 1
}

async listHistory(): Promise<ChatHistoryItem[]> {
  const [sessions, threads] = await Promise.all([
    this.prisma.chatSession.findMany({ include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 }, _count: { select: { messages: true } } } }),
    this.prisma.analysisThread.findMany({ include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 }, _count: { select: { messages: true } }, topic: { select: { id: true, document: { select: { title: true } } } } } }),
  ])
  return [...sessions.map(toGeneralHistory), ...threads.map(toReportHistory)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}
```

- [ ] **Step 6: Generate Prisma client and verify GREEN**

Run: `cd backend && npm run prisma:generate && npm test -- test/integration/chat-repository.test.ts`

Expected: PASS; the general transcript is ordered, history is unified, and report threads cannot be deleted through the general-session method.

- [ ] **Step 7: Commit the persistence slice**

```bash
git add backend/prisma backend/src/modules/chat/application/ports.ts backend/src/modules/chat/infrastructure/prisma-chat-repository.ts backend/test/integration/chat-repository.test.ts
git commit -m "feat(chat): persist general conversations"
```

### Task 2: Conversation context and send-message use case

**Files:**
- Create: `backend/src/modules/chat/application/chat-model-client.ts`
- Create: `backend/src/modules/chat/application/send-chat-message.ts`
- Create: `backend/test/unit/send-chat-message.test.ts`

**Interfaces:**
- Consumes: `ChatRepository.getMessages()`, `ChatRepository.appendMessage()`.
- Produces: `ChatModelClient.streamReply(request): AsyncIterable<string>` and `sendChatMessage(input, dependencies): AsyncGenerator<ChatStreamEvent>`.

- [ ] **Step 1: Write failing use-case tests for persistence order, bounded context, deltas, completion, and provider failure**

```ts
it('persists the user message before streaming and completes one assistant message', async () => {
  const events: ChatStreamEvent[] = []
  for await (const event of sendChatMessage({ sessionId: 's1', content: 'GTİP nedir?' }, { repository, model, modelName: 'gemini-3.7-flash' })) events.push(event)

  expect(repository.saved.map((message) => message.role)).toEqual(['USER', 'ASSISTANT'])
  expect(events).toEqual([
    { type: 'message', message: expect.objectContaining({ role: 'USER', content: 'GTİP nedir?' }) },
    { type: 'delta', content: 'Gümrük ' },
    { type: 'delta', content: 'tarifesidir.' },
    { type: 'complete', message: expect.objectContaining({ role: 'ASSISTANT', content: 'Gümrük tarifesidir.' }) },
  ])
})

it('keeps only the newest 24 messages within 48000 characters', async () => {
  repository.messages = Array.from({ length: 30 }, (_, index) => message(`m${index}`.padEnd(2000, '.')))
  await collect(sendChatMessage({ sessionId: 's1', content: 'Özetle' }, { repository, model, modelName: 'gemini-3.7-flash' }))
  expect(model.requests[0]!.messages.length).toBeLessThanOrEqual(24)
  expect(model.requests[0]!.messages.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(48_000)
})

it('persists a failed assistant record and emits a safe error', async () => {
  model.error = new Error('provider secret')
  expect(await collect(sendChatMessage({ sessionId: 's1', content: 'Sor' }, { repository, model, modelName: 'gemini-3.7-flash' }))).toContainEqual({
    type: 'error', message: 'Yapay zekâ yanıtı tamamlanamadı. Lütfen yeniden deneyin.'
  })
  expect(repository.saved.at(-1)).toMatchObject({ role: 'ASSISTANT', status: 'FAILED', content: '' })
})
```

- [ ] **Step 2: Run the unit test and verify RED**

Run: `cd backend && npm test -- test/unit/send-chat-message.test.ts`

Expected: FAIL because the chat model port and use case do not exist.

- [ ] **Step 3: Define the model and event contracts**

```ts
export interface ChatModelClient {
  streamReply(input: {
    model: string
    systemInstruction: string
    messages: Array<{ role: 'user' | 'model'; content: string }>
    signal?: AbortSignal
  }): AsyncIterable<string>
}

export type ChatModelRequest = Parameters<ChatModelClient['streamReply']>[0]

export type ChatStreamEvent =
  | { type: 'message'; message: ChatMessageView }
  | { type: 'delta'; content: string }
  | { type: 'complete'; message: ChatMessageView }
  | { type: 'error'; message: string }

type Dependencies = {
  repository: ChatRepository
  model: ChatModelClient
  modelName: string
}
```

- [ ] **Step 4: Implement `sendChatMessage` with literal bounds and safe failure behavior**

```ts
export async function* sendChatMessage(input: { sessionId: string; content: string; signal?: AbortSignal }, dependencies: Dependencies): AsyncGenerator<ChatStreamEvent> {
  const user = await dependencies.repository.appendMessage({ sessionId: input.sessionId, role: 'USER', content: input.content.trim(), status: 'COMPLETED' })
  yield { type: 'message', message: user }
  const history = boundContext(await dependencies.repository.getMessages(input.sessionId), 24, 48_000)
  let answer = ''
  try {
    for await (const delta of dependencies.model.streamReply({
      model: dependencies.modelName,
      systemInstruction: 'Türkçe yanıt veren ATEZ gümrük ve dış ticaret mevzuatı asistanısın. Bilmediğin güncel bilgileri kesinmiş gibi sunma.',
      messages: history.filter((item) => item.status === 'COMPLETED').map((item) => ({ role: item.role === 'USER' ? 'user' : 'model', content: item.content })),
      ...(input.signal ? { signal: input.signal } : {}),
    })) {
      answer += delta
      yield { type: 'delta', content: delta }
    }
    const assistant = await dependencies.repository.appendMessage({ sessionId: input.sessionId, role: 'ASSISTANT', content: answer, status: 'COMPLETED' })
    yield { type: 'complete', message: assistant }
  } catch {
    await dependencies.repository.appendMessage({ sessionId: input.sessionId, role: 'ASSISTANT', content: answer, status: 'FAILED', errorDetail: 'MODEL_GENERATION_FAILED' })
    yield { type: 'error', message: 'Yapay zekâ yanıtı tamamlanamadı. Lütfen yeniden deneyin.' }
  }
}
```

- [ ] **Step 5: Run the unit test and verify GREEN**

Run: `cd backend && npm test -- test/unit/send-chat-message.test.ts`

Expected: PASS with user-first persistence, bounded context, accumulated completion, and safe errors.

- [ ] **Step 6: Commit the application slice**

```bash
git add backend/src/modules/chat/application backend/test/unit/send-chat-message.test.ts
git commit -m "feat(chat): add streaming conversation use case"
```

### Task 3: Gemini conversational streaming adapter

**Files:**
- Create: `backend/src/modules/chat/infrastructure/gemini-chat-model-client.ts`
- Create: `backend/test/unit/gemini-chat-model-client.test.ts`
- Modify: `backend/src/modules/ai/infrastructure/gemini-ai-model-client.ts`

**Interfaces:**
- Consumes: `ChatModelClient` and an injected `GeminiChatTransport`.
- Produces: `GeminiChatModelClient` and a transport contract wired to `GoogleGenAI.models.generateContentStream` in Task 4.

- [ ] **Step 1: Write failing adapter tests**

```ts
it('maps conversation roles and yields only non-empty text chunks', async () => {
  const transport = transportWith([{ text: 'Merhaba' }, {}, { text: ' dünya' }])
  const client = new GeminiChatModelClient(transport, { timeoutMs: 100 })
  expect(await collect(client.streamReply({
    model: 'gemini-3.7-flash', systemInstruction: 'Türkçe yanıtla',
    messages: [{ role: 'user', content: 'Merhaba' }],
  }))).toEqual(['Merhaba', ' dünya'])
  expect(transport.requests[0]).toEqual({
    model: 'gemini-3.7-flash',
    contents: [{ role: 'user', parts: [{ text: 'Merhaba' }] }],
    config: { systemInstruction: 'Türkçe yanıtla' },
  })
})

it('aborts a stream that exceeds the configured timeout', async () => {
  const client = new GeminiChatModelClient(neverEndingTransport(), { timeoutMs: 10 })
  await expect(collect(client.streamReply(request))).rejects.toMatchObject({ category: 'TIMEOUT' })
})
```

- [ ] **Step 2: Run the adapter test and verify RED**

Run: `cd backend && npm test -- test/unit/gemini-chat-model-client.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement role mapping, linked abort signals, timeout cleanup, and safe provider errors**

```ts
export interface GeminiChatTransport {
  generateContentStream(input: {
    model: string
    contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>
    config: { systemInstruction: string }
    signal?: AbortSignal
  }): Promise<AsyncIterable<{ text?: string }>>
}

export class GeminiChatModelClient implements ChatModelClient {
  async *streamReply(input: ChatModelRequest): AsyncIterable<string> {
    const controller = new AbortController()
    const relay = () => controller.abort(input.signal?.reason)
    input.signal?.addEventListener('abort', relay, { once: true })
    const timer = setTimeout(() => controller.abort(new AiProviderError('TIMEOUT', true, 'Gemini isteği zaman aşımına uğradı.')), this.options.timeoutMs)
    try {
      const stream = await this.transport.generateContentStream({
        model: input.model,
        contents: input.messages.map((message) => ({ role: message.role, parts: [{ text: message.content }] })),
        config: { systemInstruction: input.systemInstruction },
        signal: controller.signal,
      })
      for await (const chunk of stream) if (chunk.text) yield chunk.text
    } finally {
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', relay)
    }
  }
}
```

Export the existing `mapGeminiError(error)` helper from `gemini-ai-model-client.ts`. In the streaming adapter, track whether the local timeout fired; convert that case to `AiProviderError('TIMEOUT', true, 'Gemini isteği zaman aşımına uğradı.')`, rethrow an external abort unchanged, and pass every other transport error through `mapGeminiError(error)`. Routes receive only the safe use-case error event and never provider payloads.

- [ ] **Step 4: Run the adapter tests and AI regression tests**

Run: `cd backend && npm test -- test/unit/gemini-chat-model-client.test.ts test/unit/gemini-ai-model-client.test.ts`

Expected: PASS; the structured-output adapter remains unchanged.

- [ ] **Step 5: Commit the provider adapter**

```bash
git add backend/src/modules/chat/infrastructure/gemini-chat-model-client.ts backend/test/unit/gemini-chat-model-client.test.ts
git commit -m "feat(chat): stream Gemini conversation replies"
```

### Task 4: Chat HTTP contract and server wiring

**Files:**
- Replace: `backend/src/modules/chat/chat.routes.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/server.ts`
- Create: `backend/test/contract/chat.routes.test.ts`

**Interfaces:**
- Consumes: `ChatRepository`, `ChatModelClient`, `sendChatMessage()`.
- Produces: `/api/v1/chat/sessions` CRUD and typed SSE send endpoint.

- [ ] **Step 1: Write failing contract tests for CRUD, validation, SSE, 404, and disconnect-safe errors**

```ts
it('creates a session and streams typed events for a valid message', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/v1/chat/sessions' })
  const sessionId = created.json().id
  const response = await app.inject({ method: 'POST', url: `/api/v1/chat/sessions/${sessionId}/messages`, payload: { content: 'GTİP nedir?' } })
  expect(response.statusCode).toBe(200)
  expect(response.headers['content-type']).toContain('text/event-stream')
  expect(response.body).toContain('event: delta\ndata: {"content":"GTİP"}')
  expect(response.body).toContain('event: complete')
})

it.each(['', 'x'.repeat(8001)])('rejects invalid message content', async (content) => {
  const response = await app.inject({ method: 'POST', url: '/api/v1/chat/sessions/known/messages', payload: { content } })
  expect(response.statusCode).toBe(400)
})

it('returns 404 for an unknown session and deletes only general sessions', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/v1/chat/sessions/missing/messages' })).statusCode).toBe(404)
  expect((await app.inject({ method: 'DELETE', url: '/api/v1/chat/sessions/missing' })).statusCode).toBe(404)
})
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `cd backend && npm test -- test/contract/chat.routes.test.ts`

Expected: FAIL because only the simulated `/api/chat/stream` endpoint exists.

- [ ] **Step 3: Implement validation and SSE serialization in `chat.routes.ts`**

```ts
const messageBodySchema = z.object({ content: z.string().trim().min(1).max(8_000) })

function writeEvent(reply: FastifyReply, event: ChatStreamEvent) {
  reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}

app.post('/sessions/:id/messages', async (request, reply) => {
  const body = messageBodySchema.safeParse(request.body)
  if (!body.success) return reply.code(400).send({ message: 'Mesaj 1-8000 karakter olmalıdır.' })
  const { id } = request.params as { id: string }
  if (!await options.repository.sessionExists(id)) return reply.code(404).send({ message: 'Sohbet bulunamadı.' })
  const controller = new AbortController()
  request.raw.once('close', () => controller.abort())
  reply.hijack()
  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' })
  for await (const event of sendChatMessage({ sessionId: id, content: body.data.content, signal: controller.signal }, options)) writeEvent(reply, event)
  reply.raw.end()
})
```

Add the remaining handlers and register only the new contract:

```ts
app.get('/sessions', async (_request, reply) => reply.send({ sessions: await options.repository.listHistory() }))
app.post('/sessions', async (_request, reply) => reply.code(201).send(await options.repository.createSession()))
app.get('/sessions/:id/messages', async (request, reply) => {
  const { id } = request.params as { id: string }
  if (!await options.repository.sessionExists(id)) return reply.code(404).send({ message: 'Sohbet bulunamadı.' })
  return reply.send({ sessionId: id, messages: await options.repository.getMessages(id) })
})
app.delete('/sessions/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  return await options.repository.deleteSession(id) ? reply.code(204).send() : reply.code(404).send({ message: 'Sohbet bulunamadı.' })
})
```

Register `chatRoutes` at `/api/v1/chat` and remove the simulated `/api/chat/stream` endpoint.

- [ ] **Step 4: Wire production Prisma and Gemini dependencies in `buildApp()` and `server.ts`**

```ts
interface BuildAppOptions {
  chatRepository?: ChatRepository
  chatModel?: ChatModelClient
  chatModelName?: string
}
```

```ts
const gemini = env.gemini.apiKey ? new GoogleGenAI({ apiKey: env.gemini.apiKey }) : null
const chatModel = gemini
  ? new GeminiChatModelClient({
      async generateContentStream(input) { return gemini.models.generateContentStream(input) },
    }, { timeoutMs: env.gemini.timeoutMs })
  : new UnavailableChatModelClient('Gemini API anahtarı yapılandırılmamış.')
```

`UnavailableChatModelClient` implements `ChatModelClient` and throws `AiProviderError('AUTHENTICATION', false, message)` from `streamReply()` before yielding a chunk. This keeps missing credentials on the same safe error path as provider failures.

Pass `new PrismaChatRepository(prisma)`, `chatModel`, and `env.gemini.model` into `buildApp`. Tests inject in-memory ports and never contact Gemini.

- [ ] **Step 5: Run focused and full backend verification**

Run: `cd backend && npm test -- test/contract/chat.routes.test.ts && npm run build`

Expected: PASS with valid SSE syntax and no TypeScript errors.

- [ ] **Step 6: Commit the HTTP slice**

```bash
git add backend/src/app.ts backend/src/server.ts backend/src/modules/chat backend/test/contract/chat.routes.test.ts
git commit -m "feat(chat): expose persistent streaming API"
```

### Task 5: Frontend chat transport and conversation state

**Files:**
- Create: `frontend/src/features/chat/types.ts`
- Create: `frontend/src/features/chat/api.ts`
- Create: `frontend/src/features/chat/useConversation.ts`
- Create: `frontend/src/features/chat/api.test.ts`
- Create: `frontend/src/features/chat/useConversation.test.tsx`

**Interfaces:**
- Consumes: the Task 4 HTTP/SSE contract.
- Produces: typed chat API functions and `useConversation(sessionId)` for presentation components.

- [ ] **Step 1: Write a failing parser test using split network chunks**

```ts
it('parses SSE frames split across response chunks', async () => {
  const chunks = [
    'event: message\ndata: {"type":"message","message":{"id":"u1","role":"USER","content":"Merhaba","status":"COMPLETED","errorDetail":null,"createdAt":"2026-09-15T10:00:00.000Z"}}\n',
    '\nevent: delta\ndata: {"type":"delta","content":"Merha"}\n\nevent: delta\ndata: {"type":"delta","content":"ba"}\n\n',
    'event: complete\ndata: {"type":"complete","message":{"id":"a1","role":"ASSISTANT","content":"Merhaba","status":"COMPLETED","errorDetail":null,"createdAt":"2026-09-15T10:00:01.000Z"}}\n\n',
  ]
  expect(await collect(parseChatEventStream(streamResponse(chunks)))).toMatchObject([
    { type: 'message' }, { type: 'delta', content: 'Merha' }, { type: 'delta', content: 'ba' }, { type: 'complete' },
  ])
})
```

- [ ] **Step 2: Write failing hook tests for optimistic display, one active send, completion replacement, error recovery, and abort cleanup**

```tsx
it('shows the user immediately and builds one assistant bubble from deltas', async () => {
  const { result } = renderHook(() => useConversation('s1'))
  await act(() => result.current.send('Merhaba'))
  expect(result.current.messages.map((item) => item.content)).toEqual(['Merhaba', 'Merhaba dünya'])
  expect(result.current.isSending).toBe(false)
})

it('ignores a second send while a response is active', async () => {
  const { result } = renderHook(() => useConversation('s1'))
  act(() => { void result.current.send('Birinci'); void result.current.send('İkinci') })
  expect(sendMessageCalls).toEqual(['Birinci'])
})
```

- [ ] **Step 3: Run focused frontend tests and verify RED**

Run: `cd frontend && npm test -- src/features/chat/api.test.ts src/features/chat/useConversation.test.tsx`

Expected: FAIL because the transport and hook do not exist.

- [ ] **Step 4: Implement typed API functions and a buffer-safe SSE parser**

```ts
export async function* parseChatEventStream(response: Response): AsyncGenerator<ChatStreamEvent> {
  if (!response.ok || !response.body) throw new ChatApiError(response.status, await readError(response))
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const data = frame.split('\n').find((line) => line.startsWith('data: '))?.slice(6)
      if (data) yield JSON.parse(data) as ChatStreamEvent
    }
    if (done) break
  }
}
```

Provide these exact transport functions:

```ts
export async function listChatHistory(): Promise<ChatHistoryItem[]> {
  const response = await fetch('/api/v1/chat/sessions')
  if (!response.ok) throw await ChatApiError.from(response, 'Sohbet geçmişi alınamadı.')
  return ((await response.json()) as { sessions: ChatHistoryItem[] }).sessions
}

export async function createChatSession(): Promise<ChatSession> {
  const response = await fetch('/api/v1/chat/sessions', { method: 'POST' })
  if (!response.ok) throw await ChatApiError.from(response, 'Sohbet oluşturulamadı.')
  return response.json() as Promise<ChatSession>
}

export async function getChatMessages(sessionId: string): Promise<ChatMessage[]> {
  const response = await fetch(`/api/v1/chat/sessions/${sessionId}/messages`)
  if (!response.ok) throw await ChatApiError.from(response, 'Mesajlar alınamadı.')
  return ((await response.json()) as { messages: ChatMessage[] }).messages
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const response = await fetch(`/api/v1/chat/sessions/${sessionId}`, { method: 'DELETE' })
  if (!response.ok) throw await ChatApiError.from(response, 'Sohbet silinemedi.')
}

export async function streamChatMessage(sessionId: string, content: string, signal: AbortSignal): Promise<Response> {
  return fetch(`/api/v1/chat/sessions/${sessionId}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }), signal,
  })
}
```

- [ ] **Step 5: Implement `useConversation` with an `AbortController`, optimistic user state, one streaming assistant bubble, and retryable error state**

The hook reloads when `sessionId` changes, aborts load/send work on cleanup, rejects empty/over-limit input before transport, and replaces optimistic records when `message`/`complete` events arrive:

```ts
const send = useCallback(async (raw: string) => {
  const content = raw.trim()
  if (!sessionId || isSendingRef.current || content.length === 0 || content.length > 8_000) return
  isSendingRef.current = true
  setIsSending(true)
  setError(null)
  const optimisticId = `optimistic-${crypto.randomUUID()}`
  setMessages((current) => [...current, optimisticMessage(optimisticId, content), streamingMessage])
  const controller = new AbortController()
  sendController.current = controller
  try {
    for await (const event of parseChatEventStream(await streamChatMessage(sessionId, content, controller.signal))) {
      setMessages((current) => reduceChatEvent(current, event, optimisticId))
    }
  } catch (caught) {
    if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Yanıt alınamadı.')
  } finally {
    isSendingRef.current = false
    setIsSending(false)
  }
}, [sessionId])
```

- [ ] **Step 6: Run the transport and hook tests and verify GREEN**

Run: `cd frontend && npm test -- src/features/chat/api.test.ts src/features/chat/useConversation.test.tsx`

Expected: PASS, including arbitrarily split SSE chunks and unmount cleanup.

- [ ] **Step 7: Commit the frontend state slice**

```bash
git add frontend/src/features/chat/types.ts frontend/src/features/chat/api.ts frontend/src/features/chat/api.test.ts frontend/src/features/chat/useConversation.ts frontend/src/features/chat/useConversation.test.tsx
git commit -m "feat(chat): add conversation client state"
```

### Task 6: Responsive conversation workspace UI

**Files:**
- Replace: `frontend/src/features/chat/ChatScreen.tsx`
- Create: `frontend/src/features/chat/ConversationHistory.tsx`
- Create: `frontend/src/features/chat/ConversationMessages.tsx`
- Create: `frontend/src/features/chat/ConversationComposer.tsx`
- Create: `frontend/src/features/chat/ChatScreen.test.tsx`
- Delete: `frontend/src/features/chat/GeminiLandingChat.tsx`

**Interfaces:**
- Consumes: Task 5 types, API functions, and `useConversation()`.
- Produces: the user-facing `/chat` and `/chat/:sessionId` workspace.

- [ ] **Step 1: Write failing UI tests for history, keyboard behavior, mobile drawer, report navigation, deletion confirmation, and new chat**

```tsx
it('renders unified history and routes a report thread to its report', async () => {
  renderChat('/chat/general-1', [
    history({ id: 'general-1', type: 'GENERAL', title: 'GTİP sorusu', target: '/chat/general-1' }),
    history({ id: 'topic-1', type: 'REPORT_REVISION', title: 'PET revizyonu', target: '/reports/topic-1' }),
  ])
  expect(await screen.findByRole('navigation', { name: 'Sohbet geçmişi' })).toBeVisible()
  await userEvent.click(screen.getByRole('link', { name: /PET revizyonu/ }))
  expect(screen.getByTestId('location')).toHaveTextContent('/reports/topic-1')
})

it('sends with Enter and inserts a newline with Shift+Enter', async () => {
  renderChat('/chat/general-1')
  const composer = screen.getByRole('textbox', { name: 'Mesaj' })
  await userEvent.type(composer, 'Birinci satır{shift>}{enter}{/shift}İkinci satır')
  expect(composer).toHaveValue('Birinci satır\nİkinci satır')
  await userEvent.type(composer, '{enter}')
  expect(sentMessages).toEqual(['Birinci satır\nİkinci satır'])
})
```

- [ ] **Step 2: Run the screen test and verify RED**

Run: `cd frontend && npm test -- src/features/chat/ChatScreen.test.tsx`

Expected: FAIL because the placeholder screen has no workspace, history, or composer.

- [ ] **Step 3: Build the presentation components**

`ConversationHistory` renders a `<nav aria-label="Sohbet geçmişi">`, a “Yeni sohbet” link to `/chat`, active styling, `GENERAL`/`Rapor revizyonu` labels, and a delete action only for `GENERAL`. `ConversationMessages` uses plain text with `whitespace-pre-wrap`; no `dangerouslySetInnerHTML`. `ConversationComposer` uses a textarea and this keyboard contract:

```ts
const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    submit()
  }
}
```

- [ ] **Step 4: Replace `ChatScreen` with responsive orchestration**

Use a navy sidebar (`lg:w-80`) and a white/slate conversation surface. On small screens, open history from an accessible menu button into a fixed overlay. Keep the composer sticky inside the conversation column and scroll the newest message into view. `/chat` shows the focused empty-state composer; `/chat/:sessionId` loads the transcript.

- [ ] **Step 5: Run screen tests and verify GREEN**

Run: `cd frontend && npm test -- src/features/chat/ChatScreen.test.tsx`

Expected: PASS for desktop history, mobile drawer, report navigation, deletion, and composer keyboard behavior.

- [ ] **Step 6: Commit the workspace UI**

```bash
git add frontend/src/features/chat
git commit -m "feat(chat): build responsive conversation workspace"
```

### Task 7: Dashboard handoff, canonical routing, and chat-layout isolation

**Files:**
- Modify: `frontend/src/features/chat/DockedAiAssistant.tsx`
- Modify: `frontend/src/features/chat/DockedAiAssistant.test.tsx`
- Modify: `frontend/src/components/layout/AppLayout.tsx`
- Modify: `frontend/src/components/layout/AppLayout.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/features/chat/ChatScreen.tsx`
- Modify: `frontend/src/features/chat/ChatScreen.test.tsx`

**Interfaces:**
- Consumes: React Router navigation state `{ initialMessage: string }`, `ActiveReport`, `createChatSession()`, and `useConversation.send()`.
- Produces: exactly-once dashboard-to-chat handoff and suppression of the docked assistant on chat routes.

- [ ] **Step 1: Extend the docked-assistant test to fail on missing general-chat navigation while retaining report behavior**

```tsx
it('navigates a non-report prompt to chat with transient state', async () => {
  renderAssistantAt('/')
  await userEvent.click(screen.getByRole('button', { name: 'Yapay zekâ asistanını aç' }))
  await userEvent.type(screen.getByPlaceholderText('Ne değiştirmek veya oluşturmak istiyorsunuz?'), 'GTİP nedir?{enter}')
  expect(screen.getByTestId('location')).toHaveTextContent('/chat')
  expect(screen.getByTestId('location-state')).toHaveTextContent('GTİP nedir?')
})

it('keeps submitting through ActiveReport on a report page', async () => {
  renderAssistantWithReport()
  await submitPrompt('Başlığı kısalt')
  expect(reportSubmit).toHaveBeenCalledWith('Başlığı kısalt')
  expect(screen.getByTestId('location')).toHaveTextContent('/reports/topic-1')
})
```

- [ ] **Step 2: Extend `ChatScreen` and layout tests to fail on duplicate handoff and duplicate composers**

```tsx
it('creates a session, replaces the URL, and sends navigation-state input once under StrictMode', async () => {
  renderChat('/chat', { initialMessage: 'GTİP nedir?' }, { strict: true })
  await waitFor(() => expect(createSessionCalls).toBe(1))
  await waitFor(() => expect(sentMessages).toEqual(['GTİP nedir?']))
  expect(screen.getByTestId('location')).toHaveTextContent('/chat/session-1')
})

it('does not render the global dock on chat routes', () => {
  renderLayoutAt('/chat/session-1')
  expect(screen.queryByRole('button', { name: 'Yapay zekâ asistanını aç' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('textbox', { name: 'Mesaj' })).toHaveLength(1)
})
```

- [ ] **Step 3: Run the integration tests and verify RED**

Run: `cd frontend && npm test -- src/features/chat/DockedAiAssistant.test.tsx src/features/chat/ChatScreen.test.tsx src/components/layout/AppLayout.test.tsx`

Expected: FAIL because the general dock submit is disabled, the dynamic route is missing, and the dock renders on `/chat`.

- [ ] **Step 4: Implement general navigation in `DockedAiAssistant` without changing the report branch**

```ts
const navigate = useNavigate()
const submit = () => {
  const message = input.trim()
  if (!message || activeReport?.isPrompting) return
  setInput('')
  if (activeReport) {
    void activeReport.submitPrompt(message)
    return
  }
  onOpenChange(false)
  navigate('/chat', { state: { initialMessage: message }, viewTransition: true })
}
```

- [ ] **Step 5: Add canonical routes and hide the global dock on chat paths**

```tsx
<Route path="/chat" element={<ChatScreen />} />
<Route path="/chat/:sessionId" element={<ChatScreen />} />
```

In `AppLayout`, use `useLocation()` and render `DockedAiAssistant` only when `!location.pathname.startsWith('/chat')`. Remove chat-route bottom padding and max-width constraints so the workspace can occupy the viewport.

- [ ] **Step 6: Implement exactly-once initial handoff in `ChatScreen`**

Use a `useRef(false)` guard scoped to the mounted navigation entry:

```ts
const creatingSession = useRef(false)
useEffect(() => {
  if (sessionId || creatingSession.current || !initialMessage?.trim()) return
  creatingSession.current = true
  void createChatSession()
    .then((session) => {
      navigate(`/chat/${session.id}`, { replace: true, state: { initialMessage: initialMessage.trim() }, viewTransition: true })
    })
    .catch((caught) => {
      creatingSession.current = false
      setHandoffError(caught instanceof Error ? caught.message : 'Sohbet başlatılamadı.')
    })
}, [initialMessage, navigate, sessionId])

// Rendered only after :sessionId exists; `send` therefore owns the visible stream.
const submittedHandoff = useRef(false)
useEffect(() => {
  if (!sessionId || submittedHandoff.current || !initialMessage?.trim()) return
  submittedHandoff.current = true
  navigate(`/chat/${sessionId}`, { replace: true, state: null })
  void conversation.send(initialMessage)
}, [conversation.send, initialMessage, navigate, sessionId])
```

Retain `initialMessage` in component state when creation fails and expose a retry button that reruns the same guarded action.

- [ ] **Step 7: Run the integration tests and verify GREEN**

Run: `cd frontend && npm test -- src/features/chat/DockedAiAssistant.test.tsx src/features/chat/ChatScreen.test.tsx src/components/layout/AppLayout.test.tsx`

Expected: PASS; report prompts stay on the report, dashboard prompts move once, and chat has one composer.

- [ ] **Step 8: Commit the handoff slice**

```bash
git add frontend/src/App.tsx frontend/src/components/layout/AppLayout.tsx frontend/src/components/layout/AppLayout.test.tsx frontend/src/features/chat
git commit -m "feat(chat): continue dashboard prompts in workspace"
```

### Task 8: Full verification and regression audit

**Files:**
- Modify only files required to correct failures introduced by Tasks 1-7.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a buildable, tested branch with no regression in report revisions.

- [ ] **Step 1: Apply the new database migration in the development stack**

Run: `docker-compose exec backend npm run prisma:migrate`

Expected: migration `20260915130000_add_general_chat_messages` applies successfully.

- [ ] **Step 2: Run all backend tests and type checking**

Run: `cd backend && npm test && npm run build`

Expected: all tests pass and TypeScript emits no errors.

- [ ] **Step 3: Run all frontend tests, linting, and production build**

Run: `cd frontend && npm test && npm run lint && npm run build`

Expected: all tests pass, lint reports no violations, and Vite produces the production bundle.

- [ ] **Step 4: Run targeted report-revision regressions**

Run: `cd backend && npm test -- test/integration/execute-topic-revision.test.ts test/integration/execute-prompt-patch.test.ts test/contract/topic-analysis.routes.test.ts`

Expected: report revision routing, approval staging, and topic message history remain green.

- [ ] **Step 5: Review the working-tree diff for scope and unsafe rendering**

Run: `git diff --check && git status --short && rg -n "dangerouslySetInnerHTML|DUMMY_SESSIONS|setTimeout\(|/api/chat/stream" frontend/src/features/chat backend/src/modules/chat`

Expected: no whitespace errors; only intended files are changed; the search produces no placeholder history, fake response timers, obsolete endpoint, or unsafe rendering usage.

- [ ] **Step 6: Commit verification-only corrections if the working tree is non-empty**

```bash
git add backend frontend
git commit -m "test(chat): complete conversation workspace verification"
```

- [ ] **Step 7: Record final evidence**

Capture the exact passing test counts, build results, migration result, branch name, and final commit SHA in the completion message. Do not claim completion from earlier cached output.
