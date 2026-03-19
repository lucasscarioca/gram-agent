import type {
  AgentRunRow,
  AdminBootstrap,
  ChatRow,
  DailyUsageRow,
  GroupedUsageRow,
  MemoryRow,
  MessageRow,
  PendingApprovalListItem,
  PendingChatActionRow,
  PendingQuestionListItem,
  PendingQuestionRow,
  PendingToolApprovalRow,
  RunRow,
  RunListItem,
  RunDetail,
  SessionDetail,
  SessionListItem,
  SessionRow,
  ToolCallRow,
  ToolCallListItem,
  ToolPermissionListItem,
  ToolPermissionRow,
  UsageTotalsRow,
} from "../types";

export class Repo {
  constructor(private readonly db: D1Database) {}

  async createMemory(input: {
    id: string;
    userId: number;
    chatId: number;
    scope: MemoryRow["scope"];
    kind: MemoryRow["kind"];
    contentText: string;
    sourceSessionId?: string | null;
    now: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `
          INSERT INTO memories (
            id,
            user_id,
            chat_id,
            scope,
            kind,
            content_text,
            status,
            source_session_id,
            created_at,
            updated_at,
            last_used_at
          )
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)
        `,
      )
      .bind(
        input.id,
        input.userId,
        input.chatId,
        input.scope,
        input.kind,
        input.contentText,
        input.sourceSessionId ?? null,
        input.now,
        input.now,
      )
      .run();
  }

  async listActiveMemoriesForChat(chatId: number, limit = 20): Promise<MemoryRow[]> {
    const result = await this.db
      .prepare(
        `
          SELECT
            id,
            user_id,
            chat_id,
            scope,
            kind,
            content_text,
            status,
            source_session_id,
            created_at,
            updated_at,
            last_used_at
          FROM memories
          WHERE chat_id = ?
            AND status = 'active'
          ORDER BY updated_at DESC, created_at DESC
          LIMIT ?
        `,
      )
      .bind(chatId, limit)
      .all<MemoryRow>();

    return result.results ?? [];
  }

  async getMemory(memoryId: string): Promise<MemoryRow | null> {
    const row = await this.db
      .prepare(
        `
          SELECT
            id,
            user_id,
            chat_id,
            scope,
            kind,
            content_text,
            status,
            source_session_id,
            created_at,
            updated_at,
            last_used_at
          FROM memories
          WHERE id = ?
        `,
      )
      .bind(memoryId)
      .first<MemoryRow>();

    return row ?? null;
  }

  async archiveMemory(memoryId: string, chatId: number, now: string): Promise<void> {
    await this.db
      .prepare(
        `
          UPDATE memories
          SET status = 'archived', updated_at = ?
          WHERE id = ?
            AND chat_id = ?
        `,
      )
      .bind(now, memoryId, chatId)
      .run();
  }

  async countActiveMemoriesForChat(chatId: number): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS count FROM memories WHERE chat_id = ? AND status = 'active'`)
      .bind(chatId)
      .first<{ count: number | string }>();

    return Number(row?.count ?? 0);
  }

  async ensureChat(chatId: number, userId: number, now: string): Promise<void> {
    await this.db
      .prepare(
        `
          INSERT INTO chats (
            chat_id,
            user_id,
            active_session_id,
            default_vision_model,
            default_transcription_model,
            created_at,
            updated_at
          )
          VALUES (?, ?, NULL, NULL, NULL, ?, ?)
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
          SELECT
            chat_id,
            user_id,
            active_session_id,
            default_vision_model,
            default_transcription_model,
            created_at,
            updated_at
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
            compacted_summary,
            compacted_at,
            last_compacted_message_id,
            last_context_warning_at,
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
            compacted_summary,
            compacted_at,
            last_compacted_message_id,
            last_context_warning_at,
            created_at,
            last_message_at
          )
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL, NULL, ?, ?)
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
      compacted_summary: null,
      compacted_at: null,
      last_compacted_message_id: null,
      last_context_warning_at: null,
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

  async updateChatVisionModel(chatId: number, modelId: string | null, now: string): Promise<void> {
    await this.db
      .prepare(
        `
          UPDATE chats
          SET default_vision_model = ?, updated_at = ?
          WHERE chat_id = ?
        `,
      )
      .bind(modelId, now, chatId)
      .run();
  }

  async updateChatTranscriptionModel(chatId: number, modelId: string | null, now: string): Promise<void> {
    await this.db
      .prepare(
        `
          UPDATE chats
          SET default_transcription_model = ?, updated_at = ?
          WHERE chat_id = ?
        `,
      )
      .bind(modelId, now, chatId)
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
            s.compacted_summary,
            s.compacted_at,
            s.last_compacted_message_id,
            s.last_context_warning_at,
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
            compacted_summary,
            compacted_at,
            last_compacted_message_id,
            last_context_warning_at,
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

  async updateSessionCompaction(input: {
    sessionId: string;
    compactedSummary: string;
    compactedAt: string;
    lastCompactedMessageId: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `
          UPDATE sessions
          SET compacted_summary = ?,
              compacted_at = ?,
              last_compacted_message_id = ?,
              last_context_warning_at = NULL
          WHERE id = ?
        `,
      )
      .bind(input.compactedSummary, input.compactedAt, input.lastCompactedMessageId, input.sessionId)
      .run();
  }

  async updateSessionContextWarning(sessionId: string, warnedAt: string | null): Promise<void> {
    await this.db
      .prepare(
        `
          UPDATE sessions
          SET last_context_warning_at = ?
          WHERE id = ?
        `,
      )
      .bind(warnedAt, sessionId)
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
            compacted_summary,
            compacted_at,
            last_compacted_message_id,
            last_context_warning_at,
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
    await this.db
      .prepare(`DELETE FROM pending_tool_approvals WHERE run_id IN (SELECT id FROM runs WHERE session_id = ?)`)
      .bind(sessionId)
      .run();
    await this.db
      .prepare(`DELETE FROM pending_questions WHERE run_id IN (SELECT id FROM runs WHERE session_id = ?)`)
      .bind(sessionId)
      .run();
    await this.db
      .prepare(`DELETE FROM tool_calls WHERE run_id IN (SELECT id FROM runs WHERE session_id = ?)`)
      .bind(sessionId)
      .run();
    await this.db
      .prepare(`DELETE FROM agent_runs WHERE run_id IN (SELECT id FROM runs WHERE session_id = ?)`)
      .bind(sessionId)
      .run();
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
    contentJson?: string | null;
    now: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `
          INSERT INTO messages (
            id,
            session_id,
            chat_id,
            telegram_message_id,
            role,
            content_text,
            content_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        input.id,
        input.sessionId,
        input.chatId,
        input.telegramMessageId,
        input.role,
        input.contentText,
        input.contentJson ?? null,
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
          SELECT id, session_id, chat_id, telegram_message_id, role, content_text, content_json, created_at
          FROM messages
          WHERE session_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
      )
      .bind(sessionId, limit)
      .all<MessageRow>();

    return (result.results ?? []).reverse();
  }

  async getSessionMessages(sessionId: string): Promise<MessageRow[]> {
    const result = await this.db
      .prepare(
        `
          SELECT id, session_id, chat_id, telegram_message_id, role, content_text, content_json, created_at
          FROM messages
          WHERE session_id = ?
          ORDER BY created_at ASC
        `,
      )
      .bind(sessionId)
      .all<MessageRow>();

    return result.results ?? [];
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

  async createAgentRun(input: {
    runId: string;
    sessionId: string;
    chatId: number;
    replyToMessageId: number;
    provider: string;
    model: string;
    messagesJson: string;
    now: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `
          INSERT INTO agent_runs (
            run_id,
            session_id,
            chat_id,
            reply_to_message_id,
            status,
            model,
            provider,
            messages_json,
            last_error,
            created_at,
            updated_at,
            completed_at
          )
          VALUES (?, ?, ?, ?, 'started', ?, ?, ?, NULL, ?, ?, NULL)
        `,
      )
      .bind(
        input.runId,
        input.sessionId,
        input.chatId,
        input.replyToMessageId,
        input.model,
        input.provider,
        input.messagesJson,
        input.now,
        input.now,
      )
      .run();
  }

  async getAgentRun(runId: string): Promise<AgentRunRow | null> {
    const row = await this.db
      .prepare(
        `
          SELECT
            run_id,
            session_id,
            chat_id,
            reply_to_message_id,
            status,
            model,
            provider,
            messages_json,
            last_error,
            created_at,
            updated_at,
            completed_at
          FROM agent_runs
          WHERE run_id = ?
        `,
      )
      .bind(runId)
      .first<AgentRunRow>();

    return row ?? null;
  }

  async getActiveAgentRunForChat(chatId: number): Promise<AgentRunRow | null> {
    const row = await this.db
      .prepare(
        `
          SELECT
            run_id,
            session_id,
            chat_id,
            reply_to_message_id,
            status,
            model,
            provider,
            messages_json,
            last_error,
            created_at,
            updated_at,
            completed_at
          FROM agent_runs
          WHERE chat_id = ?
            AND status IN ('started', 'waiting_permission', 'waiting_question')
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1
        `,
      )
      .bind(chatId)
      .first<AgentRunRow>();

    return row ?? null;
  }

  async updateAgentRunMessages(runId: string, messagesJson: string, now: string): Promise<void> {
    await this.db
      .prepare(
        `
          UPDATE agent_runs
          SET messages_json = ?, updated_at = ?
          WHERE run_id = ?
        `,
      )
      .bind(messagesJson, now, runId)
      .run();
  }

  async setAgentRunStatus(input: {
    runId: string;
    status: AgentRunRow["status"];
    now: string;
    lastError?: string | null;
    completedAt?: string | null;
  }): Promise<void> {
    await this.db
      .prepare(
        `
          UPDATE agent_runs
          SET status = ?,
              last_error = ?,
              updated_at = ?,
              completed_at = ?
          WHERE run_id = ?
        `,
      )
      .bind(input.status, input.lastError ?? null, input.now, input.completedAt ?? null, input.runId)
      .run();
  }

  async upsertToolCall(input: {
    id: string;
    runId: string;
    toolName: ToolCallRow["tool_name"];
    status: ToolCallRow["status"];
    inputJson: string;
    now: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `
          INSERT INTO tool_calls (
            id,
            run_id,
            tool_name,
            status,
            input_json,
            output_json,
            summary_text,
            display_message_id,
            error,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            input_json = excluded.input_json,
            updated_at = excluded.updated_at
        `,
      )
      .bind(input.id, input.runId, input.toolName, input.status, input.inputJson, input.now, input.now)
      .run();
  }

  async getToolCall(id: string): Promise<ToolCallRow | null> {
    const row = await this.db
      .prepare(
        `
          SELECT
            id,
            run_id,
            tool_name,
            status,
            input_json,
            output_json,
            summary_text,
            display_message_id,
            error,
            created_at,
            updated_at
          FROM tool_calls
          WHERE id = ?
        `,
      )
      .bind(id)
      .first<ToolCallRow>();

    return row ?? null;
  }

  async updateToolCallDisplayMessage(id: string, displayMessageId: number, now: string): Promise<void> {
    await this.db
      .prepare(
        `
          UPDATE tool_calls
          SET display_message_id = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(displayMessageId, now, id)
      .run();
  }

  async updateToolCallStatus(input: {
    id: string;
    status: ToolCallRow["status"];
    now: string;
    outputJson?: string | null;
    summaryText?: string | null;
    error?: string | null;
  }): Promise<void> {
    await this.db
      .prepare(
        `
          UPDATE tool_calls
          SET status = ?,
              output_json = COALESCE(?, output_json),
              summary_text = COALESCE(?, summary_text),
              error = ?,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        input.status,
        input.outputJson ?? null,
        input.summaryText ?? null,
        input.error ?? null,
        input.now,
        input.id,
      )
      .run();
  }

  async countToolCalls(runId: string, toolName?: ToolCallRow["tool_name"]): Promise<number> {
    const row = await this.db
      .prepare(
        toolName
          ? `SELECT COUNT(*) AS count FROM tool_calls WHERE run_id = ? AND tool_name = ?`
          : `SELECT COUNT(*) AS count FROM tool_calls WHERE run_id = ?`,
      )
      .bind(...(toolName ? [runId, toolName] : [runId]))
      .first<{ count: number | string }>();

    return Number(row?.count ?? 0);
  }

  async putToolPermission(input: {
    id: string;
    chatId: number;
    toolName: ToolPermissionRow["tool_name"];
    scopeType: ToolPermissionRow["scope_type"];
    scopeValue: string;
    now: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `
          INSERT INTO tool_permissions (
            id,
            chat_id,
            tool_name,
            scope_type,
            scope_value,
            decision,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, 'allow', ?, ?)
          ON CONFLICT(chat_id, tool_name, scope_type, scope_value) DO UPDATE SET
            updated_at = excluded.updated_at
        `,
      )
      .bind(input.id, input.chatId, input.toolName, input.scopeType, input.scopeValue, input.now, input.now)
      .run();
  }

  async getToolPermission(input: {
    chatId: number;
    toolName: ToolPermissionRow["tool_name"];
    scopeType: ToolPermissionRow["scope_type"];
    scopeValue: string;
  }): Promise<ToolPermissionRow | null> {
    const row = await this.db
      .prepare(
        `
          SELECT
            id,
            chat_id,
            tool_name,
            scope_type,
            scope_value,
            decision,
            created_at,
            updated_at
          FROM tool_permissions
          WHERE chat_id = ?
            AND tool_name = ?
            AND scope_type = ?
            AND scope_value = ?
        `,
      )
      .bind(input.chatId, input.toolName, input.scopeType, input.scopeValue)
      .first<ToolPermissionRow>();

    return row ?? null;
  }

  async createPendingToolApproval(input: {
    id: string;
    runId: string;
    toolCallId: string;
    chatId: number;
    toolName: PendingToolApprovalRow["tool_name"];
    scopeType: PendingToolApprovalRow["scope_type"];
    scopeValue: string;
    requestJson: string;
    now: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `
          INSERT OR REPLACE INTO pending_tool_approvals (
            id,
            run_id,
            tool_call_id,
            chat_id,
            tool_name,
            scope_type,
            scope_value,
            request_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        input.id,
        input.runId,
        input.toolCallId,
        input.chatId,
        input.toolName,
        input.scopeType,
        input.scopeValue,
        input.requestJson,
        input.now,
      )
      .run();
  }

  async getPendingToolApproval(id: string): Promise<PendingToolApprovalRow | null> {
    const row = await this.db
      .prepare(
        `
          SELECT
            id,
            run_id,
            tool_call_id,
            chat_id,
            tool_name,
            scope_type,
            scope_value,
            request_json,
            created_at
          FROM pending_tool_approvals
          WHERE id = ?
        `,
      )
      .bind(id)
      .first<PendingToolApprovalRow>();

    return row ?? null;
  }

  async listPendingToolApprovals(runId: string): Promise<PendingToolApprovalRow[]> {
    const result = await this.db
      .prepare(
        `
          SELECT
            id,
            run_id,
            tool_call_id,
            chat_id,
            tool_name,
            scope_type,
            scope_value,
            request_json,
            created_at
          FROM pending_tool_approvals
          WHERE run_id = ?
          ORDER BY created_at ASC
        `,
      )
      .bind(runId)
      .all<PendingToolApprovalRow>();

    return result.results ?? [];
  }

  async deletePendingToolApproval(id: string): Promise<void> {
    await this.db.prepare(`DELETE FROM pending_tool_approvals WHERE id = ?`).bind(id).run();
  }

  async deletePendingToolApprovalsForRun(runId: string): Promise<void> {
    await this.db.prepare(`DELETE FROM pending_tool_approvals WHERE run_id = ?`).bind(runId).run();
  }

  async createPendingQuestion(input: {
    id: string;
    runId: string;
    toolCallId: string;
    chatId: number;
    questionKind: PendingQuestionRow["question_kind"];
    questionJson: string;
    now: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `
          INSERT OR REPLACE INTO pending_questions (
            id,
            run_id,
            tool_call_id,
            chat_id,
            question_kind,
            question_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(input.id, input.runId, input.toolCallId, input.chatId, input.questionKind, input.questionJson, input.now)
      .run();
  }

  async getPendingQuestion(id: string): Promise<PendingQuestionRow | null> {
    const row = await this.db
      .prepare(
        `
          SELECT
            id,
            run_id,
            tool_call_id,
            chat_id,
            question_kind,
            question_json,
            created_at
          FROM pending_questions
          WHERE id = ?
        `,
      )
      .bind(id)
      .first<PendingQuestionRow>();

    return row ?? null;
  }

  async getPendingQuestionForChat(chatId: number): Promise<PendingQuestionRow | null> {
    const row = await this.db
      .prepare(
        `
          SELECT
            id,
            run_id,
            tool_call_id,
            chat_id,
            question_kind,
            question_json,
            created_at
          FROM pending_questions
          WHERE chat_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `,
      )
      .bind(chatId)
      .first<PendingQuestionRow>();

    return row ?? null;
  }

  async listPendingQuestions(runId: string): Promise<PendingQuestionRow[]> {
    const result = await this.db
      .prepare(
        `
          SELECT
            id,
            run_id,
            tool_call_id,
            chat_id,
            question_kind,
            question_json,
            created_at
          FROM pending_questions
          WHERE run_id = ?
          ORDER BY created_at ASC
        `,
      )
      .bind(runId)
      .all<PendingQuestionRow>();

    return result.results ?? [];
  }

  async deletePendingQuestion(id: string): Promise<void> {
    await this.db.prepare(`DELETE FROM pending_questions WHERE id = ?`).bind(id).run();
  }

  async deletePendingQuestionsForRun(runId: string): Promise<void> {
    await this.db.prepare(`DELETE FROM pending_questions WHERE run_id = ?`).bind(runId).run();
  }

  async listSessionsForDashboard(chatId: number, limit = 20): Promise<SessionListItem[]> {
    const result = await this.db
      .prepare(
        `
          SELECT
            s.id,
            s.title,
            s.title_source,
            s.selected_model,
            s.created_at,
            s.last_message_at,
            s.compacted_at,
            s.compacted_summary,
            CASE WHEN c.active_session_id = s.id THEN 1 ELSE 0 END AS is_active,
            COALESCE(COUNT(DISTINCT m.id), 0) AS message_count,
            COALESCE(COUNT(DISTINCT r.id), 0) AS run_count,
            COALESCE(SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_run_count,
            COALESCE(SUM(CASE WHEN r.status = 'completed' THEN r.estimated_cost_usd ELSE 0 END), 0) AS estimated_cost_usd
          FROM sessions s
          LEFT JOIN chats c ON c.chat_id = s.chat_id
          LEFT JOIN messages m ON m.session_id = s.id
          LEFT JOIN runs r ON r.session_id = s.id
          WHERE s.chat_id = ?
          GROUP BY
            s.id,
            s.title,
            s.title_source,
            s.selected_model,
            s.created_at,
            s.last_message_at,
            s.compacted_at,
            s.compacted_summary,
            c.active_session_id
          ORDER BY s.last_message_at DESC, s.created_at DESC
          LIMIT ?
        `,
      )
      .bind(chatId, limit)
      .all<SessionListItem>();

    return (result.results ?? []).map((row) => ({
      ...row,
      message_count: Number(row.message_count ?? 0),
      run_count: Number(row.run_count ?? 0),
      failed_run_count: Number(row.failed_run_count ?? 0),
      estimated_cost_usd: Number(row.estimated_cost_usd ?? 0),
      is_active: Boolean(Number(row.is_active ?? 0)),
    }));
  }

  async listRunsForDashboard(input: {
    chatId: number;
    limit?: number;
    status?: RunRow["status"];
    sessionId?: string;
  }): Promise<RunListItem[]> {
    const where = ["s.chat_id = ?"];
    const bindings: unknown[] = [input.chatId];

    if (input.status) {
      where.push("r.status = ?");
      bindings.push(input.status);
    }

    if (input.sessionId) {
      where.push("r.session_id = ?");
      bindings.push(input.sessionId);
    }

    bindings.push(input.limit ?? 30);

    const result = await this.db
      .prepare(
        `
          SELECT
            r.id,
            r.session_id,
            s.title AS session_title,
            r.provider,
            r.model,
            r.status,
            r.error,
            r.input_tokens,
            r.cached_input_tokens,
            r.output_tokens,
            r.estimated_cost_usd,
            r.created_at,
            ar.status AS agent_status,
            ar.last_error AS agent_last_error
          FROM runs r
          JOIN sessions s ON s.id = r.session_id
          LEFT JOIN agent_runs ar ON ar.run_id = r.id
          WHERE ${where.join(" AND ")}
          ORDER BY r.created_at DESC
          LIMIT ?
        `,
      )
      .bind(...bindings)
      .all<RunListItem>();

    return (result.results ?? []).map((row) => ({
      ...row,
      input_tokens: row.input_tokens === null ? null : Number(row.input_tokens),
      cached_input_tokens: row.cached_input_tokens === null ? null : Number(row.cached_input_tokens),
      output_tokens: row.output_tokens === null ? null : Number(row.output_tokens),
      estimated_cost_usd: row.estimated_cost_usd === null ? null : Number(row.estimated_cost_usd),
    }));
  }

  async getRun(runId: string): Promise<RunRow | null> {
    const row = await this.db
      .prepare(
        `
          SELECT
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
          FROM runs
          WHERE id = ?
        `,
      )
      .bind(runId)
      .first<RunRow>();

    if (!row) {
      return null;
    }

    return {
      ...row,
      input_tokens: row.input_tokens === null ? null : Number(row.input_tokens),
      cached_input_tokens: row.cached_input_tokens === null ? null : Number(row.cached_input_tokens),
      output_tokens: row.output_tokens === null ? null : Number(row.output_tokens),
      estimated_cost_usd: row.estimated_cost_usd === null ? null : Number(row.estimated_cost_usd),
    };
  }

  async listToolCallsForRun(runId: string): Promise<ToolCallRow[]> {
    const result = await this.db
      .prepare(
        `
          SELECT
            id,
            run_id,
            tool_name,
            status,
            input_json,
            output_json,
            summary_text,
            display_message_id,
            error,
            created_at,
            updated_at
          FROM tool_calls
          WHERE run_id = ?
          ORDER BY created_at ASC
        `,
      )
      .bind(runId)
      .all<ToolCallRow>();

    return result.results ?? [];
  }

  async listRecentToolCallsForSession(sessionId: string, limit = 20): Promise<ToolCallListItem[]> {
    const result = await this.db
      .prepare(
        `
          SELECT
            tc.id,
            tc.run_id,
            tc.tool_name,
            tc.status,
            tc.input_json,
            tc.output_json,
            tc.summary_text,
            tc.display_message_id,
            tc.error,
            tc.created_at,
            tc.updated_at,
            r.created_at AS run_created_at
          FROM tool_calls tc
          JOIN runs r ON r.id = tc.run_id
          WHERE r.session_id = ?
          ORDER BY tc.created_at DESC
          LIMIT ?
        `,
      )
      .bind(sessionId, limit)
      .all<ToolCallListItem>();

    return result.results ?? [];
  }

  async listPendingToolApprovalsForChat(chatId: number, limit = 20): Promise<PendingApprovalListItem[]> {
    const result = await this.db
      .prepare(
        `
          SELECT
            pta.id,
            pta.run_id,
            pta.tool_call_id,
            pta.chat_id,
            pta.tool_name,
            pta.scope_type,
            pta.scope_value,
            pta.request_json,
            pta.created_at,
            r.session_id,
            s.title AS session_title,
            r.created_at AS run_created_at
          FROM pending_tool_approvals pta
          JOIN runs r ON r.id = pta.run_id
          JOIN sessions s ON s.id = r.session_id
          WHERE pta.chat_id = ?
          ORDER BY pta.created_at ASC
          LIMIT ?
        `,
      )
      .bind(chatId, limit)
      .all<PendingApprovalListItem>();

    return result.results ?? [];
  }

  async countPendingToolApprovalsForChat(chatId: number): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS count FROM pending_tool_approvals WHERE chat_id = ?`)
      .bind(chatId)
      .first<{ count: number | string }>();

    return Number(row?.count ?? 0);
  }

  async listPendingQuestionsForChat(chatId: number, limit = 20): Promise<PendingQuestionListItem[]> {
    const result = await this.db
      .prepare(
        `
          SELECT
            pq.id,
            pq.run_id,
            pq.tool_call_id,
            pq.chat_id,
            pq.question_kind,
            pq.question_json,
            pq.created_at,
            r.session_id,
            s.title AS session_title,
            r.created_at AS run_created_at
          FROM pending_questions pq
          JOIN runs r ON r.id = pq.run_id
          JOIN sessions s ON s.id = r.session_id
          WHERE pq.chat_id = ?
          ORDER BY pq.created_at ASC
          LIMIT ?
        `,
      )
      .bind(chatId, limit)
      .all<PendingQuestionListItem>();

    return result.results ?? [];
  }

  async countPendingQuestionsForChat(chatId: number): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS count FROM pending_questions WHERE chat_id = ?`)
      .bind(chatId)
      .first<{ count: number | string }>();

    return Number(row?.count ?? 0);
  }

  async listToolPermissionsForChat(chatId: number): Promise<ToolPermissionListItem[]> {
    const result = await this.db
      .prepare(
        `
          SELECT
            id,
            chat_id,
            tool_name,
            scope_type,
            scope_value,
            decision,
            created_at,
            updated_at
          FROM tool_permissions
          WHERE chat_id = ?
          ORDER BY updated_at DESC, created_at DESC
        `,
      )
      .bind(chatId)
      .all<ToolPermissionListItem>();

    return result.results ?? [];
  }

  async listMemoriesForDashboard(chatId: number, limit = 50): Promise<MemoryRow[]> {
    const result = await this.db
      .prepare(
        `
          SELECT
            id,
            user_id,
            chat_id,
            scope,
            kind,
            content_text,
            status,
            source_session_id,
            created_at,
            updated_at,
            last_used_at
          FROM memories
          WHERE chat_id = ?
          ORDER BY status ASC, updated_at DESC, created_at DESC
          LIMIT ?
        `,
      )
      .bind(chatId, limit)
      .all<MemoryRow>();

    return result.results ?? [];
  }

  async getDailyUsageSince(since: string): Promise<DailyUsageRow[]> {
    const result = await this.db
      .prepare(
        `
          SELECT
            substr(created_at, 1, 10) AS day,
            COUNT(*) AS run_count,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
          FROM runs
          WHERE status = 'completed'
            AND created_at >= ?
          GROUP BY day
          ORDER BY day ASC
        `,
      )
      .bind(since)
      .all<DailyUsageRow>();

    return (result.results ?? []).map((row) => ({
      day: row.day,
      run_count: Number(row.run_count ?? 0),
      input_tokens: Number(row.input_tokens ?? 0),
      output_tokens: Number(row.output_tokens ?? 0),
      estimated_cost_usd: Number(row.estimated_cost_usd ?? 0),
    }));
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
