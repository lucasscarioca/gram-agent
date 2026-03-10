import { Hono } from "hono";

import { getConfig } from "./config";
import { Repo } from "./db/repo";
import {
  createSessionTitle,
  deriveSessionTitle,
  parseCallbackAction,
  parseCommand,
} from "./domain/protocol";
import { GoogleLlmProvider } from "./llm/google";
import { TelegramClient } from "./telegram/client";
import { buildModelKeyboard, buildReplyControls, buildSessionKeyboard } from "./telegram/render";
import type { EnvBindings, SessionRow, TelegramMessage, TelegramUpdate } from "./types";

const MAX_USER_MESSAGE_LENGTH = 4000;
const SYSTEM_PROMPT =
  "You are gram, a concise personal Telegram-first assistant. Be helpful, direct, and conversational.";

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
  const llm = new GoogleLlmProvider(config.googleApiKey);

  try {
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
  llm: GoogleLlmProvider;
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
  llm: GoogleLlmProvider;
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
      inlineKeyboard: buildReplyControls(),
    });
    return;
  }

  if (message.text.length > MAX_USER_MESSAGE_LENGTH) {
    await telegram.sendMessage(
      message.chat.id,
      `Message too long. Keep it under ${MAX_USER_MESSAGE_LENGTH} characters.`,
      {
        replyToMessageId: message.message_id,
        inlineKeyboard: buildReplyControls(),
      },
    );
    return;
  }

  await repo.ensureChat(message.chat.id, userId, now());
  const session = await getOrCreateActiveSession({
    repo,
    chatId: message.chat.id,
    userId,
    defaultModel: config.defaultModel,
  });

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
    await repo.updateSessionTitle(session.id, deriveSessionTitle(message.text));
  }

  const run = await repo.createRun({
    id: crypto.randomUUID(),
    sessionId: session.id,
    updateId,
    provider: "google",
    model: session.selected_model,
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
      model: session.selected_model,
    });

    const sent = await telegram.sendMessage(message.chat.id, response.text, {
      replyToMessageId: message.message_id,
      inlineKeyboard: buildReplyControls(),
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
      outputTokens: response.usage?.outputTokens,
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown model error";

    await repo.failRun(run.id, messageText);
    await telegram.sendMessage(message.chat.id, "Model request failed. Try again.", {
      replyToMessageId: message.message_id,
      inlineKeyboard: buildReplyControls(),
    });
  }
}

async function handleCommand(input: {
  command: ReturnType<typeof parseCommand>;
  chatId: number;
  userId: number;
  replyToMessageId: number;
  config: ReturnType<typeof getConfig>;
  repo: Repo;
  telegram: TelegramClient;
}): Promise<void> {
  const { command, chatId, userId, replyToMessageId, config, repo, telegram } = input;

  if (!command) {
    return;
  }

  if (command === "help") {
    await telegram.sendMessage(
      chatId,
      ["Commands:", "/new start a new session", "/list list recent sessions", "/model change the active model"].join("\n"),
      {
        replyToMessageId,
        inlineKeyboard: buildReplyControls(),
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
      selectedModel: config.defaultModel,
      now: now(),
    });

    await telegram.sendMessage(
      chatId,
      `Started a new session.\nModel: ${session.selected_model}`,
      {
        replyToMessageId,
        inlineKeyboard: buildReplyControls(),
      },
    );
    return;
  }

  if (command === "list") {
    const chat = await repo.getChat(chatId);
    const sessions = await repo.listRecentSessions(chatId);

    if (sessions.length === 0) {
      await telegram.sendMessage(chatId, "No sessions yet. Use /new or send a message.", {
        replyToMessageId,
        inlineKeyboard: buildReplyControls(),
      });
      return;
    }

    await telegram.sendMessage(chatId, "Recent sessions:", {
      replyToMessageId,
      inlineKeyboard: buildSessionKeyboard(sessions, chat?.active_session_id ?? null),
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
      inlineKeyboard: buildModelKeyboard(config.allowedModels, session.selected_model),
    });
  }
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
    await handleCommand({
      command: action.command,
      chatId: message.chat.id,
      userId: callback.from.id,
      replyToMessageId: message.message_id,
      config,
      repo,
      telegram,
    });
    return;
  }

  if (action.kind === "session") {
    const session = await repo.getSession(action.sessionId);

    if (!session || session.chat_id !== message.chat.id) {
      await telegram.answerCallbackQuery(callback.id, "Session not found");
      return;
    }

    await repo.setActiveSession(message.chat.id, session.id, now());
    await telegram.answerCallbackQuery(callback.id, "Session switched");
    await telegram.sendMessage(
      message.chat.id,
      `Active session: ${session.title}\nModel: ${session.selected_model}`,
      {
        replyToMessageId: message.message_id,
        inlineKeyboard: buildReplyControls(),
      },
    );
    return;
  }

  if (!config.allowedModels.includes(action.modelId)) {
    await telegram.answerCallbackQuery(callback.id, "Model not allowed");
    return;
  }

  const active = await getOrCreateActiveSession({
    repo,
    chatId: message.chat.id,
    userId: callback.from.id,
    defaultModel: config.defaultModel,
  });

  await repo.updateSessionModel(active.id, action.modelId, now());
  await telegram.answerCallbackQuery(callback.id, "Model updated");
  await telegram.sendMessage(message.chat.id, `Active model: ${action.modelId}`, {
    replyToMessageId: message.message_id,
    inlineKeyboard: buildReplyControls(),
  });
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
    selectedModel: input.defaultModel,
    now: now(),
  });
}

function now(): string {
  return new Date().toISOString();
}

export default app;
