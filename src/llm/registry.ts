import { AnthropicLlmProvider } from "./anthropic";
import { getModelSpec, type ProviderId, type QualifiedModelId } from "./catalog";
import { GoogleLlmProvider } from "./google";
import { OpenAiLlmProvider } from "./openai";
import { OpenRouterLlmProvider } from "./openrouter";
import type { LlmProvider, LlmUsage } from "./provider";

interface ProviderClients {
  google?: LlmProvider;
  openai?: LlmProvider;
  anthropic?: LlmProvider;
  openrouter?: LlmProvider;
}

export class LlmRegistry {
  constructor(private readonly clients: ProviderClients) {}

  static fromConfig(input: {
    googleApiKey?: string;
    openAiApiKey?: string;
    anthropicApiKey?: string;
    openRouterApiKey?: string;
  }): LlmRegistry {
    return new LlmRegistry({
      google: input.googleApiKey ? new GoogleLlmProvider(input.googleApiKey) : undefined,
      openai: input.openAiApiKey ? new OpenAiLlmProvider(input.openAiApiKey) : undefined,
      anthropic: input.anthropicApiKey ? new AnthropicLlmProvider(input.anthropicApiKey) : undefined,
      openrouter: input.openRouterApiKey ? new OpenRouterLlmProvider(input.openRouterApiKey) : undefined,
    });
  }

  hasProvider(provider: ProviderId): boolean {
    return this.getClient(provider) !== null;
  }

  async respond(input: {
    system: string;
    history: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    message: string;
    model: QualifiedModelId;
  }): Promise<{
    provider: ProviderId;
    rawModelId: string;
    text: string;
    usage?: LlmUsage;
  }> {
    const spec = getModelSpec(input.model);

    if (!spec) {
      throw new Error(`Unsupported model: ${input.model}`);
    }

    const client = this.getClient(spec.provider);

    if (!client) {
      throw new Error(`Provider not configured: ${spec.provider}`);
    }

    const response = await client.respond({
      system: input.system,
      history: input.history,
      message: input.message,
      model: spec.modelId,
    });

    return {
      provider: spec.provider,
      rawModelId: spec.modelId,
      text: response.text,
      usage: response.usage,
    };
  }

  private getClient(provider: ProviderId): LlmProvider | null {
    if (provider === "google") {
      return this.clients.google ?? null;
    }

    if (provider === "openai") {
      return this.clients.openai ?? null;
    }

    if (provider === "anthropic") {
      return this.clients.anthropic ?? null;
    }

    return this.clients.openrouter ?? null;
  }
}
