import { Hono } from "hono";

import { getDashboardChatId, isAdminConfigured, registerAdminRoutes, type AdminAppEnv } from "./admin/routes";
import { buildSessionContext, compactSession, shouldSendContextWarning } from "./agent/context";
import { buildPersistentMemoryMessage } from "./agent/memory";
import {
  buildInitialRunState,
  buildQuestionAnswerFromSelection,
  executeAgentRun,
  formatQuestionPrompt,
  parsePendingQuestionState,
  renderUpdatedQuestion,
  resumeAgentRunFromApproval,
  resumeAgentRunFromQuestionAnswer,
  summarizeQuestionAnswer,
  updatePendingQuestionState,
} from "./agent/runtime";
import { getConfig } from "./config";
import { Repo } from "./db/repo";
import {
  createFirstMessageSessionTitle,
  createSessionTitle,
  getCommandArgument,
  normalizeManualSessionTitle,
  parseCallbackAction,
  parseCommand
} from "./domain/protocol";
import {
  estimateCostUsd,
  getModelSpec,
  getModelSpecs,
  getTranscriptionModelSpec,
  getTranscriptionModelSpecs,
  getVisionCapableModels,
} from "./llm/catalog";
import { LlmRegistry } from "./llm/registry";
import { prepareTelegramUserInput } from "./multimodal";
import { TelegramClient, type TelegramCommand } from "./telegram/client";
import { renderTelegramHtml } from "./telegram/format";
import {
  buildSettingsKeyboard,
  buildModelKeyboard,
  buildTranscriptionModelKeyboard,
  buildVisionModelKeyboard,
  buildQuestionKeyboard,
  buildSessionDeleteKeyboard,
  buildMemoryKeyboard,
  buildSessionKeyboard,
  buildSessionManageKeyboard,
} from "./telegram/render";
import type {
  EnvBindings,
  GroupedUsageRow,
  MemoryRow,
  SessionRow,
  TelegramMessage,
  TelegramUpdate,
  UsageTotalsRow,
} from "./types";

const MAX_USER_MESSAGE_LENGTH = 4000;
const SYSTEM_PROMPT =
  "You are gram, a concise personal Telegram-first assistant. Be helpful, direct, and conversational. Format replies for Telegram with short paragraphs, flat lists, inline code, and fenced code blocks. Avoid tables.";
const BASE_TELEGRAM_COMMANDS: TelegramCommand[] = [
  { command: "help", description: "Show bot commands" },
  { command: "new", description: "Start a new session" },
  { command: "list", description: "List recent sessions" },
  { command: "model", description: "Change active model" },
  { command: "rename", description: "Rename the active session" },
  { command: "delete", description: "Delete the active session" },
  { command: "cancel", description: "Cancel pending session action" },
  { command: "status", description: "Show usage snapshot" },
  { command: "analytics", description: "Show usage totals" },
  { command: "compact", description: "Compact current session memory" },
  { command: "remember", description: "Save persistent memory" },
  { command: "memories", description: "List persistent memories" },
  { command: "forget", description: "Forget saved memory" },
  { command: "settings", description: "Configure multimodal defaults" },
];

let telegramUiSetup: Promise<void> | null = null;
let telegramUiSetupKey: string | null = null;

const app = new Hono<AdminAppEnv>();

registerAdminRoutes(app);

app.get("/", (c) => {
  return c.html(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>gram agent</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top, rgba(143,214,106,0.08), transparent 24%),
          linear-gradient(180deg, #101513, #0b0e0d 100%);
        color: #eef5f0;
      }
      main {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .card {
        width: min(420px, 100%);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 28px;
        padding: 28px;
        background: linear-gradient(180deg, rgba(24,31,28,0.96), rgba(15,20,18,0.98));
        box-shadow: 0 24px 70px rgba(0,0,0,0.24);
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid rgba(143,214,106,0.2);
        background: rgba(143,214,106,0.08);
        color: #8fd66a;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.16em;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #8fd66a;
        box-shadow: 0 0 20px rgba(143,214,106,0.4);
      }
      h1 {
        margin: 18px 0 0;
        font-family: "DIN Condensed", "Arial Narrow", sans-serif;
        font-size: clamp(34px, 6vw, 48px);
        line-height: 0.96;
        letter-spacing: -0.04em;
      }
      p {
        margin: 14px 0 0;
        line-height: 1.6;
        color: #97a79e;
        font-size: 15px;
      }
      a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        margin-top: 22px;
        padding: 0 16px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.1);
        background: rgba(255,255,255,0.03);
        color: #eef5f0;
        text-decoration: none;
        font-weight: 600;
      }
      a:hover { border-color: rgba(255,255,255,0.2); }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <div class="status"><span class="dot"></span>Worker live</div>
        <h1>Gram Agent working...</h1>
        <p>This worker is up. The public starter repo lives on GitHub.</p>
        <a href="https://github.com/lucasscarioca/gram-agent" target="_blank" rel="noreferrer">View gram-agent on GitHub</a>
      </section>
    </main>
  </body>
</html>`);
});
app.get("/healthz", (c) => c.json({ ok: true }));

app.post("/webhooks/telegram/:secret", async (c) => {
  const env = c.env;
  try {
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

    await ensureTelegramUi(telegram, config);
    await handleUpdate({ update, config, repo, telegram, llm });
    return c.json({ ok: true });
  } catch (error) {
    console.error("update handling failed", error);
    return c.json({ ok: false }, 500);
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
    await handleCallback({ callback: update.callback_query, config, repo, telegram, llm });
  }
}

export async function handleMessage(input: {
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
      llm,
    });
    return;
  }

  if (message.text && message.text.length > MAX_USER_MESSAGE_LENGTH) {
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

    if (!message.text) {
      await telegram.sendMessage(message.chat.id, "Send the new session name as text.", {
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

  const pendingQuestion = await repo.getPendingQuestionForChat(message.chat.id);

  if (pendingQuestion?.question_kind === "free_text") {
    if (!message.text) {
      await telegram.sendMessage(message.chat.id, "Reply with text for this question.", {
        replyToMessageId: message.message_id,
      });
      return;
    }

    const question = parsePendingQuestionState(pendingQuestion);
    const answer = buildQuestionAnswerFromSelection({
      question,
      selectedIndexes: [],
      freeText: message.text.trim(),
    });

    if (question.displayMessageId) {
      await telegram.editMessageText(
        message.chat.id,
        question.displayMessageId,
        renderTelegramHtml(`${formatQuestionPrompt(question)}\n\nGot your answer: ${message.text.trim()}`),
      );
    }

    await telegram.sendMessage(message.chat.id, "Got your answer.", {
      replyToMessageId: message.message_id,
    });

    const activeRun = await repo.getAgentRun(pendingQuestion.run_id);
    const activeSession = activeRun ? await repo.getSession(activeRun.session_id) : null;

    if (activeSession) {
      await resumeAgentRunFromQuestionAnswer({
        pendingQuestion,
        answer,
        services: { config, repo, telegram, llm, systemPrompt: SYSTEM_PROMPT },
      });
    } else {
      await repo.deletePendingQuestion(pendingQuestion.id);
      await repo.updateToolCallStatus({
        id: pendingQuestion.tool_call_id,
        status: "completed",
        now: now(),
        summaryText: "User answered after the pending run was no longer available.",
      });
    }

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
  const chat = await repo.getChat(message.chat.id);

  if (!chat) {
    await telegram.sendMessage(message.chat.id, "Chat settings are not ready yet. Try again.", {
      replyToMessageId: message.message_id,
    });
    return;
  }

  const preparedInput = await prepareTelegramUserInput({
    message,
    session,
    chat,
    telegram,
    llm,
  });

  if ("errorMessage" in preparedInput) {
    await telegram.sendMessage(message.chat.id, preparedInput.errorMessage, {
      replyToMessageId: message.message_id,
    });
    return;
  }

  await repo.appendMessage({
    id: crypto.randomUUID(),
    sessionId: session.id,
    chatId: message.chat.id,
    telegramMessageId: message.message_id,
    role: "user",
    contentText: preparedInput.contentText,
    contentJson: preparedInput.contentJson,
    now: userMessageNow,
  });

  if (messageCount === 0) {
    await repo.updateSessionTitle({
      sessionId: session.id,
      title: createFirstMessageSessionTitle(session.created_at, preparedInput.contentText),
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
  const preparedSession = (await prepareSessionForRun({
    session,
    replyToMessageId: message.message_id,
    config,
    repo,
    telegram,
    llm,
  })) ?? session;
  const history = await buildSessionContext({
    session: preparedSession,
    repo,
    config,
    systemPrompt: SYSTEM_PROMPT,
  });
  const persistentMemoryMessage = buildPersistentMemoryMessage({
    memories: await repo.listActiveMemoriesForChat(message.chat.id),
  });
  await repo.createAgentRun({
    runId: run.id,
    sessionId: preparedSession.id,
    chatId: message.chat.id,
    replyToMessageId: message.message_id,
    provider: modelSpec.provider,
    model: modelSpec.id,
    messagesJson: JSON.stringify(
      buildInitialRunState(persistentMemoryMessage ? [persistentMemoryMessage, ...history.messages] : history.messages),
    ),
    now: now(),
  });

  await executeAgentRun({
    runId: run.id,
    session: preparedSession,
    services: { config, repo, telegram, llm, systemPrompt: SYSTEM_PROMPT },
  });
}

export async function handleCommand(input: {
  command: ReturnType<typeof parseCommand>;
  commandText: string;
  chatId: number;
  userId: number;
  replyToMessageId: number;
  config: ReturnType<typeof getConfig>;
  repo: Repo;
  telegram: TelegramClient;
  llm: LlmRegistry;
}): Promise<void> {
  const { command, commandText, chatId, userId, replyToMessageId, config, repo, telegram, llm } = input;

  if (!command) {
    return;
  }

  if (command === "help") {
    await telegram.sendMessage(chatId, renderTelegramHtml(buildHelpMessage(config)), {
      replyToMessageId,
    });
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

  if (command === "settings") {
    const chat = await repo.getChat(chatId);
    await telegram.sendMessage(chatId, renderTelegramHtml(formatSettingsMessage(chat)), {
      replyToMessageId,
      inlineKeyboard: buildSettingsKeyboard(),
    });
    return;
  }

  if (command === "status") {
    const activeSession = await repo.getActiveSession(chatId);
    const globalTotals = await repo.getGlobalUsageTotals();
    const activeContext = activeSession
      ? await buildSessionContext({
          session: activeSession,
          repo,
          config,
          systemPrompt: SYSTEM_PROMPT,
        })
      : null;

    await telegram.sendMessage(
      chatId,
      renderTelegramHtml(
        formatStatusMessage({
          activeSession,
          activeMemoryCount: await repo.countActiveMemoriesForChat(chatId),
          sessionTotals: activeSession ? await repo.getSessionUsageTotals(activeSession.id) : emptyTotals(),
          globalTotals,
          activeContext: activeContext?.stats ?? null,
        }),
      ),
      {
        replyToMessageId,
      },
    );
    return;
  }

  if (command === "compact") {
    const activeSession = await repo.getActiveSession(chatId);

    if (!activeSession) {
      await telegram.sendMessage(chatId, "No active session to compact.", {
        replyToMessageId,
      });
      return;
    }

    const result = await compactSession({
      session: activeSession,
      repo,
      llm,
      config,
      systemPrompt: SYSTEM_PROMPT,
    });

    await telegram.sendMessage(chatId, formatCompactionResultMessage(result), {
      replyToMessageId,
    });
    return;
  }

  if (command === "remember") {
    const note = getCommandArgument(commandText);

    if (!note) {
      await telegram.sendMessage(chatId, "Usage: /remember <note>", {
        replyToMessageId,
      });
      return;
    }

    const activeSession = await repo.getActiveSession(chatId);
    await repo.createMemory({
      id: crypto.randomUUID(),
      userId,
      chatId,
      scope: "chat",
      kind: "note",
      contentText: note,
      sourceSessionId: activeSession?.id ?? null,
      now: now(),
    });
    await telegram.sendMessage(chatId, "Saved to memory.", {
      replyToMessageId,
    });
    return;
  }

  if (command === "dashboard") {
    const message = await buildDashboardMessage({ config, repo });
    await telegram.sendMessage(chatId, renderTelegramHtml(message), {
      replyToMessageId,
    });
    return;
  }

  if (command === "memories" || command === "forget") {
    await sendMemoryList({ chatId, replyToMessageId, repo, telegram });
    return;
  }

  const analytics = await buildAnalyticsMessage(repo);
  await telegram.sendMessage(chatId, analytics, {
    replyToMessageId,
  });
}

export async function handleCallback(input: {
  callback: NonNullable<TelegramUpdate["callback_query"]>;
  config: ReturnType<typeof getConfig>;
  repo: Repo;
  telegram: TelegramClient;
  llm: LlmRegistry;
}): Promise<void> {
  const { callback, config, repo, telegram, llm } = input;
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
  const agentServices = { config, repo, telegram, llm, systemPrompt: SYSTEM_PROMPT };

  if (action.kind === "tool_permission") {
    const approval = await repo.getPendingToolApproval(action.approvalId);

    if (!approval || approval.chat_id !== message.chat.id) {
      await telegram.answerCallbackQuery(callback.id, "Permission request not found");
      return;
    }

    await telegram.answerCallbackQuery(
      callback.id,
      action.decision === "deny" ? "Blocked" : action.decision === "once" ? "Allowed once" : "Allowed",
    );
    await resumeAgentRunFromApproval({
      approval,
      decision: action.decision,
      services: agentServices,
    });
    return;
  }

  if (
    action.kind === "question_select" ||
    action.kind === "question_toggle" ||
    action.kind === "question_submit" ||
    action.kind === "question_cancel"
  ) {
    const pendingQuestion = await repo.getPendingQuestion(
      action.kind === "question_submit" || action.kind === "question_cancel" ? action.questionId : action.questionId,
    );

    if (!pendingQuestion || pendingQuestion.chat_id !== message.chat.id) {
      await telegram.answerCallbackQuery(callback.id, "Question not found");
      return;
    }

    const state = parsePendingQuestionState(pendingQuestion);

    if (action.kind === "question_cancel") {
      await telegram.answerCallbackQuery(callback.id, "Canceled");
      if (state.displayMessageId) {
        await telegram.editMessageText(
          message.chat.id,
          state.displayMessageId,
          renderTelegramHtml(`${formatQuestionPrompt(state)}\n\nCanceled.`),
        );
      }
      await resumeAgentRunFromQuestionAnswer({
        pendingQuestion,
        answer: {
          prompt: state.prompt,
          kind: state.kind,
          values: [],
          labels: ["Canceled"],
        },
        services: agentServices,
      });
      return;
    }

    if (action.kind === "question_toggle") {
      if (!isValidQuestionOptionIndex(state, action.optionIndex)) {
        await telegram.answerCallbackQuery(callback.id, "Option not found");
        return;
      }

      const selected = new Set(state.selectedIndexes);

      if (selected.has(action.optionIndex)) {
        selected.delete(action.optionIndex);
      } else if (selected.size < state.maxSelections) {
        selected.add(action.optionIndex);
      }

      state.selectedIndexes = [...selected].sort((a, b) => a - b);
      await updatePendingQuestionState({
        row: pendingQuestion,
        state,
        services: agentServices,
      });
      await renderUpdatedQuestion({
        row: pendingQuestion,
        state,
        services: agentServices,
      });
      await telegram.answerCallbackQuery(callback.id, "Updated");
      return;
    }

    const selectedIndexes =
      action.kind === "question_select"
        ? [action.optionIndex]
        : state.selectedIndexes;
    const validSelectedIndexes = selectedIndexes.filter((index) => isValidQuestionOptionIndex(state, index));

    if (action.kind === "question_select" && validSelectedIndexes.length === 0) {
      await telegram.answerCallbackQuery(callback.id, "Option not found");
      return;
    }

    if (state.kind === "multi_select" && validSelectedIndexes.length < state.minSelections) {
      await telegram.answerCallbackQuery(callback.id, `Pick at least ${state.minSelections}`);
      return;
    }

    const answer = buildQuestionAnswerFromSelection({
      question: state,
      selectedIndexes: validSelectedIndexes,
    });

    await telegram.answerCallbackQuery(callback.id, "Got it");
    if (state.displayMessageId) {
      await telegram.editMessageText(
        message.chat.id,
        state.displayMessageId,
        renderTelegramHtml(`${formatQuestionPrompt(state)}\n\nGot your answer: ${summarizeQuestionAnswer(answer)}`),
      );
    }

    await resumeAgentRunFromQuestionAnswer({
      pendingQuestion,
      answer,
      services: agentServices,
    });
    return;
  }

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
      llm,
    });
    return;
  }

  if (action.kind === "settings") {
    const chat = await repo.getChat(message.chat.id);
    await telegram.answerCallbackQuery(callback.id);
    await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
    await telegram.sendMessage(message.chat.id, renderTelegramHtml(formatSettingsMessage(chat)), {
      replyToMessageId: message.message_id,
      inlineKeyboard: buildSettingsKeyboard(),
    });
    return;
  }

  if (action.kind === "settings_vision") {
    const chat = await repo.getChat(message.chat.id);
    await telegram.answerCallbackQuery(callback.id);
    await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
    await telegram.sendMessage(message.chat.id, renderTelegramHtml(formatVisionModelPicker(chat)), {
      replyToMessageId: message.message_id,
      inlineKeyboard: buildVisionModelKeyboard(getVisionCapableModels(config.allowedModels), chat?.default_vision_model ?? null),
    });
    return;
  }

  if (action.kind === "settings_transcription") {
    const chat = await repo.getChat(message.chat.id);
    await telegram.answerCallbackQuery(callback.id);
    await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
    await telegram.sendMessage(message.chat.id, renderTelegramHtml(formatTranscriptionModelPicker(chat)), {
      replyToMessageId: message.message_id,
      inlineKeyboard: buildTranscriptionModelKeyboard(
        getTranscriptionModelSpecs(config.allowedTranscriptionModels),
        chat?.default_transcription_model ?? null,
      ),
    });
    return;
  }

  if (action.kind === "settings_vision_set") {
    const selectedModel = getModelSpec(action.modelId);

    if (!selectedModel || !selectedModel.supportsVisionInput || !config.allowedModels.includes(selectedModel.id)) {
      await telegram.answerCallbackQuery(callback.id, "Vision model not allowed");
      return;
    }

    await repo.updateChatVisionModel(message.chat.id, selectedModel.id, now());
    await telegram.answerCallbackQuery(callback.id, "Vision model updated");
    await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
    await telegram.sendMessage(message.chat.id, `Default vision model: ${selectedModel.id}`, {
      replyToMessageId: message.message_id,
    });
    return;
  }

  if (action.kind === "settings_vision_clear") {
    await repo.updateChatVisionModel(message.chat.id, null, now());
    await telegram.answerCallbackQuery(callback.id, "Vision disabled");
    await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
    await telegram.sendMessage(message.chat.id, "Default vision model cleared.", {
      replyToMessageId: message.message_id,
    });
    return;
  }

  if (action.kind === "settings_transcription_set") {
    const selectedModel = getTranscriptionModelSpec(action.modelId);

    if (!selectedModel || !config.allowedTranscriptionModels.includes(selectedModel.id)) {
      await telegram.answerCallbackQuery(callback.id, "Transcription model not allowed");
      return;
    }

    await repo.updateChatTranscriptionModel(message.chat.id, selectedModel.id, now());
    await telegram.answerCallbackQuery(callback.id, "Transcription model updated");
    await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
    await telegram.sendMessage(message.chat.id, `Default transcription model: ${selectedModel.id}`, {
      replyToMessageId: message.message_id,
    });
    return;
  }

  if (action.kind === "settings_transcription_clear") {
    await repo.updateChatTranscriptionModel(message.chat.id, null, now());
    await telegram.answerCallbackQuery(callback.id, "Transcription disabled");
    await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
    await telegram.sendMessage(message.chat.id, "Default transcription model cleared.", {
      replyToMessageId: message.message_id,
    });
    return;
  }

  if (action.kind === "memory_forget") {
    const memory = await repo.getMemory(action.memoryId);

    if (!memory || memory.chat_id !== message.chat.id || memory.status !== "active") {
      await telegram.answerCallbackQuery(callback.id, "Memory not found");
      return;
    }

    await repo.archiveMemory(memory.id, message.chat.id, now());
    await telegram.answerCallbackQuery(callback.id, "Forgot");
    await clearPickerKeyboard(telegram, message.chat.id, message.message_id);
    await telegram.sendMessage(message.chat.id, renderTelegramHtml(`Forgot: ${memory.content_text}`), {
      replyToMessageId: message.message_id,
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

  if (action.kind !== "model") {
    await telegram.answerCallbackQuery(callback.id, "Unsupported action");
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

async function ensureTelegramUi(telegram: TelegramClient, config: ReturnType<typeof getConfig>): Promise<void> {
  const commands = getTelegramCommands(config);
  const key = commands.map((item) => `${item.command}:${item.description}`).join("|");

  if (!telegramUiSetup || telegramUiSetupKey !== key) {
    telegramUiSetupKey = key;
    telegramUiSetup = (async () => {
      await telegram.setMyCommands(commands);
      await telegram.setChatMenuButtonToCommands();
    })().catch((error) => {
      telegramUiSetup = null;
      telegramUiSetupKey = null;
      throw error;
    });
  }

  await telegramUiSetup;
}

function getTelegramCommands(config: ReturnType<typeof getConfig>): TelegramCommand[] {
  return isAdminConfigured(config)
    ? [...BASE_TELEGRAM_COMMANDS, { command: "dashboard", description: "Open admin dashboard" }]
    : BASE_TELEGRAM_COMMANDS;
}

function buildHelpMessage(config: ReturnType<typeof getConfig>): string {
  return [
    "Commands:",
    "/new start a new session",
    "/list list recent sessions",
    "/model change the active model",
    "/rename <title> rename the active session",
    "/delete delete the active session",
    "/cancel cancel rename flow",
    "/status show current usage snapshot",
    "/analytics show usage totals",
    "/compact compact current session memory",
    "/remember <note> save persistent memory",
    "/memories list saved memories",
    "/forget open saved memories to remove one",
    "/settings configure vision and audio defaults",
    isAdminConfigured(config) ? "/dashboard open the admin dashboard" : null,
  ]
    .filter(Boolean)
    .join("\n");
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

function formatSettingsMessage(chat: Awaited<ReturnType<Repo["getChat"]>>): string {
  return [
    "Settings",
    `Default vision model: ${chat?.default_vision_model ?? "disabled"}`,
    `Default transcription model: ${chat?.default_transcription_model ?? "disabled"}`,
  ].join("\n");
}

function formatVisionModelPicker(chat: Awaited<ReturnType<Repo["getChat"]>>): string {
  return [
    "Select the default vision model.",
    `Current: ${chat?.default_vision_model ?? "disabled"}`,
  ].join("\n");
}

function formatTranscriptionModelPicker(chat: Awaited<ReturnType<Repo["getChat"]>>): string {
  return [
    "Select the default transcription model.",
    `Current: ${chat?.default_transcription_model ?? "disabled"}`,
  ].join("\n");
}

function buildDeletePrompt(title: string): string {
  return `Delete session "${title}"?\nThis removes its messages and runs.`;
}

async function sendMemoryList(input: {
  chatId: number;
  replyToMessageId: number;
  repo: Repo;
  telegram: TelegramClient;
}): Promise<void> {
  const memories = await input.repo.listActiveMemoriesForChat(input.chatId);

  if (memories.length === 0) {
    await input.telegram.sendMessage(input.chatId, "No saved memories yet. Use /remember <note>.", {
      replyToMessageId: input.replyToMessageId,
    });
    return;
  }

  await input.telegram.sendMessage(input.chatId, renderTelegramHtml(formatMemoryList(memories)), {
    replyToMessageId: input.replyToMessageId,
    inlineKeyboard: buildMemoryKeyboard(memories),
  });
}

export function formatMemoryList(memories: MemoryRow[]): string {
  return ["Memories", ...memories.map((memory, index) => `${index + 1}. ${memory.content_text}`)].join("\n");
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

async function buildDashboardMessage(input: {
  config: ReturnType<typeof getConfig>;
  repo: Repo;
}): Promise<string> {
  if (!input.config.adminBaseUrl) {
    return [
      "Dashboard is not configured yet.",
      "Set ADMIN_BASE_URL after your custom domain is ready.",
    ].join("\n");
  }

  const chatId = getDashboardChatId(input.config);
  const [approvals, questions] = await Promise.all([
    input.repo.countPendingToolApprovalsForChat(chatId),
    input.repo.countPendingQuestionsForChat(chatId),
  ]);

  const lines = [
    `Dashboard: ${input.config.adminBaseUrl}`,
    isAdminConfigured(input.config)
      ? "Cloudflare Access is enabled for the admin console."
      : "Admin auth is not fully configured yet. Finish custom-domain + Access setup.",
  ];

  if (approvals > 0 || questions > 0) {
    lines.push(`Pending: ${approvals} approval${approvals === 1 ? "" : "s"}, ${questions} question${questions === 1 ? "" : "s"}`);
  }

  return lines.join("\n");
}

export function formatStatusMessage(input: {
  activeSession: SessionRow | null;
  activeMemoryCount: number;
  sessionTotals: UsageTotalsRow;
  globalTotals: UsageTotalsRow;
  activeContext: Awaited<ReturnType<typeof buildSessionContext>>["stats"] | null;
}): string {
  const sessionHeader = input.activeSession
    ? [
        `Active session: ${input.activeSession.title}`,
        `Active model: ${input.activeSession.selected_model}`,
        `Context: ${formatContextSummary(input.activeContext)}`,
        `Compacted: ${formatCompactionStatus(input.activeSession)}`,
      ].join("\n")
    : "Active session: none";

  return [
    "Status",
    sessionHeader,
    `Persistent memory: ${formatNumber(input.activeMemoryCount)} saved`,
    formatRange("Current session", input.sessionTotals),
    formatRange("All time", input.globalTotals),
  ].join("\n\n");
}

async function prepareSessionForRun(input: {
  session: SessionRow;
  replyToMessageId: number;
  config: ReturnType<typeof getConfig>;
  repo: Repo;
  telegram: TelegramClient;
  llm: LlmRegistry;
}): Promise<SessionRow | null> {
  const context = await buildSessionContext({
    session: input.session,
    repo: input.repo,
    config: input.config,
    systemPrompt: SYSTEM_PROMPT,
  });
  const timestamp = now();

  if (shouldSendContextWarning(input.session, timestamp, context.decision)) {
    await input.repo.updateSessionContextWarning(input.session.id, timestamp);
    await input.telegram.sendMessage(
      input.session.chat_id,
      "Context is getting full. I may compact this session soon to keep continuity.",
      {
        replyToMessageId: input.replyToMessageId,
      },
    );
  }

  if (context.decision !== "compact") {
    return input.session;
  }

  const result = await compactSession({
    session: input.session,
    repo: input.repo,
    llm: input.llm,
    config: input.config,
    systemPrompt: SYSTEM_PROMPT,
  });

  await input.telegram.sendMessage(input.session.chat_id, formatCompactionResultMessage(result, "auto"), {
    replyToMessageId: input.replyToMessageId,
  });

  return input.repo.getSession(input.session.id);
}

function formatCompactionResultMessage(
  result: Awaited<ReturnType<typeof compactSession>>,
  mode: "manual" | "auto" = "manual",
): string {
  if (result.status === "noop") {
    return mode === "manual" ? "Nothing to compact yet." : "Context was full, but there was nothing useful to compact yet.";
  }

  return [
    mode === "manual" ? "Session compacted." : "Compacted this session to preserve continuity.",
    `Compressed ${formatNumber(result.compactedMessageCount)} message${result.compactedMessageCount === 1 ? "" : "s"}.`,
    `Context est.: ${formatNumber(result.previousTokens)} -> ${formatNumber(result.nextTokens)} tokens.`,
  ].join("\n");
}

function formatContextSummary(
  stats: Awaited<ReturnType<typeof buildSessionContext>>["stats"] | null,
): string {
  if (!stats) {
    return "n/a";
  }

  return `${formatNumber(stats.estimatedTokens)} / ${formatNumber(stats.contextWindowTokens)} est. tokens (${formatPercent(stats.usageRatio)})`;
}

function formatCompactionStatus(session: SessionRow): string {
  if (!session.compacted_at) {
    return "none";
  }

  const base = formatSessionCreatedAt(session.compacted_at);
  return session.compacted_summary ? `${base} · summary saved` : base;
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

function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
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

function isValidQuestionOptionIndex(
  question: Awaited<ReturnType<typeof parsePendingQuestionState>>,
  optionIndex: number,
): boolean {
  return Number.isInteger(optionIndex) && optionIndex >= 0 && optionIndex < question.options.length;
}

function now(): string {
  return new Date().toISOString();
}

export default app;
