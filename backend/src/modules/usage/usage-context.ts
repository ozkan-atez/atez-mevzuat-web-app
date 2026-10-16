import { AsyncLocalStorage } from "node:async_hooks";
import type { UsageCall } from "./measurement";

export interface UsageContext {
  conversationId: string;
  conversationType: UsageCall["conversationType"];
  messageId?: string;
  mode?: UsageCall["mode"];
  usageLabel?: string;
  conversationOwned?: boolean;
}
export const usageContext = new AsyncLocalStorage<UsageContext>();
export const withUsageContext = <T>(value: UsageContext, action: () => T): T =>
  usageContext.run(value, action);
