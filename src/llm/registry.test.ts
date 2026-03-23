import { describe, expect, it, vi } from "vitest";

const googleGetModel = vi.fn();
const googleGetTranscriptionModel = vi.fn();
const openAiGetModel = vi.fn();

vi.mock("./google", () => ({
  GoogleLlmProvider: class {
    getModel(modelId: string) {
      return googleGetModel(modelId);
    }

    getTranscriptionModel(modelId: string) {
      return googleGetTranscriptionModel(modelId);
    }
  },
}));

vi.mock("./openai", () => ({
  OpenAiLlmProvider: class {
    getModel(modelId: string) {
      return openAiGetModel(modelId);
    }
  },
}));

vi.mock("./anthropic", () => ({
  AnthropicLlmProvider: class {},
}));

vi.mock("./openrouter", () => ({
  OpenRouterLlmProvider: class {},
}));

import { LlmRegistry } from "./registry";

describe("LlmRegistry", () => {
  it("instantiates configured providers and delegates model lookup", () => {
    googleGetModel.mockReturnValue("google-model");

    const registry = LlmRegistry.fromConfig({
      googleApiKey: "google-key",
      openAiApiKey: "openai-key",
    });

    expect(registry.hasProvider("google")).toBe(true);
    expect(registry.hasProvider("openai")).toBe(true);
    expect(registry.hasProvider("anthropic")).toBe(false);
    expect(registry.getModel("google:gemini-2.5-flash")).toBe("google-model");
    expect(googleGetModel).toHaveBeenCalledWith("gemini-2.5-flash");
  });

  it("delegates transcription model lookup to the configured provider", () => {
    googleGetTranscriptionModel.mockReturnValue("transcription-model");

    const registry = LlmRegistry.fromConfig({
      googleApiKey: "google-key",
    });

    expect(registry.getTranscriptionModel("google:gemini-2.5-flash")).toBe("transcription-model");
    expect(googleGetTranscriptionModel).toHaveBeenCalledWith("gemini-2.5-flash");
  });

  it("throws when a provider is not configured", () => {
    const registry = LlmRegistry.fromConfig({
      googleApiKey: "google-key",
    });

    expect(() => registry.getModel("openai:gpt-5.1")).toThrow("Provider not configured: openai");
  });
});
