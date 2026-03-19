import { describe, expect, it, vi } from "vitest";

import { handleCallback, handleCommand, handleMessage, formatMemoryList, formatStatusMessage } from "./index";
import type { AppConfig } from "./config";
import type { PendingQuestionRow, SessionRow, UsageTotalsRow, MemoryRow } from "./types";
import type { LlmRegistry } from "./llm/registry";

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
    title: "Test session",
    title_source: "manual",
    title_updated_at: "2026-03-15T00:00:00.000Z",
    last_auto_title_message_count: 0,
    selected_model: "google:gemini-2.5-flash",
    compacted_summary: null,
    compacted_at: null,
    last_compacted_message_id: null,
    last_context_warning_at: null,
    created_at: "2026-03-15T00:00:00.000Z",
    last_message_at: "2026-03-15T00:00:00.000Z",
    ...overrides,
  };
}

function createTotals(overrides: Partial<UsageTotalsRow> = {}): UsageTotalsRow {
  return {
    run_count: 3,
    input_tokens: 1200,
    cached_input_tokens: 200,
    output_tokens: 400,
    estimated_cost_usd: 0.123456,
    ...overrides,
  };
}

function createMemory(index: number, content = `memory ${index}`): MemoryRow {
  return {
    id: `mem-${index}`,
    user_id: 1,
    chat_id: 1,
    scope: "chat",
    kind: "note",
    content_text: content,
    status: "active",
    source_session_id: null,
    created_at: "2026-03-15T00:00:00.000Z",
    updated_at: "2026-03-15T00:00:00.000Z",
    last_used_at: null,
  };
}

function createPendingQuestion(overrides: Partial<PendingQuestionRow> = {}): PendingQuestionRow {
  return {
    id: "pq-1",
    run_id: "run-1",
    tool_call_id: "tool-1",
    chat_id: 1,
    question_kind: "free_text",
    question_json: JSON.stringify({
      id: "pq-1",
      prompt: "Tell me more",
      kind: "free_text",
      options: [],
      allowOther: false,
      minSelections: 1,
      maxSelections: 1,
      selectedIndexes: [],
      displayMessageId: 55,
    }),
    created_at: "2026-03-15T00:00:00.000Z",
    ...overrides,
  };
}

function createTelegramMock() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 99 }),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    clearInlineKeyboard: vi.fn().mockResolvedValue(undefined),
  };
}

describe("status output", () => {
  it("includes persistent memory count", () => {
    const message = formatStatusMessage({
      activeSession: createSession(),
      activeMemoryCount: 2,
      sessionTotals: createTotals(),
      globalTotals: createTotals({ run_count: 5 }),
      activeContext: {
        contextWindowTokens: 10000,
        reserveTokens: 1000,
        estimatedTokens: 2500,
        usageRatio: 0.25,
        summaryTokens: 0,
        rawMessageTokens: 2400,
        includedMessageTokens: 2400,
        totalRawMessageCount: 4,
        includedMessageCount: 4,
      },
    });

    expect(message).toContain("Persistent memory: 2 saved");
    expect(message).toContain("Active session: Test session");
  });

  it("formats saved memories for Telegram output", () => {
    expect(formatMemoryList([createMemory(1, "use pnpm"), createMemory(2, "prefer concise replies")])).toBe(
      "Memories\n1. use pnpm\n2. prefer concise replies",
    );
  });
});

describe("command and interaction flows", () => {
  it("saves persistent memory from /remember", async () => {
    const repo = {
      getActiveSession: vi.fn().mockResolvedValue({ id: "session-1" }),
      createMemory: vi.fn().mockResolvedValue(undefined),
    };
    const telegram = createTelegramMock();

    await handleCommand({
      command: "remember",
      commandText: "/remember use pnpm",
      chatId: 1,
      userId: 1,
      replyToMessageId: 10,
      config: createConfig(),
      repo: repo as never,
      telegram: telegram as never,
      llm: {} as LlmRegistry,
    });

    expect(repo.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        chatId: 1,
        scope: "chat",
        kind: "note",
        contentText: "use pnpm",
        sourceSessionId: "session-1",
      }),
    );
    expect(telegram.sendMessage).toHaveBeenCalledWith(1, "Saved to memory.", { replyToMessageId: 10 });
  });

  it("shows empty state for /memories", async () => {
    const repo = {
      listActiveMemoriesForChat: vi.fn().mockResolvedValue([]),
    };
    const telegram = createTelegramMock();

    await handleCommand({
      command: "memories",
      commandText: "/memories",
      chatId: 1,
      userId: 1,
      replyToMessageId: 10,
      config: createConfig(),
      repo: repo as never,
      telegram: telegram as never,
      llm: {} as LlmRegistry,
    });

    expect(telegram.sendMessage).toHaveBeenCalledWith(1, "No saved memories yet. Use /remember <note>.", {
      replyToMessageId: 10,
    });
  });

  it("returns the admin dashboard URL from /dashboard", async () => {
    const repo = {
      countPendingToolApprovalsForChat: vi.fn().mockResolvedValue(2),
      countPendingQuestionsForChat: vi.fn().mockResolvedValue(1),
    };
    const telegram = createTelegramMock();

    await handleCommand({
      command: "dashboard",
      commandText: "/dashboard",
      chatId: 1,
      userId: 1,
      replyToMessageId: 20,
      config: createConfig({
        adminEnabled: true,
        adminBaseUrl: "https://gram.example.com/admin",
        teamDomain: "https://team.cloudflareaccess.com",
        policyAud: "aud-tag",
      }),
      repo: repo as never,
      telegram: telegram as never,
      llm: {} as LlmRegistry,
    });

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("https://gram.example.com/admin"),
      expect.objectContaining({ replyToMessageId: 20 }),
    );
  });

  it("explains when /dashboard is not configured", async () => {
    const telegram = createTelegramMock();

    await handleCommand({
      command: "dashboard",
      commandText: "/dashboard",
      chatId: 1,
      userId: 1,
      replyToMessageId: 21,
      config: createConfig(),
      repo: {} as never,
      telegram: telegram as never,
      llm: {} as LlmRegistry,
    });

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("Dashboard is not configured yet."),
      expect.objectContaining({ replyToMessageId: 21 }),
    );
  });

  it("omits /dashboard from help when admin is not configured", async () => {
    const telegram = createTelegramMock();

    await handleCommand({
      command: "help",
      commandText: "/help",
      chatId: 1,
      userId: 1,
      replyToMessageId: 22,
      config: createConfig(),
      repo: {} as never,
      telegram: telegram as never,
      llm: {} as LlmRegistry,
    });

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      1,
      expect.not.stringContaining("/dashboard open the admin dashboard"),
      expect.objectContaining({ replyToMessageId: 22 }),
    );
  });

  it("clears stale free-text questions when the run is gone", async () => {
    const repo = {
      ensureChat: vi.fn().mockResolvedValue(undefined),
      getPendingChatAction: vi.fn().mockResolvedValue(null),
      getPendingQuestionForChat: vi.fn().mockResolvedValue(createPendingQuestion()),
      getAgentRun: vi.fn().mockResolvedValue(null),
      getSession: vi.fn().mockResolvedValue(null),
      deletePendingQuestion: vi.fn().mockResolvedValue(undefined),
      updateToolCallStatus: vi.fn().mockResolvedValue(undefined),
    };
    const telegram = createTelegramMock();

    await handleMessage({
      message: {
        message_id: 44,
        from: { id: 1 },
        chat: { id: 1, type: "private" },
        text: "answer",
      },
      updateId: 123,
      config: createConfig(),
      repo: repo as never,
      telegram: telegram as never,
      llm: {} as LlmRegistry,
    });

    expect(repo.deletePendingQuestion).toHaveBeenCalledWith("pq-1");
    expect(repo.updateToolCallStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tool-1",
        status: "completed",
      }),
    );
  });

  it("rejects invalid question callback indexes", async () => {
    const repo = {
      ensureChat: vi.fn().mockResolvedValue(undefined),
      getPendingQuestion: vi.fn().mockResolvedValue(
        createPendingQuestion({
          question_kind: "single_select",
          question_json: JSON.stringify({
            id: "pq-2",
            prompt: "Pick one",
            kind: "single_select",
            options: [{ value: "a", label: "A" }],
            allowOther: false,
            minSelections: 1,
            maxSelections: 1,
            selectedIndexes: [],
            displayMessageId: 55,
          }),
        }),
      ),
    };
    const telegram = createTelegramMock();

    await handleCallback({
      callback: {
        id: "cb-1",
        from: { id: 1 },
        data: "qsel:pq-2:9",
        message: {
          message_id: 77,
          chat: { id: 1, type: "private" },
        },
      },
      config: createConfig(),
      repo: repo as never,
      telegram: telegram as never,
      llm: {} as LlmRegistry,
    });

    expect(telegram.answerCallbackQuery).toHaveBeenCalledWith("cb-1", "Option not found");
  });
});
