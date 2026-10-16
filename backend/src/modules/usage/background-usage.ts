import { aiProvider } from '../../config/google-ai'
import { randomUUID } from "node:crypto";
import type { AiModelClient } from "../ai/application/ai-model-client";
import { emptyTokens, type UsageCall, type UsageRecorder } from "./measurement";

export { withUsageContext } from "./usage-context";
import { usageContext } from "./usage-context";
import type { UsageContext } from "./usage-context";
export function backgroundUsageModel(
  model: AiModelClient,
  recorder: UsageRecorder,
  defaults: Pick<UsageContext, "conversationType" | "usageLabel" | "mode">,
): AiModelClient {
  return {
    async generateStructured(input) {
      const current = usageContext.getStore();
      if (current?.conversationOwned) return model.generateStructured(input);
      const id = randomUUID();
      const call: UsageCall = {
        ...emptyTokens,
        id,
        conversationId: current?.conversationId ?? id,
        conversationType:
          current?.conversationType ?? defaults.conversationType,
        messageId: current?.messageId ?? id,
        usageLabel: current?.usageLabel ?? defaults.usageLabel ?? "AI işlemi",
        provider: aiProvider(),
        model: input.model,
        mode: current?.mode ?? defaults.mode ?? "ANALYSIS",
        status: "RUNNING",
        startedAt: new Date(),
        completedAt: null,
      };
      await recorder.save(call);
      try {
        const response = await model.generateStructured({
          ...input,
          onUsage: async (usage) => {
            Object.assign(
              call,
              Object.fromEntries(
                Object.entries(usage).filter(([, v]) => v !== null),
              ),
            );
            await recorder.save(call);
            await input.onUsage?.(usage);
          },
        });
        Object.assign(
          call,
          Object.fromEntries(
            Object.entries(response.usage).filter(([, v]) => v !== null),
          ),
        );
        call.status = "COMPLETED";
        return response;
      } catch (error) {
        call.status = "FAILED";
        throw error;
      } finally {
        call.completedAt = new Date();
        await recorder.save(call);
      }
    },
  };
}
