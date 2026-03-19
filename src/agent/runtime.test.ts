import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn(() => "stop-when"),
  tool: vi.fn((definition: unknown) => definition),
}));

import { generateText } from "ai";

import {
  buildQuestionAnswerFromSelection,
  executeAgentRun,
  formatQuestionPrompt,
  resumeAgentRunFromApproval,
  resumeAgentRunFromQuestionAnswer,
} from "./runtime";
import type { QuestionState } from "./types";
import type { AppConfig } from "../config";
import type { PendingQuestionRow, PendingToolApprovalRow, SessionRow } from "../types";

function createQuestion(overrides: Partial<QuestionState> = {}): QuestionState {
  return {
    id: "q1",
    prompt: "Pick a color",
    kind: "single_select",
    options: [
      { value: "red", label: "Red" },
      { value: "blue", label: "Blue" },
    ],
    allowOther: false,
    minSelections: 1,
    maxSelections: 1,
    submitLabel: undefined,
    cancelLabel: undefined,
    selectedIndexes: [],
    displayMessageId: null,
    ...overrides,
  };
}

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

function createServices() {
  const repo = {
    getAgentRun: vi.fn().mockResolvedValue({
      run_id: "run-1",
      session_id: "session-1",
      chat_id: 1,
      reply_to_message_id: 99,
      status: "started",
      model: "google:gemini-2.5-flash",
      provider: "google",
      messages_json: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      last_error: null,
      created_at: "2026-03-15T00:00:00.000Z",
      updated_at: "2026-03-15T00:00:00.000Z",
      completed_at: null,
    }),
    deletePendingToolApprovalsForRun: vi.fn().mockResolvedValue(undefined),
    deletePendingQuestionsForRun: vi.fn().mockResolvedValue(undefined),
    setAgentRunStatus: vi.fn().mockResolvedValue(undefined),
    updateAgentRunMessages: vi.fn().mockResolvedValue(undefined),
    getPendingQuestionForChat: vi.fn().mockResolvedValue(null),
    appendMessage: vi.fn().mockResolvedValue(undefined),
    completeRun: vi.fn().mockResolvedValue(undefined),
    failRun: vi.fn().mockResolvedValue(undefined),
    createPendingToolApproval: vi.fn().mockResolvedValue(undefined),
    updateToolCallStatus: vi.fn().mockResolvedValue(undefined),
    getToolCall: vi.fn().mockResolvedValue(null),
    deletePendingToolApproval: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue(createSession()),
    putToolPermission: vi.fn().mockResolvedValue(undefined),
    deletePendingQuestion: vi.fn().mockResolvedValue(undefined),
  };
  const telegram = {
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 123 }),
    editMessageText: vi.fn().mockResolvedValue(undefined),
  };
  const llm = {
    getModel: vi.fn().mockReturnValue({}),
  };

  return {
    services: {
      config: createConfig(),
      repo: repo as never,
      telegram: telegram as never,
      llm: llm as never,
      systemPrompt: "System prompt",
    },
    repo,
    telegram,
  };
}

describe("question helpers", () => {
  it("formats multi-select prompts with guidance", () => {
    expect(formatQuestionPrompt(createQuestion({ kind: "multi_select" }))).toContain("Pick one or more options");
  });

  it("builds answers from selected indexes", () => {
    expect(
      buildQuestionAnswerFromSelection({
        question: createQuestion(),
        selectedIndexes: [1],
      }),
    ).toEqual({
      prompt: "Pick a color",
      kind: "single_select",
      values: ["blue"],
      labels: ["Blue"],
      freeText: undefined,
      confirmed: undefined,
    });
  });
});

describe("executeAgentRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes a normal assistant response", async () => {
    const { services, repo, telegram } = createServices();
    vi.mocked(generateText).mockResolvedValue({
      text: "Done",
      content: [],
      response: { messages: [{ role: "assistant", content: "Done" }] },
      totalUsage: { inputTokens: 100, outputTokens: 25 },
    } as never);

    await executeAgentRun({ runId: "run-1", session: createSession(), services });

    expect(telegram.sendMessage).toHaveBeenCalledWith(1, expect.any(String), { replyToMessageId: 99 });
    expect(repo.appendMessage).toHaveBeenCalledWith(expect.objectContaining({ role: "assistant", contentText: "Done" }));
    expect(repo.completeRun).toHaveBeenCalled();
    expect(repo.setAgentRunStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
  });

  it("waits for permission when tool approval is requested", async () => {
    const { services, repo, telegram } = createServices();
    vi.mocked(generateText).mockResolvedValue({
      text: "",
      content: [
        {
          type: "tool-approval-request",
          approvalId: "approval-1",
          toolCall: {
            toolCallId: "tool-1",
            toolName: "web_fetch",
            input: { url: "https://example.com/post" },
          },
        },
      ],
      response: { messages: [] },
      totalUsage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await executeAgentRun({ runId: "run-1", session: createSession(), services });

    expect(repo.createPendingToolApproval).toHaveBeenCalled();
    expect(repo.setAgentRunStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "waiting_permission" }));
    expect(telegram.sendMessage).not.toHaveBeenCalledWith(1, expect.stringContaining("Done"), expect.anything());
  });

  it("waits for a user question when a pending question exists", async () => {
    const { services, repo, telegram } = createServices();
    repo.getPendingQuestionForChat.mockResolvedValue({ id: "pq-1", run_id: "run-1" });
    vi.mocked(generateText).mockResolvedValue({
      text: "",
      content: [],
      response: { messages: [] },
      totalUsage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await executeAgentRun({ runId: "run-1", session: createSession(), services });

    expect(repo.setAgentRunStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "waiting_question" }));
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("fails gracefully when generation throws", async () => {
    const { services, repo, telegram } = createServices();
    vi.mocked(generateText).mockRejectedValue(new Error("boom"));

    await executeAgentRun({ runId: "run-1", session: createSession(), services });

    expect(repo.failRun).toHaveBeenCalledWith("run-1", "boom");
    expect(repo.setAgentRunStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", lastError: "boom" }));
    expect(telegram.sendMessage).toHaveBeenCalledWith(1, "Agent request failed. Try again.", { replyToMessageId: 99 });
  });
});

describe("resume flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records denied approvals and resumes the run", async () => {
    const { services, repo } = createServices();
    const approval: PendingToolApprovalRow = {
      id: "approval-1",
      run_id: "run-1",
      tool_call_id: "tool-1",
      chat_id: 1,
      tool_name: "web_fetch",
      scope_type: "domain",
      scope_value: "example.com",
      request_json: "{}",
      created_at: "2026-03-15T00:00:00.000Z",
    };
    vi.mocked(generateText).mockResolvedValue({
      text: "Done",
      content: [],
      response: { messages: [] },
      totalUsage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await resumeAgentRunFromApproval({
      approval,
      decision: "deny",
      services,
    });

    expect(repo.updateAgentRunMessages).toHaveBeenCalled();
    expect(repo.deletePendingToolApproval).toHaveBeenCalledWith("approval-1");
    expect(repo.updateToolCallStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tool-1",
        status: "completed",
        summaryText: "Permission denied for example.com.",
      }),
    );
  });

  it("persists always-allow permissions before resuming", async () => {
    const { services, repo } = createServices();
    const approval: PendingToolApprovalRow = {
      id: "approval-2",
      run_id: "run-1",
      tool_call_id: "tool-2",
      chat_id: 1,
      tool_name: "web_search",
      scope_type: "provider",
      scope_value: "exa",
      request_json: "{}",
      created_at: "2026-03-15T00:00:00.000Z",
    };
    vi.mocked(generateText).mockResolvedValue({
      text: "Done",
      content: [],
      response: { messages: [] },
      totalUsage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await resumeAgentRunFromApproval({ approval, decision: "always", services });

    expect(repo.putToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        toolName: "web_search",
        scopeType: "provider",
        scopeValue: "exa",
      }),
    );
  });

  it("records question answers and resumes the run", async () => {
    const { services, repo } = createServices();
    const pendingQuestion: PendingQuestionRow = {
      id: "pq-1",
      run_id: "run-1",
      tool_call_id: "tool-3",
      chat_id: 1,
      question_kind: "single_select",
      question_json: JSON.stringify(createQuestion()),
      created_at: "2026-03-15T00:00:00.000Z",
    };
    vi.mocked(generateText).mockResolvedValue({
      text: "Done",
      content: [],
      response: { messages: [] },
      totalUsage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await resumeAgentRunFromQuestionAnswer({
      pendingQuestion,
      answer: {
        prompt: "Pick a color",
        kind: "single_select",
        values: ["blue"],
        labels: ["Blue"],
      },
      services,
    });

    expect(repo.updateAgentRunMessages).toHaveBeenCalled();
    expect(repo.updateToolCallStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tool-3", status: "completed", summaryText: "Got the user's answer." }),
    );
    expect(repo.deletePendingQuestion).toHaveBeenCalledWith("pq-1");
  });
});
