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
