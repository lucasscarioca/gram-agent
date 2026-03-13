import { Hono } from "hono";

import { getConfig } from "./config";
import { Repo } from "./db/repo";
import {
  createFirstMessageSessionTitle,
  createSessionTitle,
  getCommandArgument,
  normalizeManualSessionTitle,
  parseCallbackAction,
  parseCommand,
} from "./domain/protocol";
import { estimateCostUsd, getModelSpec, getModelSpecs } from "./llm/catalog";
import { LlmRegistry } from "./llm/registry";
import { getCachedInputTokens } from "./llm/provider";
import { TelegramClient, type TelegramCommand } from "./telegram/client";
import { renderTelegramHtml } from "./telegram/format";
import {
  buildModelKeyboard,
  buildSessionDeleteKeyboard,
  buildSessionKeyboard,
  buildSessionManageKeyboard,
} from "./telegram/render";
import type {
  EnvBindings,
  GroupedUsageRow,
  SessionRow,
  TelegramMessage,
  TelegramUpdate,
  UsageTotalsRow,
} from "./types";

const MAX_USER_MESSAGE_LENGTH = 4000;
const SYSTEM_PROMPT =
  "You are gram, a concise personal Telegram-first assistant. Be helpful, direct, and conversational. Format replies for Telegram with short paragraphs, flat lists, inline code, and fenced code blocks. Avoid tables.";
const TELEGRAM_COMMANDS: TelegramCommand[] = [
  { command: "help", description: "Show bot commands" },
  { command: "new", description: "Start a new session" },
  { command: "list", description: "List recent sessions" },
  { command: "model", description: "Change active model" },
  { command: "rename", description: "Rename the active session" },
  { command: "delete", description: "Delete the active session" },
  { command: "cancel", description: "Cancel pending session action" },
  { command: "status", description: "Show usage snapshot" },
  { command: "analytics", description: "Show usage totals" },
];

let telegramUiSetup: Promise<void> | null = null;

const app = new Hono<{ Bindings: EnvBindings }>();

app.get("/healthz", (c) => c.json({ ok: true }));

app.post("/webhooks/telegram/:secret", async (c) => {
  const env = c.env;
  const config = getConfig(env);
  const secret = c.req.param("secret");
  const headerSecret = c.req.header("x-telegram-bot-api-secret-token");

  if (secret !== config.telegramWebhookSecret) {
    return c.text("not found", 404);
  }

  if (headerSecret !== config.telegramWebhookSecret) {
    return c.text("forbidden", 403);
  }

  const update = (await c.req.json()) as TelegramUpdate;
  const repo = new Repo(env.DB);
  const telegram = new TelegramClient(config.telegramBotToken);
  const llm = LlmRegistry.fromConfig({
    googleApiKey: config.googleApiKey,
    openAiApiKey: config.openAiApiKey,
    anthropicApiKey: config.anthropicApiKey,
    openRouterApiKey: config.openRouterApiKey,
  });

  try {
    await ensureTelegramUi(telegram);
    await handleUpdate({ update, config, repo, telegram, llm });
    return c.json({ ok: true });
  } catch (error) {
    console.error("update handling failed", error);
    return c.json({ ok: true });
  }
});

async function handleUpdate(input: {
  update: TelegramUpdate;
  config: ReturnType<typeof getConfig>;
  repo: Repo;
  telegram: TelegramClient;
  llm: LlmRegistry;
}): Promise<void> {
  const { update, config, repo, telegram, llm } = input;

  if (update.message) {
    await handleMessage({ message: update.message, updateId: update.update_id, config, repo, telegram, llm });
    return;
  }

  if (update.callback_query) {
    await handleCallback({ callback: update.callback_query, config, repo, telegram });
  }
}

async function handleMessage(input: {
  message: TelegramMessage;
  updateId: number;
  config: ReturnType<typeof getConfig>;
  repo: Repo;
  telegram: TelegramClient;
  llm: LlmRegistry;
}): Promise<void> {
  const { message, updateId, config, repo, telegram, llm } = input;
  const userId = message.from?.id;

  if (!userId) {
    return;
  }

  if (message.chat.type !== "private") {
    return;
  }

  if (userId !== config.allowedTelegramUserId) {
    return;
  }

  if (config.allowedChatId !== undefined && message.chat.id !== config.allowedChatId) {
    return;
  }

  const command = message.text ? parseCommand(message.text) : null;

  if (command) {
    await repo.ensureChat(message.chat.id, userId, now());
    await handleCommand({
      command,
      commandText: message.text ?? "",
      chatId: message.chat.id,
      userId,
      replyToMessageId: message.message_id,
      config,
      repo,
      telegram,
    });
    return;
  }

  if (!message.text) {
    await telegram.sendMessage(message.chat.id, "Text only for now.", {
      replyToMessageId: message.message_id,
    });
    return;
  }

  if (message.text.length > MAX_USER_MESSAGE_LENGTH) {
    await telegram.sendMessage(
      message.chat.id,
      `Message too long. Keep it under ${MAX_USER_MESSAGE_LENGTH} characters.`,
      {
        replyToMessageId: message.message_id,
      },
    );
    return;
  }

  await repo.ensureChat(message.chat.id, userId, now());
  const pendingAction = await repo.getPendingChatAction(message.chat.id);

  if (pendingAction?.action === "rename_session") {
    const pendingSession = await repo.getSession(pendingAction.session_id);

    if (!pendingSession || pendingSession.chat_id !== message.chat.id) {
      await repo.clearPendingChatAction(message.chat.id);
      await telegram.sendMessage(message.chat.id, "Session rename target no longer exists.", {
        replyToMessageId: message.message_id,
      });
      return;
    }

    const title = normalizeManualSessionTitle(message.text);

    await repo.updateSessionTitle({
      sessionId: pendingSession.id,
      title,
      titleSource: "manual",
      titleUpdatedAt: now(),
      lastAutoTitleMessageCount: pendingSession.last_auto_title_message_count,
    });
    await repo.clearPendingChatAction(message.chat.id);
    await telegram.sendMessage(message.chat.id, renderTelegramHtml(`Session renamed: ${title}`), {
      replyToMessageId: message.message_id,
    });
    return;
  }

  const session = await getOrCreateActiveSession({
    repo,
    chatId: message.chat.id,
    userId,
    defaultModel: config.defaultModel,
  });
  const modelSpec = getModelSpec(session.selected_model);

  if (!modelSpec) {
    await telegram.sendMessage(message.chat.id, "Active model is invalid. Use /model to pick another one.", {
      replyToMessageId: message.message_id,
    });
    return;
  }

  const messageCount = await repo.countMessages(session.id);
  const userMessageNow = now();

  await repo.appendMessage({
    id: crypto.randomUUID(),
    sessionId: session.id,
    chatId: message.chat.id,
    telegramMessageId: message.message_id,
    role: "user",
    contentText: message.text,
    now: userMessageNow,
  });

  if (messageCount === 0) {
    await repo.updateSessionTitle({
      sessionId: session.id,
      title: createFirstMessageSessionTitle(session.created_at, message.text),
      titleSource: "first_message",
      titleUpdatedAt: userMessageNow,
      lastAutoTitleMessageCount: session.last_auto_title_message_count,
    });
  }

  const run = await repo.createRun({
    id: crypto.randomUUID(),
    sessionId: session.id,
    updateId,
    provider: modelSpec.provider,
    model: modelSpec.modelId,
    now: now(),
  });

  await telegram.sendChatAction(message.chat.id, "typing");

  try {
    const history = await repo.getRecentMessages(session.id, 20);
    const response = await llm.respond({
      system: SYSTEM_PROMPT,
      history: history
        .filter((item) => item.role !== "system")
        .slice(0, -1)
        .map((item) => ({
          role: item.role as "user" | "assistant",
          content: item.content_text,
        })),
      message: message.text,
      model: modelSpec.id,
    });
    const cachedInputTokens = getCachedInputTokens(response.usage);

    const sent = await telegram.sendMessage(message.chat.id, renderTelegramHtml(response.text), {
      replyToMessageId: message.message_id,
    });

    await repo.appendMessage({
      id: crypto.randomUUID(),
      sessionId: session.id,
      chatId: message.chat.id,
      telegramMessageId: sent.message_id,
      role: "assistant",
      contentText: response.text,
      now: now(),
    });

    await repo.completeRun({
      id: run.id,
      inputTokens: response.usage?.inputTokens,
      cachedInputTokens,
      outputTokens: response.usage?.outputTokens,
      estimatedCostUsd: estimateCostUsd({
        modelId: modelSpec.id,
        inputTokens: response.usage?.inputTokens,
        cachedInputTokens,
        outputTokens: response.usage?.outputTokens,
      }),
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown model error";

    await repo.failRun(run.id, messageText);
    await telegram.sendMessage(message.chat.id, "Model request failed. Try again.", {
      replyToMessageId: message.message_id,
    });
  }
}

async function handleCommand(input: {
  command: ReturnType<typeof parseCommand>;
  commandText: string;
  chatId: number;
  userId: number;
  replyToMessageId: number;
  config: ReturnType<typeof getConfig>;
  repo: Repo;
  telegram: TelegramClient;
}): Promise<void> {
  const { command, commandText, chatId, userId, replyToMessageId, config, repo, telegram } = input;

  if (!command) {
    return;
  }

  if (command === "help") {
    await telegram.sendMessage(
      chatId,
      [
        "Commands:",
        "/new start a new session",
        "/list list recent sessions",
        "/model change the active model",
        "/rename <title> rename the active session",
        "/delete delete the active session",
        "/cancel cancel rename flow",
        "/status show current usage snapshot",
        "/analytics show usage totals",
      ].join("\n"),
      {
        replyToMessageId,
      },
    );
    return;
  }

  if (command === "new") {
    const session = await repo.createSession({
      id: crypto.randomUUID(),
      chatId,
      userId,
      title: createSessionTitle(new Date()),
      titleSource: "default",
      selectedModel: config.defaultModel,
      now: now(),
    });

    await telegram.sendMessage(chatId, `Started a new session.\nModel: ${session.selected_model}`, {
      replyToMessageId,
    });
    return;
  }

  if (command === "list") {
    const chat = await repo.getChat(chatId);
    const sessions = await repo.listRecentSessions(chatId);

    if (sessions.length === 0) {
      await telegram.sendMessage(chatId, "No sessions yet. Use /new or send a message.", {
        replyToMessageId,
      });
      return;
    }

    await telegram.sendMessage(chatId, "Recent sessions:", {
      replyToMessageId,
      inlineKeyboard: buildSessionKeyboard(sessions, chat?.active_session_id ?? null),
    });
    return;
  }

  if (command === "rename") {
    const session = await getOrCreateActiveSession({
      repo,
      chatId,
      userId,
      defaultModel: config.defaultModel,
    });
    const titleArg = getCommandArgument(commandText);

    if (!titleArg) {
      await repo.setPendingChatAction({
        chatId,
        action: "rename_session",
        sessionId: session.id,
        now: now(),
      });
      await telegram.sendMessage(chatId, "Send the new session name. /cancel to abort.", {
        replyToMessageId,
      });
      return;
    }

    const title = normalizeManualSessionTitle(titleArg);
    await repo.updateSessionTitle({
      sessionId: session.id,
      title,
      titleSource: "manual",
      titleUpdatedAt: now(),
      lastAutoTitleMessageCount: session.last_auto_title_message_count,
    });
    await repo.clearPendingChatAction(chatId);
    await telegram.sendMessage(chatId, renderTelegramHtml(`Session renamed: ${title}`), {
      replyToMessageId,
    });
    return;
  }

  if (command === "delete") {
    const session = await repo.getActiveSession(chatId);

    if (!session) {
      await telegram.sendMessage(chatId, "No active session to delete.", {
        replyToMessageId,
      });
      return;
    }

    await telegram.sendMessage(chatId, renderTelegramHtml(buildDeletePrompt(session.title)), {
      replyToMessageId,
      inlineKeyboard: buildSessionDeleteKeyboard(session.id),
    });
    return;
  }

  if (command === "cancel") {
    const pendingAction = await repo.getPendingChatAction(chatId);

    if (!pendingAction) {
      await telegram.sendMessage(chatId, "Nothing to cancel.", {
        replyToMessageId,
      });
      return;
    }

    await repo.clearPendingChatAction(chatId);
    await telegram.sendMessage(chatId, "Canceled pending session action.", {
      replyToMessageId,
    });
    return;
  }

  if (command === "model") {
    const session = await getOrCreateActiveSession({
      repo,
      chatId,
      userId,
      defaultModel: config.defaultModel,
    });

    await telegram.sendMessage(chatId, "Select a model for the active session:", {
      replyToMessageId,
      inlineKeyboard: buildModelKeyboard(getModelSpecs(config.allowedModels), session.selected_model),
    });
    return;
  }

  if (command === "status") {
    const activeSession = await repo.getActiveSession(chatId);
    const globalTotals = await repo.getGlobalUsageTotals();

    await telegram.sendMessage(
      chatId,
      renderTelegramHtml(
        formatStatusMessage({
          activeSession,
          sessionTotals: activeSession ? await repo.getSessionUsageTotals(activeSession.id) : emptyTotals(),
          globalTotals,
        }),
      ),
      {
        replyToMessageId,
      },
    );
    return;
  }

  const analytics = await buildAnalyticsMessage(repo);
  await telegram.sendMessage(chatId, analytics, {
    replyToMessageId,
  });
}

async function handleCallback(input: {
  callback: NonNullable<TelegramUpdate["callback_query"]>;
  config: ReturnType<typeof getConfig>;
  repo: Repo;
  telegram: TelegramClient;
}): Promise<void> {
  const { callback, config, repo, telegram } = input;
  const message = callback.message;

  if (!message) {
    return;
  }

  if (message.chat.type !== "private") {
    return;
  }

  if (callback.from.id !== config.allowedTelegramUserId) {
    return;
  }

  if (config.allowedChatId !== undefined && message.chat.id !== config.allowedChatId) {
    return;
  }

  const action = parseCallbackAction(callback.data);

  if (!action) {
    await telegram.answerCallbackQuery(callback.id, "Unsupported action");
    return;
  }

  await repo.ensureChat(message.chat.id, callback.from.id, now());

  if (action.kind === "command") {
    await telegram.answerCallbackQuery(callback.id);
    await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
    await handleCommand({
      command: action.command,
      commandText: `/${action.command}`,
      chatId: message.chat.id,
      userId: callback.from.id,
      replyToMessageId: message.message_id,
      config,
      repo,
      telegram,
    });
    return;
  }

  if (action.kind === "session_manage") {
    const session = await repo.getSession(action.sessionId);

    if (!session || session.chat_id !== message.chat.id) {
      await telegram.answerCallbackQuery(callback.id, "Session not found");
      return;
    }

    const chat = await repo.getChat(message.chat.id);
    await telegram.answerCallbackQuery(callback.id);
    await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
    await telegram.sendMessage(message.chat.id, renderTelegramHtml(formatSessionManageMessage(session)), {
      replyToMessageId: message.message_id,
      inlineKeyboard: buildSessionManageKeyboard(session.id, chat?.active_session_id === session.id),
    });
    return;
  }

  if (action.kind === "session_use") {
    const session = await repo.getSession(action.sessionId);

    if (!session || session.chat_id !== message.chat.id) {
      await telegram.answerCallbackQuery(callback.id, "Session not found");
      return;
    }

    await repo.setActiveSession(message.chat.id, session.id, now());
    await telegram.answerCallbackQuery(callback.id, "Session switched");
    await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
    await telegram.sendMessage(
      message.chat.id,
      renderTelegramHtml(`Active session: ${session.title}\nModel: ${session.selected_model}`),
      {
        replyToMessageId: message.message_id,
      },
    );
    return;
  }

  if (action.kind === "session_rename") {
    const session = await repo.getSession(action.sessionId);

    if (!session || session.chat_id !== message.chat.id) {
      await telegram.answerCallbackQuery(callback.id, "Session not found");
      return;
    }

    await repo.setPendingChatAction({
      chatId: message.chat.id,
      action: "rename_session",
      sessionId: session.id,
      now: now(),
    });
    await telegram.answerCallbackQuery(callback.id, "Rename pending");
    await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
    await telegram.sendMessage(message.chat.id, "Send the new session name. /cancel to abort.", {
      replyToMessageId: message.message_id,
    });
    return;
  }

  if (action.kind === "session_delete") {
    const session = await repo.getSession(action.sessionId);

    if (!session || session.chat_id !== message.chat.id) {
      await telegram.answerCallbackQuery(callback.id, "Session not found");
      return;
    }

    await telegram.answerCallbackQuery(callback.id);
    await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
    await telegram.sendMessage(message.chat.id, renderTelegramHtml(buildDeletePrompt(session.title)), {
      replyToMessageId: message.message_id,
      inlineKeyboard: buildSessionDeleteKeyboard(session.id),
    });
    return;
  }

  if (action.kind === "session_delete_cancel") {
    await telegram.answerCallbackQuery(callback.id, "Delete canceled");
    await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
    return;
  }

  if (action.kind === "session_delete_confirm") {
    const session = await repo.getSession(action.sessionId);

    if (!session || session.chat_id !== message.chat.id) {
      await telegram.answerCallbackQuery(callback.id, "Session not found");
      return;
    }

    await repo.deleteSession(session.id, message.chat.id);
    const replacement = await repo.getMostRecentSession(message.chat.id);

    if (replacement) {
      await repo.setActiveSession(message.chat.id, replacement.id, now());
    }

    await telegram.answerCallbackQuery(callback.id, "Session deleted");
    await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
    await telegram.sendMessage(
      message.chat.id,
      renderTelegramHtml(
        replacement
          ? `Deleted session: ${session.title}\nActive session: ${replacement.title}`
          : `Deleted session: ${session.title}\nNo active session.`,
      ),
      {
        replyToMessageId: message.message_id,
      },
    );
    return;
  }

  const selectedModel = getModelSpec(action.modelId);

  if (!selectedModel || !config.allowedModels.includes(selectedModel.id)) {
    await telegram.answerCallbackQuery(callback.id, "Model not allowed");
    return;
  }

  const active = await getOrCreateActiveSession({
    repo,
    chatId: message.chat.id,
    userId: callback.from.id,
    defaultModel: config.defaultModel,
  });

  await repo.updateSessionModel(active.id, selectedModel.id, now());
  await telegram.answerCallbackQuery(callback.id, "Model updated");
  await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
  await telegram.sendMessage(message.chat.id, `Active model: ${selectedModel.id}`, {
    replyToMessageId: message.message_id,
  });
}

async function ensureTelegramUi(telegram: TelegramClient): Promise<void> {
  if (!telegramUiSetup) {
    telegramUiSetup = (async () => {
      await telegram.setMyCommands(TELEGRAM_COMMANDS);
      await telegram.setChatMenuButtonToCommands();
    })().catch((error) => {
      telegramUiSetup = null;
      throw error;
    });
  }

  await telegramUiSetup;
}

async function clearPickerKeyboard(telegram: TelegramClient, chatId: number, messageId: number): Promise<void> {
  try {
    await telegram.clearInlineKeyboard(chatId, messageId);
  } catch (error) {
    console.warn("failed to clear picker keyboard", error);
  }
}

async function getOrCreateActiveSession(input: {
  repo: Repo;
  chatId: number;
  userId: number;
  defaultModel: string;
}): Promise<SessionRow> {
  const session = await input.repo.getActiveSession(input.chatId);

  if (session) {
    return session;
  }

  return input.repo.createSession({
    id: crypto.randomUUID(),
    chatId: input.chatId,
    userId: input.userId,
    title: createSessionTitle(new Date()),
    titleSource: "default",
    selectedModel: input.defaultModel,
    now: now(),
  });
}

function formatSessionManageMessage(session: SessionRow): string {
  return [
    `Session: ${session.title}`,
    `Created: ${formatSessionCreatedAt(session.created_at)}`,
    `Model: ${session.selected_model}`,
  ].join("\n");
}

function buildDeletePrompt(title: string): string {
  return `Delete session "${title}"?\nThis removes its messages and runs.`;
}

async function buildAnalyticsMessage(repo: Repo): Promise<string> {
  const allTime = await repo.getGlobalUsageTotals();

  if (allTime.run_count === 0) {
    return "No completed runs yet.";
  }

  const todaySince = startOfUtcDay();
  const weekSince = subtractDays(7);
  const monthSince = subtractDays(30);
  const [today, sevenDays, thirtyDays, topProviders30d, topProvidersAll, topModels30d, topModelsAll] =
    await Promise.all([
      repo.getUsageTotalsSince(todaySince),
      repo.getUsageTotalsSince(weekSince),
      repo.getUsageTotalsSince(monthSince),
      repo.getTopProviders({ since: monthSince }),
      repo.getTopProviders({}),
      repo.getTopModels({ since: monthSince }),
      repo.getTopModels({}),
    ]);

  return [
    "Analytics",
    formatRange("Today (UTC)", today),
    formatRange("7d", sevenDays),
    formatRange("30d", thirtyDays),
    formatRange("All time", allTime),
    formatGroupedUsage("Top providers (30d)", topProviders30d),
    formatGroupedUsage("Top providers (all time)", topProvidersAll),
    formatGroupedUsage("Top models (30d)", topModels30d),
    formatGroupedUsage("Top models (all time)", topModelsAll),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatStatusMessage(input: {
  activeSession: SessionRow | null;
  sessionTotals: UsageTotalsRow;
  globalTotals: UsageTotalsRow;
}): string {
  const sessionHeader = input.activeSession
    ? [`Active session: ${input.activeSession.title}`, `Active model: ${input.activeSession.selected_model}`].join(
        "\n",
      )
    : "Active session: none";

  return [
    "Status",
    sessionHeader,
    formatRange("Current session", input.sessionTotals),
    formatRange("All time", input.globalTotals),
  ].join("\n\n");
}

function formatRange(label: string, totals: UsageTotalsRow): string {
  return [
    label,
    `Runs: ${formatNumber(totals.run_count)}`,
    `Input: ${formatNumber(totals.input_tokens)}`,
    `Cached input: ${formatNumber(totals.cached_input_tokens)}`,
    `Output: ${formatNumber(totals.output_tokens)}`,
    `Est. cost: ${formatUsd(totals.estimated_cost_usd)}`,
  ].join("\n");
}

function formatGroupedUsage(label: string, rows: GroupedUsageRow[]): string {
  if (rows.length === 0) {
    return "";
  }

  return [
    label,
    ...rows.map(
      (row) =>
        `${row.key} | runs ${formatNumber(row.run_count)} | in ${formatNumber(row.input_tokens)} | cached ${formatNumber(row.cached_input_tokens)} | out ${formatNumber(row.output_tokens)} | ${formatUsd(row.estimated_cost_usd)}`,
    ),
  ].join("\n");
}

function formatUsd(value: number): string {
  const rounded = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `$${rounded || "0"}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function emptyTotals(): UsageTotalsRow {
  return {
    run_count: 0,
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: 0,
  };
}

function startOfUtcDay(reference = new Date()): string {
  const start = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate(), 0, 0, 0, 0),
  );
  return start.toISOString();
}

function subtractDays(days: number, reference = new Date()): string {
  return new Date(reference.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function formatSessionCreatedAt(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function now(): string {
  return new Date().toISOString();
}

export default app;
