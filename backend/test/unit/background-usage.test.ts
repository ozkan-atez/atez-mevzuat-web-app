import { describe, it, expect } from "vitest";
import {
  backgroundUsageModel,
  withUsageContext,
} from "../../src/modules/usage/background-usage";
import {
  measuredStructuredModel,
  type UsageCall,
  type UsageRecorder,
} from "../../src/modules/usage/measurement";
const request = {
  model: "test",
  systemInstruction: "test",
  parts: [],
  responseJsonSchema: {},
};
const defaults = {
  conversationType: "OPERATION" as const,
  usageLabel: "Analiz",
};
describe("all structured AI usage", () => {
  it("records provider usage before parsing fails and keeps attempts separate", async () => {
    const calls = new Map<string, UsageCall>(),
      recorder: UsageRecorder = {
        async save(c) {
          calls.set(c.id, structuredClone(c));
        },
      };
    const model = backgroundUsageModel(
      {
        async generateStructured(input) {
          await input.onUsage?.({
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 130,
            cachedTokens: 50,
            reasoningTokens: 10,
          });
          throw new Error("invalid JSON");
        },
      },
      recorder,
      defaults,
    );
    for (let i = 0; i < 2; i++)
      await expect(
        withUsageContext(
          {
            conversationId: "run1",
            conversationType: "AUTOMATION",
            usageLabel: "Günlük tarama",
          },
          () => model.generateStructured(request),
        ),
      ).rejects.toThrow("invalid JSON");
    expect(calls.size).toBe(2);
    for (const call of calls.values())
      expect(call).toMatchObject({
        conversationId: "run1",
        conversationType: "AUTOMATION",
        status: "FAILED",
        totalTokens: 130,
        usageLabel: "Günlük tarama",
      });
  });
  it("does not double count conversation wrappers", async () => {
    const calls = new Map<string, UsageCall>(),
      recorder: UsageRecorder = {
        async save(c) {
          calls.set(c.id, structuredClone(c));
        },
      };
    const base = backgroundUsageModel(
      {
        async generateStructured() {
          return {
            json: {},
            providerRequestId: null,
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          };
        },
      },
      recorder,
      defaults,
    );
    await measuredStructuredModel(base, recorder, {
      conversationId: "report",
      conversationType: "REPORT",
      messageId: "message",
    }).generateStructured(request);
    expect(calls.size).toBe(1);
    expect([...calls.values()][0]).toMatchObject({
      conversationType: "REPORT",
      mode: "REVISION",
      totalTokens: 15,
    });
  });
  it("isolates concurrent operation contexts and preserves missing metadata as null", async () => {
    const calls = new Map<string, UsageCall>(),
      recorder: UsageRecorder = {
        async save(c) {
          calls.set(c.id, structuredClone(c));
        },
      };
    const model = backgroundUsageModel(
      {
        async generateStructured() {
          await Promise.resolve();
          return {
            json: {},
            providerRequestId: null,
            usage: { inputTokens: null, outputTokens: null },
          };
        },
      },
      recorder,
      defaults,
    );
    await Promise.all(
      ["a", "b"].map((conversationId) =>
        withUsageContext(
          { conversationId, conversationType: "OPERATION" },
          () => model.generateStructured(request),
        ),
      ),
    );
    expect([...calls.values()].map((c) => c.conversationId).sort()).toEqual([
      "a",
      "b",
    ]);
    expect([...calls.values()].every((c) => c.totalTokens === null)).toBe(true);
  });
});
