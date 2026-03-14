import type { ModelSpec } from "../llm/catalog";
import type { PendingApprovalRequest, QuestionState } from "../agent/types";
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

export function buildToolPermissionKeyboard(request: PendingApprovalRequest): InlineKeyboardButton[][] {
  return [
    [{ text: "Deny", callback_data: `tpd:${request.approvalId}` }],
    [{ text: "Allow once", callback_data: `tpo:${request.approvalId}` }],
    [{ text: `Always allow ${truncate(request.scopeValue, 24)}`, callback_data: `tpa:${request.approvalId}` }],
  ];
}

export function buildQuestionKeyboard(question: QuestionState): InlineKeyboardButton[][] {
  if (question.kind === "free_text") {
    return [[{ text: question.cancelLabel ?? "Cancel", callback_data: `qcan:${question.id}` }]];
  }

  if (question.kind === "confirm") {
    return [
      [{ text: question.options[0]?.label ?? "Confirm", callback_data: `qsel:${question.id}:0` }],
      [{ text: question.cancelLabel ?? question.options[1]?.label ?? "Cancel", callback_data: `qcan:${question.id}` }],
    ];
  }

  if (question.kind === "single_select") {
    return [
      ...question.options.map((option, index) => [
        {
          text: option.label,
          callback_data: `qsel:${question.id}:${index}`,
        },
      ]),
      [{ text: question.cancelLabel ?? "Cancel", callback_data: `qcan:${question.id}` }],
    ];
  }

  return [
    ...question.options.map((option, index) => {
      const selected = question.selectedIndexes.includes(index);
      return [
        {
          text: `${selected ? "[x]" : "[ ]"} ${option.label}`,
          callback_data: `qtog:${question.id}:${index}`,
        },
      ];
    }),
    [{ text: question.submitLabel ?? "Submit", callback_data: `qsub:${question.id}` }],
    [{ text: question.cancelLabel ?? "Cancel", callback_data: `qcan:${question.id}` }],
  ];
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
