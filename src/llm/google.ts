import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

import type { LlmProvider } from "./provider";

export class GoogleLlmProvider implements LlmProvider {
  private readonly google;

  constructor(apiKey: string) {
    this.google = createGoogleGenerativeAI({ apiKey });
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
    };
  }> {
    const messages = [
      ...input.history.map((item) => ({
        role: item.role,
        content: item.content,
      })),
      {
        role: "user" as const,
        content: input.message,
      },
    ];

    const result = await generateText({
      model: this.google(input.model),
      system: input.system,
      messages,
    });

    return {
      text: result.text,
      usage: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      },
    };
  }
}
