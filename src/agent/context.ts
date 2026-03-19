import type { ModelMessage } from "ai";

import type { AppConfig } from "../config";
import { Repo } from "../db/repo";
import { getContextWindowTokens, type QualifiedModelId } from "../llm/catalog";
import { LlmRegistry } from "../llm/registry";
import type { MessageRow, SessionRow } from "../types";

const SESSION_MEMORY_LABEL = "Session memory";
const WARNING_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MIN_TAIL_MESSAGES = 4;
const MIN_TAIL_TOKENS = 2_000;
const MAX_TAIL_TOKENS = 32_000;

export type ContextDecision = "ok" | "warn" | "compact";

export interface SessionContextStats {
  contextWindowTokens: number;
  reserveTokens: number;
  estimatedTokens: number;
  usageRatio: number;
  summaryTokens: number;
  rawMessageTokens: number;
  includedMessageTokens: number;
  totalRawMessageCount: number;
  includedMessageCount: number;
}

export interface BuiltSessionContext {
  messages: ModelMessage[];
  stats: SessionContextStats;
  decision: ContextDecision;
}

export interface CompactionResult {
  status: "compacted" | "noop";
  previousTokens: number;
  nextTokens: number;
  compactedMessageCount: number;
  compactedAt?: string;
}

export async function buildSessionContext(input: {
  session: SessionRow;
  repo: Repo;
  config: AppConfig;
  systemPrompt: string;
}): Promise<BuiltSessionContext> {
  const allMessages = await input.repo.getSessionMessages(input.session.id);
  const rawMessages = getUncompactedMessages(allMessages, input.session.last_compacted_message_id);
  const contextWindowTokens = getContextWindowTokens(input.session.selected_model, input.config.defaultContextWindowTokens);
  const reserveTokens = input.config.contextReserveTokens;
  const budgetTokens = Math.max(1_000, contextWindowTokens - reserveTokens - estimateTextTokens(input.systemPrompt));
  const summaryMessage = buildSummaryMessage(input.session.compacted_summary);
  const summaryTokens = summaryMessage ? estimateModelMessageTokens(summaryMessage) : 0;
  const includedRawMessages = selectMessagesWithinBudget(rawMessages, Math.max(0, budgetTokens - summaryTokens));
  const estimatedTokens =
    estimateTextTokens(input.systemPrompt) +
    summaryTokens +
    rawMessages.reduce((sum, message) => sum + estimateMessageRowTokens(message), 0);
  const includedMessageTokens =
    summaryTokens + includedRawMessages.reduce((sum, message) => sum + estimateMessageRowTokens(message), 0);
  const usageRatio = estimatedTokens / contextWindowTokens;

  return {
    messages: [
      ...(summaryMessage ? [summaryMessage] : []),
      ...includedRawMessages.map(toModelMessage),
    ],
    stats: {
      contextWindowTokens,
      reserveTokens,
      estimatedTokens,
      usageRatio,
      summaryTokens,
      rawMessageTokens: rawMessages.reduce((sum, message) => sum + estimateMessageRowTokens(message), 0),
      includedMessageTokens,
      totalRawMessageCount: rawMessages.length,
      includedMessageCount: includedRawMessages.length,
    },
    decision:
      usageRatio >= input.config.contextCompactThreshold
        ? "compact"
        : usageRatio >= input.config.contextWarnThreshold
          ? "warn"
          : "ok",
  };
}

export async function compactSession(input: {
  session: SessionRow;
  repo: Repo;
  llm: LlmRegistry;
  config: AppConfig;
  systemPrompt: string;
}): Promise<CompactionResult> {
  const allMessages = await input.repo.getSessionMessages(input.session.id);
  const rawMessages = getUncompactedMessages(allMessages, input.session.last_compacted_message_id);
  const previousContext = await buildSessionContext({
    session: input.session,
    repo: input.repo,
    config: input.config,
    systemPrompt: input.systemPrompt,
  });
  const contextWindowTokens = getContextWindowTokens(input.session.selected_model, input.config.defaultContextWindowTokens);
  const targetTailTokens = Math.max(
    MIN_TAIL_TOKENS,
    Math.min(MAX_TAIL_TOKENS, Math.floor((contextWindowTokens - input.config.contextReserveTokens) * 0.22)),
  );
  const tailMessages = selectTailForCompaction(rawMessages, targetTailTokens);
  const compactCount = Math.max(0, rawMessages.length - tailMessages.length);
  const messagesToCompact = rawMessages.slice(0, compactCount);

  if (messagesToCompact.length === 0) {
    return {
      status: "noop",
      previousTokens: previousContext.stats.estimatedTokens,
      nextTokens: previousContext.stats.estimatedTokens,
      compactedMessageCount: 0,
    };
  }

  const compactedSummary = (
    await input.llm.respond({
      model: input.session.selected_model as QualifiedModelId,
      system: buildCompactionSystemPrompt(),
      history: [],
      message: buildCompactionUserPrompt({
        existingSummary: input.session.compacted_summary,
        messages: messagesToCompact,
      }),
    })
  ).text.trim();

  const compactedAt = now();
  await input.repo.updateSessionCompaction({
    sessionId: input.session.id,
    compactedSummary: compactedSummary || "No durable memory extracted.",
    compactedAt,
    lastCompactedMessageId: messagesToCompact[messagesToCompact.length - 1]?.id ?? input.session.last_compacted_message_id ?? "",
  });

  const refreshed = await input.repo.getSession(input.session.id);

  if (!refreshed) {
    return {
      status: "compacted",
      previousTokens: previousContext.stats.estimatedTokens,
      nextTokens: previousContext.stats.estimatedTokens,
      compactedMessageCount: messagesToCompact.length,
      compactedAt,
    };
  }

  const nextContext = await buildSessionContext({
    session: refreshed,
    repo: input.repo,
    config: input.config,
    systemPrompt: input.systemPrompt,
  });

  return {
    status: "compacted",
    previousTokens: previousContext.stats.estimatedTokens,
    nextTokens: nextContext.stats.estimatedTokens,
    compactedMessageCount: messagesToCompact.length,
    compactedAt,
  };
}

export function shouldSendContextWarning(session: SessionRow, warnedAt: string, decision: ContextDecision): boolean {
  if (decision !== "warn") {
    return false;
  }

  if (!session.last_context_warning_at) {
    return true;
  }

  const warnedMs = new Date(session.last_context_warning_at).getTime();
  const nowMs = new Date(warnedAt).getTime();
  const compactedMs = session.compacted_at ? new Date(session.compacted_at).getTime() : 0;

  return warnedMs < compactedMs || nowMs - warnedMs >= WARNING_COOLDOWN_MS;
}

export function estimateTextTokens(value: string): number {
  const normalized = value.trim();

  if (normalized.length === 0) {
    return 0;
  }

  return Math.ceil(normalized.length / 3.5) + 12;
}

function selectTailForCompaction(messages: MessageRow[], targetTokens: number): MessageRow[] {
  const selected: MessageRow[] = [];
  let total = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const messageTokens = estimateMessageRowTokens(message);

    if (selected.length >= MIN_TAIL_MESSAGES && total + messageTokens > targetTokens) {
      break;
    }

    selected.push(message);
    total += messageTokens;
  }

  return selected.reverse();
}

function selectMessagesWithinBudget(messages: MessageRow[], budgetTokens: number): MessageRow[] {
  const selected: MessageRow[] = [];
  let total = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const messageTokens = estimateMessageRowTokens(message);

    if (selected.length > 0 && total + messageTokens > budgetTokens) {
      break;
    }

    selected.push(message);
    total += messageTokens;
  }

  return selected.reverse();
}

function getUncompactedMessages(messages: MessageRow[], lastCompactedMessageId: string | null): MessageRow[] {
  if (!lastCompactedMessageId) {
    return messages;
  }

  const boundaryIndex = messages.findIndex((message) => message.id === lastCompactedMessageId);
  return boundaryIndex === -1 ? messages : messages.slice(boundaryIndex + 1);
}

function buildSummaryMessage(summary: string | null): ModelMessage | null {
  if (!summary?.trim()) {
    return null;
  }

  return {
    role: "system",
    content: `${SESSION_MEMORY_LABEL}:\n${summary.trim()}`,
  } as ModelMessage;
}

function toModelMessage(message: MessageRow): ModelMessage {
  return {
    role: message.role,
    content: message.content_text,
  } as ModelMessage;
}

function estimateMessageRowTokens(message: MessageRow): number {
  return estimateTextTokens(message.content_text) + 8;
}

function estimateModelMessageTokens(message: ModelMessage): number {
  const content =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
            .join("\n")
        : "";

  return estimateTextTokens(content) + 8;
}

function buildCompactionSystemPrompt(): string {
  return [
    "You compress Telegram assistant sessions into durable continuation memory.",
    "Preserve stable user preferences, constraints, important facts, decisions, unresolved threads, and promised follow-ups.",
    "Include corrections and things that are no longer true when relevant.",
    "Omit filler chat, repeated phrasing, and transient details.",
    "Write concise bullet points only.",
  ].join(" ");
}

function buildCompactionUserPrompt(input: { existingSummary: string | null; messages: MessageRow[] }): string {
  const lines = ["Refresh the session memory from the material below."];

  if (input.existingSummary?.trim()) {
    lines.push("", "Existing session memory:", input.existingSummary.trim());
  }

  lines.push("", "New transcript to absorb:");
  lines.push(
    ...input.messages.map(
      (message) => `[${message.created_at}] ${message.role.toUpperCase()}: ${message.content_text.trim() || "(empty)"}`,
    ),
  );
  lines.push("", "Return only the updated session memory.");

  return lines.join("\n");
}

function now(): string {
  return new Date().toISOString();
}
