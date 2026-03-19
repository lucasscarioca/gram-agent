import { describe, expect, it } from "vitest";

import { buildSessionContext, compactSession, shouldSendContextWarning } from "./context";
import type { AppConfig } from "../config";
import { Repo } from "../db/repo";
import { LlmRegistry } from "../llm/registry";
import type { MessageRow, SessionRow } from "../types";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    telegramBotToken: "token",
    telegramWebhookSecret: "secret",
    allowedTelegramUserId: 1,
    allowedChatId: 1,
    googleApiKey: "google",
    openAiApiKey: undefined,
    anthropicApiKey: undefined,
    openRouterApiKey: undefined,
    exaApiKey: undefined,
    allowedModels: ["google:gemini-2.5-flash"],
    allowedTranscriptionModels: [],
    defaultModel: "google:gemini-2.5-flash",
    maxToolCallsPerRun: 8,
    maxWebSearchesPerRun: 2,
    maxWebFetchesPerRun: 4,
    maxWebFetchBytes: 250_000,
    defaultContextWindowTokens: 4_000,
    contextReserveTokens: 500,
    contextWarnThreshold: 0.5,
    contextCompactThreshold: 0.75,
    showToolStatusMessages: true,
    adminEnabled: false,
    adminBaseUrl: undefined,
    teamDomain: undefined,
    policyAud: undefined,
    ...overrides,
  };
}

function createSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    chat_id: 1,
    user_id: 1,
    title: "Test",
    title_source: "manual",
    title_updated_at: "2026-03-14T00:00:00.000Z",
    last_auto_title_message_count: 0,
    selected_model: "openrouter:openai/gpt-oss-120b",
    compacted_summary: null,
    compacted_at: null,
    last_compacted_message_id: null,
    last_context_warning_at: null,
    created_at: "2026-03-14T00:00:00.000Z",
    last_message_at: "2026-03-14T00:00:00.000Z",
    ...overrides,
  };
}

function createMessage(index: number, length = 600): MessageRow {
  return {
    id: `m${index}`,
    session_id: "session-1",
    chat_id: 1,
    telegram_message_id: index,
    role: index % 2 === 0 ? "assistant" : "user",
    content_text: `message ${index} ${"x".repeat(length)}`,
    created_at: new Date(Date.UTC(2026, 2, 14, 0, 0, index)).toISOString(),
  };
}

describe("context manager", () => {
  it("builds a budgeted context and emits a warning decision", async () => {
    const messages = Array.from({ length: 8 }, (_, index) => createMessage(index + 1, 1_200));
    const repo = {
      getSessionMessages: async () => messages,
    } as unknown as Repo;

    const result = await buildSessionContext({
      session: createSession({
        compacted_summary: "- user prefers concise answers",
      }),
      repo,
      config: createConfig({
        defaultContextWindowTokens: 3_200,
        contextReserveTokens: 400,
        contextCompactThreshold: 0.95,
      }),
      systemPrompt: "System prompt",
    });

    expect(result.decision).toBe("warn");
    expect(result.messages[0]).toMatchObject({
      role: "system",
    });
    expect(result.stats.totalRawMessageCount).toBe(8);
    expect(result.stats.includedMessageCount).toBeLessThanOrEqual(8);
  });

  it("compacts older messages into session memory", async () => {
    const messages = Array.from({ length: 10 }, (_, index) => createMessage(index + 1, 900));
    const session = createSession();
    const repoState = { session };
    const repo = {
      getSessionMessages: async () => messages,
      updateSessionCompaction: async (input: {
        sessionId: string;
        compactedSummary: string;
        compactedAt: string;
        lastCompactedMessageId: string;
      }) => {
        repoState.session = {
          ...repoState.session,
          compacted_summary: input.compactedSummary,
          compacted_at: input.compactedAt,
          last_compacted_message_id: input.lastCompactedMessageId,
          last_context_warning_at: null,
        };
      },
      getSession: async () => repoState.session,
    } as unknown as Repo;
    const llm = {
      respond: async () => ({
        provider: "google" as const,
        rawModelId: "gemini-2.5-flash",
        text: "- keep project constraints\n- remember pending follow-up",
        usage: undefined,
      }),
    } as unknown as LlmRegistry;

    const result = await compactSession({
      session,
      repo,
      llm,
      config: createConfig(),
      systemPrompt: "System prompt",
    });

    expect(result.status).toBe("compacted");
    expect(result.compactedMessageCount).toBeGreaterThan(0);
    expect(repoState.session.compacted_summary).toContain("keep project constraints");
    expect(repoState.session.last_compacted_message_id).not.toBeNull();
  });

  it("warns only once per cooldown window unless after compaction", () => {
    const session = createSession({
      last_context_warning_at: "2026-03-14T00:00:00.000Z",
    });

    expect(shouldSendContextWarning(session, "2026-03-14T01:00:00.000Z", "warn")).toBe(false);
    expect(shouldSendContextWarning(session, "2026-03-14T07:00:01.000Z", "warn")).toBe(true);
    expect(
      shouldSendContextWarning(
        {
          ...session,
          compacted_at: "2026-03-14T02:00:00.000Z",
        },
        "2026-03-14T02:00:01.000Z",
        "warn",
      ),
    ).toBe(true);
    expect(shouldSendContextWarning(session, "2026-03-14T07:00:01.000Z", "ok")).toBe(false);
  });
});
