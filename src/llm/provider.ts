import type { LanguageModelUsage } from "ai";

export interface LlmHistoryItem {
  role: "system" | "user" | "assistant";
  content: string;
}

export type LlmUsage = LanguageModelUsage;

export function getCachedInputTokens(usage?: LlmUsage): number | undefined {
  return usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens;
}

export interface LlmProvider {
  respond(input: {
    system: string;
    history: LlmHistoryItem[];
    message: string;
    model: string;
  }): Promise<{
    text: string;
    usage?: LlmUsage;
  }>;
}
