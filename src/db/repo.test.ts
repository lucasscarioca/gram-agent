import { describe, expect, it } from "vitest";

import { Repo } from "./repo";

type Row = Record<string, unknown>;

class FakeStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.bindings = values;
    return this;
  }

  async run() {
    this.db.execute(this.sql, this.bindings);
    return { success: true };
  }

  async first<T>() {
    return (this.db.query(this.sql, this.bindings)[0] ?? null) as T | null;
  }

  async all<T>() {
    return { results: this.db.query(this.sql, this.bindings) as T[] };
  }
}

class FakeD1Database {
  chats = new Map<number, Row>();
  sessions = new Map<string, Row>();
  messages = new Map<string, Row>();
  memories = new Map<string, Row>();
  runs = new Map<string, Row>();
  pendingChatActions = new Map<string, Row>();
  agentRuns = new Map<string, Row>();
  toolCalls = new Map<string, Row>();
  pendingToolApprovals = new Map<string, Row>();
  pendingQuestions = new Map<string, Row>();

  prepare(sql: string) {
    return new FakeStatement(this, normalizeSql(sql));
  }

  execute(sql: string, bindings: unknown[]) {
    const key = normalizeSql(sql);

    if (key.startsWith("INSERT INTO chats")) {
      const [chatId, userId, createdAt, updatedAt] = bindings as [number, number, string, string];
      const existing = this.chats.get(chatId);
      this.chats.set(chatId, {
        chat_id: chatId,
        user_id: userId,
        active_session_id: existing?.active_session_id ?? null,
        created_at: existing?.created_at ?? createdAt,
        updated_at: updatedAt,
      });
      return;
    }

    if (key.startsWith("INSERT INTO sessions")) {
      const [id, chatId, userId, title, titleSource, titleUpdatedAt, selectedModel, createdAt, lastMessageAt] =
        bindings as [string, number, number, string, string, string, string, string, string];
      this.sessions.set(id, {
        id,
        chat_id: chatId,
        user_id: userId,
        title,
        title_source: titleSource,
        title_updated_at: titleUpdatedAt,
        last_auto_title_message_count: 0,
        selected_model: selectedModel,
        compacted_summary: null,
        compacted_at: null,
        last_compacted_message_id: null,
        last_context_warning_at: null,
        created_at: createdAt,
        last_message_at: lastMessageAt,
      });
      return;
    }

    if (key.startsWith("UPDATE chats SET active_session_id = ?, updated_at = ? WHERE chat_id = ?")) {
      const [sessionId, updatedAt, chatId] = bindings as [string | null, string, number];
      const chat = this.chats.get(chatId);
      if (chat) {
        this.chats.set(chatId, { ...chat, active_session_id: sessionId, updated_at: updatedAt });
      }
      return;
    }

    if (key.startsWith("INSERT INTO messages")) {
      const [id, sessionId, chatId, telegramMessageId, role, contentText, createdAt] = bindings as [
        string,
        string,
        number,
        number | null,
        string,
        string,
        string,
      ];
      this.messages.set(id, {
        id,
        session_id: sessionId,
        chat_id: chatId,
        telegram_message_id: telegramMessageId,
        role,
        content_text: contentText,
        created_at: createdAt,
      });
      return;
    }

    if (key.startsWith("UPDATE sessions SET last_message_at = ? WHERE id = ?")) {
      const [lastMessageAt, sessionId] = bindings as [string, string];
      const session = this.sessions.get(sessionId);
      if (session) {
        this.sessions.set(sessionId, { ...session, last_message_at: lastMessageAt });
      }
      return;
    }

    if (key.startsWith("INSERT INTO memories")) {
      const [id, userId, chatId, scope, kind, contentText, sourceSessionId, createdAt, updatedAt] = bindings as [
        string,
        number,
        number,
        string,
        string,
        string,
        string | null,
        string,
        string,
      ];
      this.memories.set(id, {
        id,
        user_id: userId,
        chat_id: chatId,
        scope,
        kind,
        content_text: contentText,
        status: "active",
        source_session_id: sourceSessionId,
        created_at: createdAt,
        updated_at: updatedAt,
        last_used_at: null,
      });
      return;
    }

    if (key.startsWith("UPDATE memories SET status = 'archived', updated_at = ? WHERE id = ? AND chat_id = ?")) {
      const [updatedAt, memoryId, chatId] = bindings as [string, string, number];
      const memory = this.memories.get(memoryId);
      if (memory && memory.chat_id === chatId) {
        this.memories.set(memoryId, { ...memory, status: "archived", updated_at: updatedAt });
      }
      return;
    }

    if (key.startsWith("INSERT INTO runs")) {
      const [id, sessionId, updateId, provider, model, createdAt] = bindings as [
        string,
        string,
        number,
        string,
        string,
        string,
      ];
      this.runs.set(id, {
        id,
        session_id: sessionId,
        update_id: updateId,
        provider,
        model,
        status: "started",
        error: null,
        input_tokens: null,
        cached_input_tokens: null,
        output_tokens: null,
        estimated_cost_usd: null,
        created_at: createdAt,
      });
      return;
    }

    if (key.startsWith("INSERT INTO agent_runs")) {
      const [runId, sessionId, chatId, replyToMessageId, model, provider, messagesJson, createdAt, updatedAt] =
        bindings as [string, string, number, number, string, string, string, string, string];
      this.agentRuns.set(runId, {
        run_id: runId,
        session_id: sessionId,
        chat_id: chatId,
        reply_to_message_id: replyToMessageId,
        status: "started",
        model,
        provider,
        messages_json: messagesJson,
        last_error: null,
        created_at: createdAt,
        updated_at: updatedAt,
        completed_at: null,
      });
      return;
    }

    if (key.startsWith("INSERT INTO tool_calls")) {
      const [id, runId, toolName, status, inputJson, outputJson, summaryText, displayMessageId, error, createdAt, updatedAt] =
        bindings as [string, string, string, string, string, string | null, string | null, number | null, string | null, string, string];
      this.toolCalls.set(id, {
        id,
        run_id: runId,
        tool_name: toolName,
        status,
        input_json: inputJson,
        output_json: outputJson,
        summary_text: summaryText,
        display_message_id: displayMessageId,
        error,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return;
    }

    if (key.startsWith("INSERT OR REPLACE INTO pending_questions")) {
      const [id, runId, toolCallId, chatId, questionKind, questionJson, createdAt] = bindings as [
        string,
        string,
        string,
        number,
        string,
        string,
        string,
      ];
      this.pendingQuestions.set(id, {
        id,
        run_id: runId,
        tool_call_id: toolCallId,
        chat_id: chatId,
        question_kind: questionKind,
        question_json: questionJson,
        created_at: createdAt,
      });
      return;
    }

    if (key.startsWith("INSERT OR REPLACE INTO pending_tool_approvals")) {
      const [id, runId, toolCallId, chatId, toolName, scopeType, scopeValue, requestJson, createdAt] = bindings as [
        string,
        string,
        string,
        number,
        string,
        string,
        string,
        string,
        string,
      ];
      this.pendingToolApprovals.set(id, {
        id,
        run_id: runId,
        tool_call_id: toolCallId,
        chat_id: chatId,
        tool_name: toolName,
        scope_type: scopeType,
        scope_value: scopeValue,
        request_json: requestJson,
        created_at: createdAt,
      });
      return;
    }

    if (key.startsWith("DELETE FROM pending_tool_approvals WHERE run_id IN (SELECT id FROM runs WHERE session_id = ?)")) {
      const [sessionId] = bindings as [string];
      const runIds = this.runIdsForSession(sessionId);
      for (const [id, row] of this.pendingToolApprovals) {
        if (runIds.has(row.run_id as string)) this.pendingToolApprovals.delete(id);
      }
      return;
    }

    if (key.startsWith("DELETE FROM pending_questions WHERE run_id IN (SELECT id FROM runs WHERE session_id = ?)")) {
      const [sessionId] = bindings as [string];
      const runIds = this.runIdsForSession(sessionId);
      for (const [id, row] of this.pendingQuestions) {
        if (runIds.has(row.run_id as string)) this.pendingQuestions.delete(id);
      }
      return;
    }

    if (key.startsWith("DELETE FROM tool_calls WHERE run_id IN (SELECT id FROM runs WHERE session_id = ?)")) {
      const [sessionId] = bindings as [string];
      const runIds = this.runIdsForSession(sessionId);
      for (const [id, row] of this.toolCalls) {
        if (runIds.has(row.run_id as string)) this.toolCalls.delete(id);
      }
      return;
    }

    if (key.startsWith("DELETE FROM agent_runs WHERE run_id IN (SELECT id FROM runs WHERE session_id = ?)")) {
      const [sessionId] = bindings as [string];
      const runIds = this.runIdsForSession(sessionId);
      for (const [id] of this.agentRuns) {
        if (runIds.has(id)) this.agentRuns.delete(id);
      }
      return;
    }

    if (key.startsWith("DELETE FROM messages WHERE session_id = ?")) {
      const [sessionId] = bindings as [string];
      for (const [id, row] of this.messages) {
        if (row.session_id === sessionId) this.messages.delete(id);
      }
      return;
    }

    if (key.startsWith("DELETE FROM runs WHERE session_id = ?")) {
      const [sessionId] = bindings as [string];
      for (const [id, row] of this.runs) {
        if (row.session_id === sessionId) this.runs.delete(id);
      }
      return;
    }

    if (key.startsWith("DELETE FROM pending_chat_actions WHERE session_id = ?")) {
      const [sessionId] = bindings as [string];
      for (const [id, row] of this.pendingChatActions) {
        if (row.session_id === sessionId) this.pendingChatActions.delete(id);
      }
      return;
    }

    if (key.startsWith("DELETE FROM sessions WHERE id = ? AND chat_id = ?")) {
      const [sessionId, chatId] = bindings as [string, number];
      const row = this.sessions.get(sessionId);
      if (row?.chat_id === chatId) this.sessions.delete(sessionId);
      return;
    }

    if (key.startsWith("UPDATE chats SET active_session_id = NULL WHERE chat_id = ? AND active_session_id = ?")) {
      const [chatId, sessionId] = bindings as [number, string];
      const chat = this.chats.get(chatId);
      if (chat?.active_session_id === sessionId) {
        this.chats.set(chatId, { ...chat, active_session_id: null });
      }
      return;
    }

    throw new Error(`Unsupported SQL in test fake: ${key}`);
  }

  query(sql: string, bindings: unknown[]) {
    const key = normalizeSql(sql);

    if (key.startsWith("SELECT chat_id, user_id, active_session_id, created_at, updated_at FROM chats WHERE chat_id = ?")) {
      const [chatId] = bindings as [number];
      return toResult(this.chats.get(chatId));
    }

    if (key.includes("FROM chats c JOIN sessions s ON s.id = c.active_session_id WHERE c.chat_id = ?")) {
      const [chatId] = bindings as [number];
      const chat = this.chats.get(chatId);
      return chat?.active_session_id ? toResult(this.sessions.get(chat.active_session_id as string)) : [];
    }

    if (key.startsWith("SELECT id, chat_id, user_id, title, title_source")) {
      if (key.includes("FROM sessions WHERE id = ?")) {
        const [sessionId] = bindings as [string];
        return toResult(this.sessions.get(sessionId));
      }
      if (key.includes("FROM sessions WHERE chat_id = ? ORDER BY last_message_at DESC, created_at DESC LIMIT ?")) {
        const [chatId, limit] = bindings as [number, number];
        return [...this.sessions.values()]
          .filter((row) => row.chat_id === chatId)
          .sort(sortByLastMessage)
          .slice(0, limit) as Row[];
      }
      if (key.includes("FROM sessions WHERE chat_id = ? ORDER BY last_message_at DESC, created_at DESC LIMIT 1")) {
        const [chatId] = bindings as [number];
        return [...this.sessions.values()].filter((row) => row.chat_id === chatId).sort(sortByLastMessage).slice(0, 1);
      }
    }

    if (key.startsWith("SELECT COUNT(*) AS count FROM messages WHERE session_id = ?")) {
      const [sessionId] = bindings as [string];
      return [{ count: [...this.messages.values()].filter((row) => row.session_id === sessionId).length }];
    }

    if (key.includes("FROM messages WHERE session_id = ? ORDER BY created_at ASC")) {
      const [sessionId] = bindings as [string];
      return [...this.messages.values()]
        .filter((row) => row.session_id === sessionId)
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    }

    if (key.includes("FROM messages WHERE session_id = ? ORDER BY created_at DESC")) {
      const [sessionId, limit] = bindings as [string, number];
      return [...this.messages.values()]
        .filter((row) => row.session_id === sessionId)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))
        .slice(0, limit);
    }

    if (key.includes("FROM memories WHERE chat_id = ? AND status = 'active' ORDER BY updated_at DESC, created_at DESC LIMIT ?")) {
      const [chatId, limit] = bindings as [number, number];
      return [...this.memories.values()]
        .filter((row) => row.chat_id === chatId && row.status === "active")
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, limit);
    }

    if (key.includes("FROM memories WHERE id = ?")) {
      const [memoryId] = bindings as [string];
      return toResult(this.memories.get(memoryId));
    }

    if (key.startsWith("SELECT COUNT(*) AS count FROM memories WHERE chat_id = ? AND status = 'active'")) {
      const [chatId] = bindings as [number];
      return [{ count: [...this.memories.values()].filter((row) => row.chat_id === chatId && row.status === "active").length }];
    }

    if (key.includes("FROM pending_questions WHERE id = ?")) {
      const [id] = bindings as [string];
      return toResult(this.pendingQuestions.get(id));
    }

    if (key.includes("FROM pending_tool_approvals WHERE id = ?")) {
      const [id] = bindings as [string];
      return toResult(this.pendingToolApprovals.get(id));
    }

    throw new Error(`Unsupported query SQL in test fake: ${key}`);
  }

  private runIdsForSession(sessionId: string) {
    return new Set([...this.runs.values()].filter((row) => row.session_id === sessionId).map((row) => row.id as string));
  }
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toResult(value: Row | undefined) {
  return value ? [{ ...value }] : [];
}

function sortByLastMessage(a: Row, b: Row) {
  return String(b.last_message_at).localeCompare(String(a.last_message_at)) || String(b.created_at).localeCompare(String(a.created_at));
}

describe("repo", () => {
  it("stores sessions and message history", async () => {
    const db = new FakeD1Database();
    const repo = new Repo(db as unknown as D1Database);

    await repo.ensureChat(1, 1, "2026-03-15T00:00:00.000Z");
    const session = await repo.createSession({
      id: "session-1",
      chatId: 1,
      userId: 1,
      title: "Test",
      titleSource: "manual",
      selectedModel: "google:gemini-2.5-flash",
      now: "2026-03-15T00:00:01.000Z",
    });
    await repo.appendMessage({
      id: "m1",
      sessionId: session.id,
      chatId: 1,
      telegramMessageId: 11,
      role: "user",
      contentText: "hello",
      now: "2026-03-15T00:00:02.000Z",
    });
    await repo.appendMessage({
      id: "m2",
      sessionId: session.id,
      chatId: 1,
      telegramMessageId: 12,
      role: "assistant",
      contentText: "hi",
      now: "2026-03-15T00:00:03.000Z",
    });

    expect((await repo.getActiveSession(1))?.id).toBe("session-1");
    expect(await repo.countMessages("session-1")).toBe(2);
    expect((await repo.getSessionMessages("session-1")).map((row) => row.id)).toEqual(["m1", "m2"]);
    expect((await repo.getRecentMessages("session-1", 1)).map((row) => row.id)).toEqual(["m2"]);
  });

  it("lists and archives memories", async () => {
    const db = new FakeD1Database();
    const repo = new Repo(db as unknown as D1Database);

    await repo.createMemory({
      id: "mem-1",
      userId: 1,
      chatId: 1,
      scope: "chat",
      kind: "note",
      contentText: "use pnpm",
      now: "2026-03-15T00:00:00.000Z",
    });
    await repo.createMemory({
      id: "mem-2",
      userId: 1,
      chatId: 1,
      scope: "chat",
      kind: "note",
      contentText: "prefer concise answers",
      now: "2026-03-15T00:00:01.000Z",
    });

    expect((await repo.listActiveMemoriesForChat(1)).map((row) => row.id)).toEqual(["mem-2", "mem-1"]);
    expect(await repo.countActiveMemoriesForChat(1)).toBe(2);

    await repo.archiveMemory("mem-1", 1, "2026-03-15T00:00:02.000Z");

    expect(await repo.countActiveMemoriesForChat(1)).toBe(1);
    expect((await repo.getMemory("mem-1"))?.status).toBe("archived");
    expect((await repo.listActiveMemoriesForChat(1)).map((row) => row.id)).toEqual(["mem-2"]);
  });

  it("deletes a session and its related records", async () => {
    const db = new FakeD1Database();
    const repo = new Repo(db as unknown as D1Database);

    await repo.ensureChat(1, 1, "2026-03-15T00:00:00.000Z");
    await repo.createSession({
      id: "session-1",
      chatId: 1,
      userId: 1,
      title: "Test",
      titleSource: "manual",
      selectedModel: "google:gemini-2.5-flash",
      now: "2026-03-15T00:00:01.000Z",
    });
    await repo.appendMessage({
      id: "m1",
      sessionId: "session-1",
      chatId: 1,
      telegramMessageId: 1,
      role: "user",
      contentText: "hello",
      now: "2026-03-15T00:00:02.000Z",
    });
    await repo.createRun({
      id: "run-1",
      sessionId: "session-1",
      updateId: 1,
      provider: "google",
      model: "gemini-2.5-flash",
      now: "2026-03-15T00:00:03.000Z",
    });
    await repo.createAgentRun({
      runId: "run-1",
      sessionId: "session-1",
      chatId: 1,
      replyToMessageId: 1,
      provider: "google",
      model: "google:gemini-2.5-flash",
      messagesJson: "{}",
      now: "2026-03-15T00:00:03.000Z",
    });
    await repo.upsertToolCall({
      id: "tool-1",
      runId: "run-1",
      toolName: "question",
      status: "waiting_user",
      inputJson: "{}",
      now: "2026-03-15T00:00:03.000Z",
    });
    await repo.createPendingQuestion({
      id: "pq-1",
      runId: "run-1",
      toolCallId: "tool-1",
      chatId: 1,
      questionKind: "free_text",
      questionJson: "{}",
      now: "2026-03-15T00:00:04.000Z",
    });
    await repo.createPendingToolApproval({
      id: "pa-1",
      runId: "run-1",
      toolCallId: "tool-1",
      chatId: 1,
      toolName: "web_fetch",
      scopeType: "domain",
      scopeValue: "example.com",
      requestJson: "{}",
      now: "2026-03-15T00:00:04.000Z",
    });

    await repo.deleteSession("session-1", 1);

    expect(await repo.getSession("session-1")).toBeNull();
    expect(await repo.getActiveSession(1)).toBeNull();
    expect(await repo.countMessages("session-1")).toBe(0);
    expect(await repo.getPendingQuestion("pq-1")).toBeNull();
    expect(await repo.getPendingToolApproval("pa-1")).toBeNull();
  });
});
