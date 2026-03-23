import { describe, expect, it } from "vitest";

import { getConfig } from "./config";
import type { EnvBindings } from "./types";

function createEnv(overrides: Partial<EnvBindings> = {}): EnvBindings {
  return {
    DB: {} as D1Database,
    ASSETS: { fetch: async () => new Response("ok") } as unknown as Fetcher,
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
    ADMIN_ENABLED: undefined,
    ADMIN_BASE_URL: undefined,
    TEAM_DOMAIN: undefined,
    POLICY_AUD: undefined,
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
    expect(config.allowedTranscriptionModels).toEqual(["google:gemini-2.5-flash"]);
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
    expect(config.allowedTranscriptionModels).toEqual(["google:gemini-2.5-flash", "openai:whisper-1"]);
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

  it("applies context management defaults and overrides", () => {
    const defaults = getConfig(createEnv());
    expect(defaults.defaultContextWindowTokens).toBe(290_000);
    expect(defaults.contextReserveTokens).toBe(24_000);
    expect(defaults.contextWarnThreshold).toBe(0.72);
    expect(defaults.contextCompactThreshold).toBe(0.86);

    const custom = getConfig(
      createEnv({
        DEFAULT_CONTEXT_WINDOW_TOKENS: "310000",
        CONTEXT_RESERVE_TOKENS: "12000",
        CONTEXT_WARN_THRESHOLD: "0.5",
        CONTEXT_COMPACT_THRESHOLD: "0.8",
      }),
    );

    expect(custom.defaultContextWindowTokens).toBe(310_000);
    expect(custom.contextReserveTokens).toBe(12_000);
    expect(custom.contextWarnThreshold).toBe(0.5);
    expect(custom.contextCompactThreshold).toBe(0.8);
  });

  it("parses admin dashboard config", () => {
    const config = getConfig(
      createEnv({
        ADMIN_ENABLED: "true",
        ADMIN_BASE_URL: "https://gram.example.com/admin",
        TEAM_DOMAIN: "https://team.cloudflareaccess.com",
        POLICY_AUD: "aud-tag",
      }),
    );

    expect(config.adminEnabled).toBe(true);
    expect(config.adminBaseUrl).toBe("https://gram.example.com/admin");
    expect(config.teamDomain).toBe("https://team.cloudflareaccess.com");
    expect(config.policyAud).toBe("aud-tag");
  });

  it("fails for invalid ALLOWED_CHAT_ID values", () => {
    expect(() =>
      getConfig(
        createEnv({
          ALLOWED_CHAT_ID: "abc",
        }),
      ),
    ).toThrow();
  });
});
