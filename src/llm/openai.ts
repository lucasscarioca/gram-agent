import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

import type { LlmProvider, LlmUsage } from "./provider";

export class OpenAiLlmProvider implements LlmProvider {
  private readonly openai;

  constructor(apiKey: string) {
    this.openai = createOpenAI({ apiKey });
  }

  getModel(model: string) {
    return this.openai(model);
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
