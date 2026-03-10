import type { ChatRow, MessageRow, RunRow, SessionRow } from "../types";

export class Repo {
  constructor(private readonly db: D1Database) {}

  async ensureChat(chatId: number, userId: number, now: string): Promise<void> {
    await this.db
      .prepare(
        `
          INSERT INTO chats (chat_id, user_id, active_session_id, created_at, updated_at)
          VALUES (?, ?, NULL, ?, ?)
          ON CONFLICT(chat_id) DO UPDATE SET
            user_id = excluded.user_id,
            updated_at = excluded.updated_at
        `,
      )
      .bind(chatId, userId, now, now)
      .run();
  }

  async getChat(chatId: number): Promise<ChatRow | null> {
    const row = await this.db
      .prepare(
        `
          SELECT chat_id, user_id, active_session_id, created_at, updated_at
          FROM chats
          WHERE chat_id = ?
        `,
      )
      .bind(chatId)
      .first<ChatRow>();

    return row ?? null;
  }

  async getSession(sessionId: string): Promise<SessionRow | null> {
    const row = await this.db
      .prepare(
        `
          SELECT id, chat_id, user_id, title, selected_model, created_at, last_message_at
          FROM sessions
          WHERE id = ?
        `,
      )
      .bind(sessionId)
      .first<SessionRow>();

    return row ?? null;
  }

  async createSession(input: {
    id: string;
    chatId: number;
    userId: number;
    title: string;
    selectedModel: string;
    now: string;
  }): Promise<SessionRow> {
    await this.db
      .prepare(
        `
          INSERT INTO sessions (id, chat_id, user_id, title, selected_model, created_at, last_message_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        input.id,
        input.chatId,
        input.userId,
        input.title,
        input.selectedModel,
        input.now,
        input.now,
      )
      .run();

    await this.setActiveSession(input.chatId, input.id, input.now);

    return {
      id: input.id,
      chat_id: input.chatId,
      user_id: input.userId,
      title: input.title,
      selected_model: input.selectedModel,
      created_at: input.now,
      last_message_at: input.now,
    };
  }

  async setActiveSession(chatId: number, sessionId: string, now: string): Promise<void> {
    await this.db
      .prepare(
        `
          UPDATE chats
          SET active_session_id = ?, updated_at = ?
          WHERE chat_id = ?
        `,
      )
      .bind(sessionId, now, chatId)
      .run();
  }

  async getActiveSession(chatId: number): Promise<SessionRow | null> {
    const row = await this.db
      .prepare(
        `
          SELECT s.id, s.chat_id, s.user_id, s.title, s.selected_model, s.created_at, s.last_message_at
          FROM chats c
          JOIN sessions s ON s.id = c.active_session_id
          WHERE c.chat_id = ?
        `,
      )
      .bind(chatId)
      .first<SessionRow>();

    return row ?? null;
  }

  async listRecentSessions(chatId: number, limit = 10): Promise<SessionRow[]> {
    const result = await this.db
      .prepare(
        `
          SELECT id, chat_id, user_id, title, selected_model, created_at, last_message_at
          FROM sessions
          WHERE chat_id = ?
          ORDER BY last_message_at DESC, created_at DESC
          LIMIT ?
        `,
      )
      .bind(chatId, limit)
      .all<SessionRow>();

    return result.results ?? [];
  }

  async updateSessionModel(sessionId: string, modelId: string, now: string): Promise<void> {
    await this.db
      .prepare(
        `
          UPDATE sessions
          SET selected_model = ?, last_message_at = ?
          WHERE id = ?
        `,
      )
      .bind(modelId, now, sessionId)
      .run();
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    await this.db
      .prepare(
        `
          UPDATE sessions
          SET title = ?
          WHERE id = ?
        `,
      )
      .bind(title, sessionId)
      .run();
  }

  async countMessages(sessionId: string): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS count FROM messages WHERE session_id = ?`)
      .bind(sessionId)
      .first<{ count: number | string }>();

    return Number(row?.count ?? 0);
  }

  async appendMessage(input: {
    id: string;
    sessionId: string;
    chatId: number;
    telegramMessageId: number | null;
    role: MessageRow["role"];
    contentText: string;
    now: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `
          INSERT INTO messages (id, session_id, chat_id, telegram_message_id, role, content_text, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        input.id,
        input.sessionId,
        input.chatId,
        input.telegramMessageId,
        input.role,
        input.contentText,
        input.now,
      )
      .run();

    await this.db
      .prepare(
        `
          UPDATE sessions
          SET last_message_at = ?
          WHERE id = ?
        `,
      )
      .bind(input.now, input.sessionId)
      .run();
  }

  async getRecentMessages(sessionId: string, limit = 20): Promise<MessageRow[]> {
    const result = await this.db
      .prepare(
        `
          SELECT id, session_id, chat_id, telegram_message_id, role, content_text, created_at
          FROM messages
          WHERE session_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `,
      )
      .bind(sessionId, limit)
      .all<MessageRow>();

    return (result.results ?? []).reverse();
  }

  async createRun(input: {
    id: string;
    sessionId: string;
    updateId: number;
    provider: string;
    model: string;
    now: string;
  }): Promise<RunRow> {
    await this.db
      .prepare(
        `
          INSERT INTO runs (id, session_id, update_id, provider, model, status, error, input_tokens, output_tokens, created_at)
          VALUES (?, ?, ?, ?, ?, 'started', NULL, NULL, NULL, ?)
        `,
      )
      .bind(input.id, input.sessionId, input.updateId, input.provider, input.model, input.now)
      .run();

    return {
      id: input.id,
      session_id: input.sessionId,
      update_id: input.updateId,
      provider: input.provider,
      model: input.model,
      status: "started",
      error: null,
      input_tokens: null,
      output_tokens: null,
      created_at: input.now,
    };
  }

  async completeRun(input: {
    id: string;
    inputTokens?: number;
    outputTokens?: number;
  }): Promise<void> {
    await this.db
      .prepare(
        `
          UPDATE runs
          SET status = 'completed',
              input_tokens = ?,
              output_tokens = ?
          WHERE id = ?
        `,
      )
      .bind(input.inputTokens ?? null, input.outputTokens ?? null, input.id)
      .run();
  }

  async failRun(id: string, error: string): Promise<void> {
    await this.db
      .prepare(
        `
          UPDATE runs
          SET status = 'failed', error = ?
          WHERE id = ?
        `,
      )
      .bind(error, id)
      .run();
  }
}
