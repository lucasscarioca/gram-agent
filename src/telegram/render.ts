import type { ModelSpec } from "../llm/catalog";
import type { SessionRow } from "../types";

import type { InlineKeyboardButton } from "./client";

export function buildSessionKeyboard(
  sessions: SessionRow[],
  activeSessionId: string | null,
): InlineKeyboardButton[][] {
  return sessions.map((session) => {
    const label =
      session.id === activeSessionId
        ? `[current] ${truncate(session.title, 40)}`
        : truncate(session.title, 50);

    return [{ text: label, callback_data: `session:${session.id}` }];
  });
}

export function buildSessionManageKeyboard(sessionId: string, isActive: boolean): InlineKeyboardButton[][] {
  return [
    [{ text: isActive ? "[current] Use" : "Use", callback_data: `session_use:${sessionId}` }],
    [{ text: "Rename", callback_data: `session_rename:${sessionId}` }],
    [{ text: "Delete", callback_data: `session_delete:${sessionId}` }],
  ];
}

export function buildSessionDeleteKeyboard(sessionId: string): InlineKeyboardButton[][] {
  return [
    [{ text: "Delete session", callback_data: `session_delete_confirm:${sessionId}` }],
    [{ text: "Cancel", callback_data: `session_delete_cancel:${sessionId}` }],
  ];
}

export function buildModelKeyboard(
  models: ModelSpec[],
  currentModel: string,
): InlineKeyboardButton[][] {
  return models.map((model) => {
    const label = model.id === currentModel ? `[current] ${model.label}` : model.label;
    return [{ text: label, callback_data: `model:${model.id}` }];
  });
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
