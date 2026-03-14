import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";

import type { AppConfig } from "../config";
import { Repo } from "../db/repo";
import { estimateCostUsd, getModelSpec } from "../llm/catalog";
import { getCachedInputTokens } from "../llm/provider";
import { LlmRegistry } from "../llm/registry";
import { TelegramClient } from "../telegram/client";
import { renderTelegramHtml } from "../telegram/format";
import { buildQuestionKeyboard, buildToolPermissionKeyboard } from "../telegram/render";
import type { MessageRow, PendingQuestionRow, PendingToolApprovalRow, SessionRow } from "../types";
import { ExaSearchProvider } from "./search";
import type {
  AgentRunState,
  PendingApprovalRequest,
  QuestionAnswer,
  QuestionOption,
  QuestionState,
  ToolDisplayText,
  WebFetchResult,
  WebSearchResult,
} from "./types";
import { assertSafeFetchUrl, fetchWebPage, normalizePermissionScopeFromUrl } from "./web-fetch";

const TOOL_LOOP_INSTRUCTION =
  "You can use tools. Keep tool use concise and Telegram-native. Use at most one tool call per step. Prefer web_search before web_fetch, and ask follow-up questions only when needed.";

const questionInputSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  kind: z.enum(["single_select", "multi_select", "free_text", "confirm"]),
  options: z
    .array(
      z.object({
        value: z.string().min(1),
        label: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .default([]),
  allowOther: z.boolean().optional().default(false),
  minSelections: z.number().int().positive().optional(),
  maxSelections: z.number().int().positive().optional(),
  submitLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
});

type AgentServices = {
  config: AppConfig;
  repo: Repo;
  telegram: TelegramClient;
  llm: LlmRegistry;
  systemPrompt: string;
};

export async function executeAgentRun(input: {
  runId: string;
  session: SessionRow;
  services: AgentServices;
}): Promise<void> {
  const { runId, session, services } = input;
  const { repo, telegram, llm, config, systemPrompt } = services;
  const run = await repo.getAgentRun(runId);

  if (!run) {
    throw new Error(`Agent run not found: ${runId}`);
  }

  const modelSpec = getModelSpec(session.selected_model);

  if (!modelSpec) {
    throw new Error(`Unsupported model: ${session.selected_model}`);
  }

  const searchProvider = config.exaApiKey ? new ExaSearchProvider(config.exaApiKey) : null;
  const state = parseRunState(run.messages_json);
  const toolContext = {
    runId,
    session,
    services,
    searchProvider,
  };

  await repo.deletePendingToolApprovalsForRun(runId);
  await repo.deletePendingQuestionsForRun(runId);
  await repo.setAgentRunStatus({
    runId,
    status: "started",
    now: now(),
    lastError: null,
    completedAt: null,
  });

  await telegram.sendChatAction(session.chat_id, "typing");

  try {
    const tools = createAgentTools(toolContext);
    const result = await generateText({
      model: llm.getModel(modelSpec.id),
      system: `${systemPrompt}\n\n${TOOL_LOOP_INSTRUCTION}`,
      messages: state.messages,
      tools,
      stopWhen: stepCountIs(config.maxToolCallsPerRun + 1),
    });

    const nextMessages = [...state.messages, ...(result.response.messages as ModelMessage[])];
    await repo.updateAgentRunMessages(runId, serializeRunState({ messages: nextMessages }), now());

    const pendingApprovals = await createPendingApprovalsFromResult({
      runId,
      session,
      resultContent: result.content,
      services,
    });

    if (pendingApprovals.length > 0) {
      await repo.setAgentRunStatus({
        runId,
        status: "waiting_permission",
        now: now(),
      });
      return;
    }

    const pendingQuestion = await repo.getPendingQuestionForChat(session.chat_id);

    if (pendingQuestion && pendingQuestion.run_id === runId) {
      await repo.setAgentRunStatus({
        runId,
        status: "waiting_question",
        now: now(),
      });
      return;
    }

    const responseText = result.text.trim() || "Done.";
    const sent = await telegram.sendMessage(session.chat_id, renderTelegramHtml(responseText), {
      replyToMessageId: run.reply_to_message_id,
    });

    await repo.appendMessage({
      id: crypto.randomUUID(),
      sessionId: session.id,
      chatId: session.chat_id,
      telegramMessageId: sent.message_id,
      role: "assistant",
      contentText: responseText,
      now: now(),
    });

    const cachedInputTokens = getCachedInputTokens(result.totalUsage);
    const completedAt = now();
    await repo.completeRun({
      id: runId,
      inputTokens: result.totalUsage.inputTokens,
      cachedInputTokens,
      outputTokens: result.totalUsage.outputTokens,
      estimatedCostUsd: estimateCostUsd({
        modelId: modelSpec.id,
        inputTokens: result.totalUsage.inputTokens,
        cachedInputTokens,
        outputTokens: result.totalUsage.outputTokens,
      }),
    });
    await repo.setAgentRunStatus({
      runId,
      status: "completed",
      now: completedAt,
      completedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown agent error";
    await repo.failRun(runId, message);
    await repo.setAgentRunStatus({
      runId,
      status: "failed",
      now: now(),
      lastError: message,
      completedAt: now(),
    });
    await telegram.sendMessage(session.chat_id, "Agent request failed. Try again.", {
      replyToMessageId: run.reply_to_message_id,
    });
  }
}

export function buildInitialRunState(history: MessageRow[]): AgentRunState {
  return {
    messages: history.map((item) => ({
      role: item.role,
      content: item.content_text,
    })) as ModelMessage[],
  };
}

export async function resumeAgentRunFromApproval(input: {
  approval: PendingToolApprovalRow;
  decision: "deny" | "once" | "always";
  services: AgentServices;
}): Promise<void> {
  const { approval, decision, services } = input;
  const { repo } = services;
  const run = await repo.getAgentRun(approval.run_id);

  if (!run) {
    return;
  }

  const messages = parseRunState(run.messages_json).messages;
  const toolMessage: ModelMessage = {
    role: "tool",
    content: [
      {
        type: "tool-approval-response",
        approvalId: approval.id,
        approved: decision !== "deny",
        ...(decision === "deny" ? { reason: "Blocked by user." } : {}),
      },
    ],
  } as ModelMessage;

  await repo.updateAgentRunMessages(
    approval.run_id,
    serializeRunState({
      messages: [...messages, toolMessage],
    }),
    now(),
  );

  if (decision === "always") {
    await repo.putToolPermission({
      id: crypto.randomUUID(),
      chatId: approval.chat_id,
      toolName: approval.tool_name,
      scopeType: approval.scope_type,
      scopeValue: approval.scope_value,
      now: now(),
    });
  }

  const toolCall = await repo.getToolCall(approval.tool_call_id);

  if (toolCall?.display_message_id) {
    await updateToolDisplay({
      chatId: approval.chat_id,
      messageId: toolCall.display_message_id,
      services,
      text: decision === "deny" ? `Didn't proceed with ${approval.scope_value}.` : `Allowed ${approval.scope_value}.`,
    });
  }

  await repo.deletePendingToolApproval(approval.id);

  if (decision === "deny") {
    await repo.updateToolCallStatus({
      id: approval.tool_call_id,
      status: "completed",
      now: now(),
      outputJson: JSON.stringify({ denied: true, scopeValue: approval.scope_value }),
      summaryText: `Permission denied for ${approval.scope_value}.`,
    });
  }

  const session = await repo.getSession(run.session_id);

  if (!session) {
    return;
  }

  await executeAgentRun({
    runId: approval.run_id,
    session,
    services,
  });
}

export async function resumeAgentRunFromQuestionAnswer(input: {
  pendingQuestion: PendingQuestionRow;
  answer: QuestionAnswer;
  services: AgentServices;
}): Promise<void> {
  const { pendingQuestion, answer, services } = input;
  const { repo } = services;
  const run = await repo.getAgentRun(pendingQuestion.run_id);

  if (!run) {
    return;
  }

  const messages = parseRunState(run.messages_json).messages;
  const toolMessage: ModelMessage = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: pendingQuestion.tool_call_id,
        toolName: "question",
        output: {
          type: "text",
          value: `User answered "${answer.prompt}": ${summarizeQuestionAnswer(answer) || "Canceled"}`,
        },
      },
    ],
  } as unknown as ModelMessage;

  await repo.updateAgentRunMessages(
    pendingQuestion.run_id,
    serializeRunState({
      messages: [...messages, toolMessage],
    }),
    now(),
  );
  await repo.updateToolCallStatus({
    id: pendingQuestion.tool_call_id,
    status: "completed",
    now: now(),
    outputJson: JSON.stringify(answer),
    summaryText: "Got the user's answer.",
  });
  await repo.deletePendingQuestion(pendingQuestion.id);

  const session = await repo.getSession(run.session_id);

  if (!session) {
    return;
  }

  await executeAgentRun({
    runId: pendingQuestion.run_id,
    session,
    services,
  });
}

function createAgentTools(input: {
  runId: string;
  session: SessionRow;
  services: AgentServices;
  searchProvider: ExaSearchProvider | null;
}) {
  const { services, session, runId, searchProvider } = input;
  const { config, repo } = services;

  return {
    datetime: tool({
      description: "Get the current UTC date and time.",
      inputSchema: z.object({}),
      async onInputAvailable(options) {
        await repo.upsertToolCall({
          id: options.toolCallId,
          runId,
          toolName: "datetime",
          status: "started",
          inputJson: JSON.stringify({}),
          now: now(),
        });
      },
      async execute(_, options) {
        const value = new Date().toISOString();
        await repo.updateToolCallStatus({
          id: options.toolCallId,
          status: "completed",
          now: now(),
          outputJson: JSON.stringify({ iso: value }),
          summaryText: "Checked the current date and time.",
        });
        return {
          iso: value,
          utc: new Date(value).toUTCString(),
        };
      },
      toModelOutput({ output }) {
        return {
          type: "text",
          value: `Current UTC time: ${output.utc} (${output.iso})`,
        };
      },
    }),
    web_search: tool({
      description: "Search the web for recent information. Use this for current events or fresh information.",
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().positive().max(8).optional(),
        domains: z.array(z.string().min(1)).optional(),
        recencyDays: z.number().int().positive().max(365).optional(),
      }),
      async onInputAvailable(options) {
        await repo.upsertToolCall({
          id: options.toolCallId,
          runId,
          toolName: "web_search",
          status: "started",
          inputJson: JSON.stringify(options.input),
          now: now(),
        });
        await ensureToolStatus({
          toolCallId: options.toolCallId,
          runId,
          chatId: session.chat_id,
          services,
          display: {
            pending: "Looking on the web for recent info...",
            complete: "Checked the web.",
          },
        });
      },
      async needsApproval() {
        const permission = await repo.getToolPermission({
          chatId: session.chat_id,
          toolName: "web_search",
          scopeType: "provider",
          scopeValue: "exa",
        });
        return permission === null;
      },
      async execute(args, options) {
        if (!searchProvider) {
          throw new Error("Web search is not configured.");
        }

        if ((await repo.countToolCalls(runId)) > config.maxToolCallsPerRun) {
          throw new Error("Tool call limit reached.");
        }

        if ((await repo.countToolCalls(runId, "web_search")) > config.maxWebSearchesPerRun) {
          throw new Error("Web search limit reached.");
        }

        const result = await searchProvider.search({
          query: args.query,
          limit: args.limit ?? 5,
          domains: args.domains,
          recencyDays: args.recencyDays,
          signal: options.abortSignal,
        });

        await repo.updateToolCallStatus({
          id: options.toolCallId,
          status: "completed",
          now: now(),
          outputJson: JSON.stringify(result),
          summaryText: `Checked the web and found ${result.results.length} results.`,
        });
        await completeToolStatus({
          toolCallId: options.toolCallId,
          chatId: session.chat_id,
          services,
          text: `Checked the web and found ${result.results.length} relevant result${result.results.length === 1 ? "" : "s"}.`,
        });

        return result;
      },
      toModelOutput({ output }) {
        return {
          type: "text",
          value: formatWebSearchForModel(output),
        };
      },
    }),
    web_fetch: tool({
      description: "Fetch and read one web page. Use this after web_search when you need page details.",
      inputSchema: z.object({
        url: z.string().url(),
      }),
      async onInputAvailable(options) {
        await repo.upsertToolCall({
          id: options.toolCallId,
          runId,
          toolName: "web_fetch",
          status: "started",
          inputJson: JSON.stringify(options.input),
          now: now(),
        });
        const scopeValue = normalizePermissionScopeFromUrl(options.input.url);
        await ensureToolStatus({
          toolCallId: options.toolCallId,
          runId,
          chatId: session.chat_id,
          services,
          display: {
            pending: `Opening ${scopeValue}...`,
            complete: `Read ${scopeValue}.`,
          },
        });
      },
      async needsApproval(args) {
        const scopeValue = normalizePermissionScopeFromUrl(args.url);
        const permission = await repo.getToolPermission({
          chatId: session.chat_id,
          toolName: "web_fetch",
          scopeType: "domain",
          scopeValue,
        });
        return permission === null;
      },
      async execute(args, options) {
        if ((await repo.countToolCalls(runId)) > config.maxToolCallsPerRun) {
          throw new Error("Tool call limit reached.");
        }

        if ((await repo.countToolCalls(runId, "web_fetch")) > config.maxWebFetchesPerRun) {
          throw new Error("Web fetch limit reached.");
        }

        const result = await fetchWebPage({
          url: args.url,
          maxBytes: config.maxWebFetchBytes,
          signal: options.abortSignal,
        });

        await repo.updateToolCallStatus({
          id: options.toolCallId,
          status: "completed",
          now: now(),
          outputJson: JSON.stringify(result),
          summaryText: `Read ${result.domain}.`,
        });
        await completeToolStatus({
          toolCallId: options.toolCallId,
          chatId: session.chat_id,
          services,
          text: `Read ${result.domain}.`,
        });

        return result;
      },
      toModelOutput({ output }) {
        return {
          type: "text",
          value: formatWebFetchForModel(output),
        };
      },
    }),
    question: tool({
      description:
        "Ask the Telegram user a structured follow-up question. Use this when you need a preference, choice, confirmation, or short free-text answer.",
      inputSchema: questionInputSchema,
      async onInputAvailable(options) {
        await repo.upsertToolCall({
          id: options.toolCallId,
          runId,
          toolName: "question",
          status: "waiting_user",
          inputJson: JSON.stringify(options.input),
          now: now(),
        });

        const state = normalizeQuestionState({
          toolCallId: options.toolCallId,
          input: options.input,
        });
        const sent = await services.telegram.sendMessage(
          session.chat_id,
          renderTelegramHtml(formatQuestionPrompt(state)),
          {
            replyToMessageId: options.messages.length === 0 ? undefined : undefined,
            inlineKeyboard: buildQuestionKeyboard(state),
          },
        );

        state.displayMessageId = sent.message_id;
        await repo.updateToolCallDisplayMessage(options.toolCallId, sent.message_id, now());
        await repo.createPendingQuestion({
          id: state.id,
          runId,
          toolCallId: options.toolCallId,
          chatId: session.chat_id,
          questionKind: state.kind,
          questionJson: JSON.stringify(state),
          now: now(),
        });
      },
      toModelOutput({ output }) {
        const answer = output as QuestionAnswer;
        return {
          type: "text",
          value: `User answered "${answer.prompt}": ${answer.labels.join(", ") || answer.freeText || "No answer"}`,
        };
      },
    }),
  } as const;
}

async function createPendingApprovalsFromResult(input: {
  runId: string;
  session: SessionRow;
  resultContent: Awaited<ReturnType<typeof generateText>>["content"];
  services: AgentServices;
}): Promise<PendingApprovalRequest[]> {
  const { resultContent, services, session, runId } = input;
  const { repo } = services;
  const approvals: PendingApprovalRequest[] = [];

  for (const part of resultContent) {
    if (part.type !== "tool-approval-request") {
      continue;
    }

    const toolCall = part.toolCall;

    if (toolCall.toolName !== "web_search" && toolCall.toolName !== "web_fetch") {
      continue;
    }

    const request =
      toolCall.toolName === "web_search"
        ? {
            approvalId: part.approvalId,
            toolCallId: toolCall.toolCallId,
            toolName: "web_search" as const,
            scopeType: "provider" as const,
            scopeValue: "exa",
            title: "Web search permission",
            summary: "Allow web search with Exa?",
          }
        : {
            approvalId: part.approvalId,
            toolCallId: toolCall.toolCallId,
            toolName: "web_fetch" as const,
            scopeType: "domain" as const,
            scopeValue: normalizePermissionScopeFromUrl((toolCall.input as { url: string }).url),
            title: "Open page permission",
            summary: `Allow opening ${normalizePermissionScopeFromUrl((toolCall.input as { url: string }).url)}?`,
          };

    approvals.push(request);
    await repo.createPendingToolApproval({
      id: request.approvalId,
      runId,
      toolCallId: request.toolCallId,
      chatId: session.chat_id,
      toolName: request.toolName,
      scopeType: request.scopeType,
      scopeValue: request.scopeValue,
      requestJson: JSON.stringify(request),
      now: now(),
    });
    await repo.updateToolCallStatus({
      id: request.toolCallId,
      status: "waiting_permission",
      now: now(),
      summaryText: request.summary,
    });

    const toolCallRow = await repo.getToolCall(request.toolCallId);

    if (toolCallRow?.display_message_id) {
      await updateToolDisplay({
        chatId: session.chat_id,
        messageId: toolCallRow.display_message_id,
        services,
        text: request.summary,
        inlineKeyboard: buildToolPermissionKeyboard(request),
      });
    }
  }

  return approvals;
}

async function ensureToolStatus(input: {
  toolCallId: string;
  runId: string;
  chatId: number;
  services: AgentServices;
  display: ToolDisplayText;
}): Promise<void> {
  if (!input.services.config.showToolStatusMessages) {
    return;
  }

  const existing = await input.services.repo.getToolCall(input.toolCallId);

  if (existing?.display_message_id) {
    await updateToolDisplay({
      chatId: input.chatId,
      messageId: existing.display_message_id,
      services: input.services,
      text: input.display.pending,
    });
    return;
  }

  const run = await input.services.repo.getAgentRun(input.runId);

  if (!run) {
    return;
  }

  const sent = await input.services.telegram.sendMessage(input.chatId, renderTelegramHtml(input.display.pending), {
    replyToMessageId: run.reply_to_message_id,
  });
  await input.services.repo.updateToolCallDisplayMessage(input.toolCallId, sent.message_id, now());
}

async function completeToolStatus(input: {
  toolCallId: string;
  chatId: number;
  services: AgentServices;
  text: string;
}): Promise<void> {
  if (!input.services.config.showToolStatusMessages) {
    return;
  }

  const toolCall = await input.services.repo.getToolCall(input.toolCallId);

  if (!toolCall?.display_message_id) {
    return;
  }

  await updateToolDisplay({
    chatId: input.chatId,
    messageId: toolCall.display_message_id,
    services: input.services,
    text: input.text,
    inlineKeyboard: [],
  });
}

async function updateToolDisplay(input: {
  chatId: number;
  messageId: number;
  services: AgentServices;
  text: string;
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>;
}): Promise<void> {
  try {
    await input.services.telegram.editMessageText(input.chatId, input.messageId, renderTelegramHtml(input.text), {
      inlineKeyboard: input.inlineKeyboard,
    });
  } catch (error) {
    console.warn("failed to update tool display", error);
  }
}

function normalizeQuestionState(input: {
  toolCallId: string;
  input: z.infer<typeof questionInputSchema>;
}): QuestionState {
  const options = [...input.input.options];

  if (input.input.kind === "confirm" && options.length === 0) {
    options.push({ value: "yes", label: "Yes" }, { value: "no", label: "No" });
  }

  return {
    id: input.toolCallId,
    prompt: input.input.prompt,
    kind: input.input.kind,
    options,
    allowOther: input.input.allowOther,
    minSelections: input.input.minSelections ?? 1,
    maxSelections: input.input.maxSelections ?? Math.max(1, options.length),
    submitLabel: input.input.submitLabel,
    cancelLabel: input.input.cancelLabel,
    selectedIndexes: [],
    displayMessageId: null,
  };
}

export function formatQuestionPrompt(question: QuestionState): string {
  const lines = [question.prompt];

  if (question.kind === "free_text") {
    lines.push("", "Reply with a short message.");
    return lines.join("\n");
  }

  if (question.kind === "multi_select") {
    lines.push("", "Pick one or more options, then tap Submit.");
  }

  if (question.kind === "single_select" || question.kind === "confirm") {
    lines.push("", "Pick one option.");
  }

  if (question.options.length > 0) {
    lines.push("");
    lines.push(...question.options.map((option, index) => `${index + 1}. ${option.label}`));
  }

  return lines.join("\n");
}

export function parseRunState(value: string): AgentRunState {
  return JSON.parse(value) as AgentRunState;
}

export function serializeRunState(state: AgentRunState): string {
  return JSON.stringify(state);
}

export function parsePendingQuestionState(row: PendingQuestionRow): QuestionState {
  return JSON.parse(row.question_json) as QuestionState;
}

export async function updatePendingQuestionState(input: {
  row: PendingQuestionRow;
  state: QuestionState;
  services: AgentServices;
}): Promise<void> {
  await input.services.repo.createPendingQuestion({
    id: input.row.id,
    runId: input.row.run_id,
    toolCallId: input.row.tool_call_id,
    chatId: input.row.chat_id,
    questionKind: input.state.kind,
    questionJson: JSON.stringify(input.state),
    now: now(),
  });
}

export async function renderUpdatedQuestion(input: {
  row: PendingQuestionRow;
  state: QuestionState;
  services: AgentServices;
}): Promise<void> {
  if (!input.state.displayMessageId) {
    return;
  }

  await updateToolDisplay({
    chatId: input.row.chat_id,
    messageId: input.state.displayMessageId,
    services: input.services,
    text: formatQuestionPrompt(input.state),
    inlineKeyboard: buildQuestionKeyboard(input.state),
  });
}

export function buildQuestionAnswerFromSelection(input: {
  question: QuestionState;
  selectedIndexes: number[];
  freeText?: string;
}): QuestionAnswer {
  const options = input.selectedIndexes
    .map((index) => input.question.options[index])
    .filter((option): option is QuestionOption => Boolean(option));

  return {
    prompt: input.question.prompt,
    kind: input.question.kind,
    values: options.map((option) => option.value),
    labels: options.map((option) => option.label),
    freeText: input.freeText,
    confirmed:
      input.question.kind === "confirm" ? (options[0]?.value ?? "").toLowerCase() !== "no" : undefined,
  };
}

function formatWebSearchForModel(output: WebSearchResult): string {
  const lines = [`Web search for "${output.query}":`];

  for (const [index, item] of output.results.entries()) {
    lines.push(`${index + 1}. ${item.title} (${item.domain})`);
    lines.push(`URL: ${item.url}`);
    if (item.snippet) {
      lines.push(`Snippet: ${item.snippet}`);
    }
  }

  return lines.join("\n");
}

function formatWebFetchForModel(output: WebFetchResult): string {
  return [
    `Fetched ${output.finalUrl}`,
    output.title ? `Title: ${output.title}` : null,
    output.description ? `Description: ${output.description}` : null,
    `Content type: ${output.contentType}`,
    `Excerpt: ${output.excerpt}`,
    output.truncated ? "Note: content was truncated." : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n");
}

function now(): string {
  return new Date().toISOString();
}

export function summarizeQuestionAnswer(answer: QuestionAnswer): string {
  if (answer.freeText) {
    return answer.freeText;
  }

  return answer.labels.join(", ");
}

export function getApprovalRequestLabel(request: PendingApprovalRequest): string {
  return request.scopeValue;
}

export function ensureSafeUrl(value: string): void {
  assertSafeFetchUrl(value);
}
