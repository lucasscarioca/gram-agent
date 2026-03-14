import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import type { LlmProvider, LlmUsage } from "./provider";

export class OpenRouterLlmProvider implements LlmProvider {
  private readonly openrouter;

  constructor(apiKey: string) {
    this.openrouter = createOpenAICompatible({
      name: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      apiKey,
    });
  }

  getModel(model: string) {
    return this.openrouter(model);
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
      model: this.getModel(input.model),
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
