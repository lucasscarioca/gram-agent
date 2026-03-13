import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

import type { LlmProvider, LlmUsage } from "./provider";

export class AnthropicLlmProvider implements LlmProvider {
  private readonly anthropic;

  constructor(apiKey: string) {
    this.anthropic = createAnthropic({ apiKey });
  }

  async respond(input: {
    system: string;
    history: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    message: string;
    model: string;
  }): Promise<{
    text: string;
    usage?: LlmUsage;
  }> {
    const result = await generateText({
      model: this.anthropic(input.model),
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
      usage: result.usage,
    };
  }
}
