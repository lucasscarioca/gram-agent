import type {
  ChatRow,
  GroupedUsageRow,
  MessageRow,
  PendingChatActionRow,
  RunRow,
  SessionRow,
  UsageTotalsRow,
} from "../types";

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
          SELECT
            id,
            chat_id,
            user_id,
            title,
            title_source,
            title_updated_at,
            last_auto_title_message_count,
            selected_model,
            created_at,
            last_message_at
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
    titleSource: SessionRow["title_source"];
    selectedModel: string;
    now: string;
  }): Promise<SessionRow> {
    await this.db
      .prepare(
        `
          INSERT INTO sessions (
            id,
            chat_id,
            user_id,
            title,
            title_source,
            title_updated_at,
            last_auto_title_message_count,
            selected_model,
            created_at,
            last_message_at
          )
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
        `,
      )
      .bind(
        input.id,
        input.chatId,
        input.userId,
        input.title,
        input.titleSource,
        input.now,
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
      title_source: input.titleSource,
      title_updated_at: input.now,
      last_auto_title_message_count: 0,
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
          SELECT
            s.id,
            s.chat_id,
            s.user_id,
            s.title,
            s.title_source,
            s.title_updated_at,
            s.last_auto_title_message_count,
            s.selected_model,
            s.created_at,
            s.last_message_at
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
          SELECT
            id,
            chat_id,
            user_id,
            title,
            title_source,
            title_updated_at,
            last_auto_title_message_count,
            selected_model,
            created_at,
            last_message_at
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

  async updateSessionTitle(input: {
    sessionId: string;
    title: string;
    titleSource: SessionRow["title_source"];
    titleUpdatedAt: string;
    lastAutoTitleMessageCount?: number;
  }): Promise<void> {
    const autoCount = input.lastAutoTitleMessageCount ?? 0;

    await this.db
      .prepare(
        `
          UPDATE sessions
          SET title = ?,
              title_source = ?,
              title_updated_at = ?,
              last_auto_title_message_count = ?
          WHERE id = ?
        `,
      )
      .bind(input.title, input.titleSource, input.titleUpdatedAt, autoCount, input.sessionId)
      .run();
  }

  async getMostRecentSession(chatId: number): Promise<SessionRow | null> {
    const row = await this.db
      .prepare(
        `
          SELECT
            id,
            chat_id,
            user_id,
            title,
            title_source,
            title_updated_at,
            last_auto_title_message_count,
            selected_model,
            created_at,
            last_message_at
          FROM sessions
          WHERE chat_id = ?
          ORDER BY last_message_at DESC, created_at DESC
          LIMIT 1
        `,
      )
      .bind(chatId)
      .first<SessionRow>();

    return row ?? null;
  }

  async deleteSession(sessionId: string, chatId: number): Promise<void> {
    await this.db.prepare(`DELETE FROM messages WHERE session_id = ?`).bind(sessionId).run();
    await this.db.prepare(`DELETE FROM runs WHERE session_id = ?`).bind(sessionId).run();
    await this.db.prepare(`DELETE FROM pending_chat_actions WHERE session_id = ?`).bind(sessionId).run();
    await this.db.prepare(`DELETE FROM sessions WHERE id = ? AND chat_id = ?`).bind(sessionId, chatId).run();
    await this.db
      .prepare(
        `
          UPDATE chats
          SET active_session_id = NULL
          WHERE chat_id = ?
            AND active_session_id = ?
        `,
      )
      .bind(chatId, sessionId)
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

  async getPendingChatAction(chatId: number): Promise<PendingChatActionRow | null> {
    const row = await this.db
      .prepare(
        `
          SELECT chat_id, action, session_id, created_at
          FROM pending_chat_actions
          WHERE chat_id = ?
        `,
      )
      .bind(chatId)
      .first<PendingChatActionRow>();

    return row ?? null;
  }

  async setPendingChatAction(input: {
    chatId: number;
    action: PendingChatActionRow["action"];
    sessionId: string;
    now: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `
          INSERT INTO pending_chat_actions (chat_id, action, session_id, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(chat_id) DO UPDATE SET
            action = excluded.action,
            session_id = excluded.session_id,
            created_at = excluded.created_at
        `,
      )
      .bind(input.chatId, input.action, input.sessionId, input.now)
      .run();
  }

  async clearPendingChatAction(chatId: number): Promise<void> {
    await this.db.prepare(`DELETE FROM pending_chat_actions WHERE chat_id = ?`).bind(chatId).run();
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
          INSERT INTO runs (
            id,
            session_id,
            update_id,
            provider,
            model,
            status,
            error,
            input_tokens,
            cached_input_tokens,
            output_tokens,
            estimated_cost_usd,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, 'started', NULL, NULL, NULL, NULL, NULL, ?)
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
      cached_input_tokens: null,
      output_tokens: null,
      estimated_cost_usd: null,
      created_at: input.now,
    };
  }

  async completeRun(input: {
    id: string;
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number | null;
  }): Promise<void> {
    await this.db
      .prepare(
        `
          UPDATE runs
          SET status = 'completed',
              input_tokens = ?,
              cached_input_tokens = ?,
              output_tokens = ?,
              estimated_cost_usd = ?
          WHERE id = ?
        `,
      )
      .bind(
        input.inputTokens ?? null,
        input.cachedInputTokens ?? null,
        input.outputTokens ?? null,
        input.estimatedCostUsd ?? null,
        input.id,
      )
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

  async getSessionUsageTotals(sessionId: string): Promise<UsageTotalsRow> {
    return this.getUsageTotals({
      whereClause: "session_id = ? AND status = 'completed'",
      bindings: [sessionId],
    });
  }

  async getGlobalUsageTotals(): Promise<UsageTotalsRow> {
    return this.getUsageTotals({
      whereClause: "status = 'completed'",
      bindings: [],
    });
  }

  async getUsageTotalsSince(since: string): Promise<UsageTotalsRow> {
    return this.getUsageTotals({
      whereClause: "status = 'completed' AND created_at >= ?",
      bindings: [since],
    });
  }

  async getTopProviders(input: { since?: string; limit?: number }): Promise<GroupedUsageRow[]> {
    return this.getGroupedUsage({
      column: "provider",
      since: input.since,
      limit: input.limit ?? 3,
    });
  }

  async getTopModels(input: { since?: string; limit?: number }): Promise<GroupedUsageRow[]> {
    return this.getGroupedUsage({
      column: "provider || ':' || model",
      since: input.since,
      limit: input.limit ?? 5,
    });
  }

  private async getUsageTotals(input: {
    whereClause: string;
    bindings: unknown[];
  }): Promise<UsageTotalsRow> {
    const row = await this.db
      .prepare(
        `
          SELECT
            COUNT(*) AS run_count,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
          FROM runs
          WHERE ${input.whereClause}
        `,
      )
      .bind(...input.bindings)
      .first<UsageTotalsRow>();

    return {
      run_count: Number(row?.run_count ?? 0),
      input_tokens: Number(row?.input_tokens ?? 0),
      cached_input_tokens: Number(row?.cached_input_tokens ?? 0),
      output_tokens: Number(row?.output_tokens ?? 0),
      estimated_cost_usd: Number(row?.estimated_cost_usd ?? 0),
    };
  }

  private async getGroupedUsage(input: {
    column: string;
    since?: string;
    limit: number;
  }): Promise<GroupedUsageRow[]> {
    const whereClause = input.since
      ? "status = 'completed' AND created_at >= ?"
      : "status = 'completed'";
    const bindings = input.since ? [input.since, input.limit] : [input.limit];
    const result = await this.db
      .prepare(
        `
          SELECT
            ${input.column} AS key,
            COUNT(*) AS run_count,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
          FROM runs
          WHERE ${whereClause}
          GROUP BY key
          ORDER BY
            COALESCE(SUM(estimated_cost_usd), 0) DESC,
            (COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0)) DESC,
            key ASC
          LIMIT ?
        `,
      )
      .bind(...bindings)
      .all<GroupedUsageRow>();

    return (result.results ?? []).map((row) => ({
      key: row.key,
      run_count: Number(row.run_count ?? 0),
      input_tokens: Number(row.input_tokens ?? 0),
      cached_input_tokens: Number(row.cached_input_tokens ?? 0),
      output_tokens: Number(row.output_tokens ?? 0),
      estimated_cost_usd: Number(row.estimated_cost_usd ?? 0),
    }));
  }
}
