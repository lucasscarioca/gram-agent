import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

import type { LlmProvider } from "./provider";

export class OpenAiLlmProvider implements LlmProvider {
  private readonly openai;

  constructor(apiKey: string) {
    this.openai = createOpenAI({ apiKey });
  }

  async respond(input: {
    system: string;
    history: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    message: string;
    model: string;
  }): Promise<{
    text: string;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      cachedInputTokens?: number;
    };
  }> {
    const result = await generateText({
      model: this.openai(input.model),
      system: input.system,
      messages: [
        ...input.history.map((item) => ({
          role: item.role,
          content: item.content,
        })),
        {
          role: "user" as const,
          content: input.message,
        },
      ],
    });

    return {
      text: result.text,
      usage: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        cachedInputTokens:
          result.usage?.cachedInputTokens ?? result.usage?.inputTokenDetails?.cacheReadTokens,
      },
    };
  }
}
