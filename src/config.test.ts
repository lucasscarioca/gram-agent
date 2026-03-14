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
    EXA_API_KEY: undefined,
    DEFAULT_MODEL: undefined,
    ALLOWED_MODELS: undefined,
    MAX_TOOL_CALLS_PER_RUN: undefined,
    MAX_WEB_SEARCHES_PER_RUN: undefined,
    MAX_WEB_FETCHES_PER_RUN: undefined,
    MAX_WEB_FETCH_BYTES: undefined,
    SHOW_TOOL_STATUS_MESSAGES: undefined,
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

  it("applies tool config defaults and boolean parsing", () => {
    const config = getConfig(
      createEnv({
        EXA_API_KEY: "exa-key",
        MAX_TOOL_CALLS_PER_RUN: "12",
        MAX_WEB_SEARCHES_PER_RUN: "3",
        MAX_WEB_FETCHES_PER_RUN: "5",
        MAX_WEB_FETCH_BYTES: "1234",
        SHOW_TOOL_STATUS_MESSAGES: "false",
      }),
    );

    expect(config.exaApiKey).toBe("exa-key");
    expect(config.maxToolCallsPerRun).toBe(12);
    expect(config.maxWebSearchesPerRun).toBe(3);
    expect(config.maxWebFetchesPerRun).toBe(5);
    expect(config.maxWebFetchBytes).toBe(1234);
    expect(config.showToolStatusMessages).toBe(false);
  });
});
