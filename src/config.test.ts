import { describe, expect, it } from "vitest";

import { getConfig } from "./config";
import type { EnvBindings } from "./types";

function createEnv(overrides: Partial<EnvBindings> = {}): EnvBindings {
  return {
    DB: {} as D1Database,
    TELEGRAM_BOT_TOKEN: "bot-token",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    ALLOWED_TELEGRAM_USER_ID: "123",
    ALLOWED_CHAT_ID: "456",
    GOOGLE_GENERATIVE_AI_API_KEY: "google-key",
    OPENAI_API_KEY: undefined,
    ANTHROPIC_API_KEY: undefined,
    OPENROUTER_API_KEY: undefined,
    DEFAULT_MODEL: undefined,
    ALLOWED_MODELS: undefined,
    ...overrides,
  };
}

describe("getConfig", () => {
  it("filters models whose provider keys are missing", () => {
    const config = getConfig(
      createEnv({
        ALLOWED_MODELS: "google:gemini-2.5-flash,openai:gpt-5.1",
      }),
    );

    expect(config.allowedModels).toEqual(["google:gemini-2.5-flash"]);
    expect(config.defaultModel).toBe("google:gemini-2.5-flash");
  });

  it("keeps configured providers and qualified defaults", () => {
    const config = getConfig(
      createEnv({
        OPENAI_API_KEY: "openai-key",
        DEFAULT_MODEL: "openai:gpt-5.1",
        ALLOWED_MODELS: "google:gemini-2.5-flash,openai:gpt-5.1",
      }),
    );

    expect(config.allowedModels).toEqual(["google:gemini-2.5-flash", "openai:gpt-5.1"]);
    expect(config.defaultModel).toBe("openai:gpt-5.1");
  });

  it("fails for unknown configured models", () => {
    expect(() =>
      getConfig(
        createEnv({
          ALLOWED_MODELS: "google:gemini-2.5-flash,openai:not-real",
        }),
      ),
    ).toThrow("Unknown model in ALLOWED_MODELS");
  });
});
