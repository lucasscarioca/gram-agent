export interface LlmHistoryItem {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
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
