const COMMANDS = new Set([
  "help",
  "new",
  "list",
  "model",
  "rename",
  "delete",
  "cancel",
  "status",
  "analytics",
  "compact",
  "remember",
  "memories",
  "forget",
  "settings",
  "dashboard",
]);

export type SupportedCommand =
  | "help"
  | "new"
  | "list"
  | "model"
  | "rename"
  | "delete"
  | "cancel"
  | "status"
  | "analytics"
  | "compact"
  | "remember"
  | "memories"
  | "forget"
  | "settings"
  | "dashboard";

export type CallbackAction =
  | { kind: "command"; command: Exclude<SupportedCommand, "help" | "rename" | "delete" | "cancel" | "status" | "analytics"> }
  | { kind: "session_manage"; sessionId: string }
  | { kind: "session_use"; sessionId: string }
  | { kind: "session_rename"; sessionId: string }
  | { kind: "session_delete"; sessionId: string }
  | { kind: "session_delete_confirm"; sessionId: string }
  | { kind: "session_delete_cancel"; sessionId: string }
  | { kind: "model"; modelId: string }
  | { kind: "settings" }
  | { kind: "settings_vision" }
  | { kind: "settings_transcription" }
  | { kind: "settings_vision_set"; modelId: string }
  | { kind: "settings_vision_clear" }
  | { kind: "settings_transcription_set"; modelId: string }
  | { kind: "settings_transcription_clear" }
  | { kind: "tool_permission"; decision: "deny" | "once" | "always"; approvalId: string }
  | { kind: "question_select"; questionId: string; optionIndex: number }
  | { kind: "question_toggle"; questionId: string; optionIndex: number }
  | { kind: "question_submit"; questionId: string }
  | { kind: "question_cancel"; questionId: string }
  | { kind: "memory_forget"; memoryId: string };

export function parseCommand(text: string): SupportedCommand | null {
  if (!text.startsWith("/")) {
    return null;
  }

  const token = text.trim().split(/\s+/, 1)[0] ?? "";
  const base = token.slice(1).split("@", 1)[0] ?? "";

  if (!COMMANDS.has(base)) {
    return null;
  }

  return base as SupportedCommand;
}

export function parseCallbackAction(data: string | undefined): CallbackAction | null {
  if (!data) {
    return null;
  }

  if (data.startsWith("command:")) {
    const command = data.slice("command:".length);

    if (command === "new" || command === "list" || command === "model" || command === "settings") {
      return { kind: "command", command };
    }

    return null;
  }

  if (data.startsWith("session_delete_confirm:")) {
    const sessionId = data.slice("session_delete_confirm:".length);
    return sessionId ? { kind: "session_delete_confirm", sessionId } : null;
  }

  if (data.startsWith("session_delete_cancel:")) {
    const sessionId = data.slice("session_delete_cancel:".length);
    return sessionId ? { kind: "session_delete_cancel", sessionId } : null;
  }

  if (data.startsWith("session_delete:")) {
    const sessionId = data.slice("session_delete:".length);
    return sessionId ? { kind: "session_delete", sessionId } : null;
  }

  if (data.startsWith("session_rename:")) {
    const sessionId = data.slice("session_rename:".length);
    return sessionId ? { kind: "session_rename", sessionId } : null;
  }

  if (data.startsWith("session_use:")) {
    const sessionId = data.slice("session_use:".length);
    return sessionId ? { kind: "session_use", sessionId } : null;
  }

  if (data.startsWith("session:")) {
    const sessionId = data.slice("session:".length);
    return sessionId ? { kind: "session_manage", sessionId } : null;
  }

  if (data.startsWith("model:")) {
    const modelId = data.slice("model:".length);
    return modelId ? { kind: "model", modelId } : null;
  }

  if (data === "settings") {
    return { kind: "settings" };
  }

  if (data === "settings_vision") {
    return { kind: "settings_vision" };
  }

  if (data === "settings_transcription") {
    return { kind: "settings_transcription" };
  }

  if (data.startsWith("settings_vision_set:")) {
    const modelId = data.slice("settings_vision_set:".length);
    return modelId ? { kind: "settings_vision_set", modelId } : null;
  }

  if (data === "settings_vision_clear") {
    return { kind: "settings_vision_clear" };
  }

  if (data.startsWith("settings_transcription_set:")) {
    const modelId = data.slice("settings_transcription_set:".length);
    return modelId ? { kind: "settings_transcription_set", modelId } : null;
  }

  if (data === "settings_transcription_clear") {
    return { kind: "settings_transcription_clear" };
  }

  if (data.startsWith("tpd:")) {
    const approvalId = data.slice("tpd:".length);
    return approvalId ? { kind: "tool_permission", decision: "deny", approvalId } : null;
  }

  if (data.startsWith("tpo:")) {
    const approvalId = data.slice("tpo:".length);
    return approvalId ? { kind: "tool_permission", decision: "once", approvalId } : null;
  }

  if (data.startsWith("tpa:")) {
    const approvalId = data.slice("tpa:".length);
    return approvalId ? { kind: "tool_permission", decision: "always", approvalId } : null;
  }

  if (data.startsWith("qsel:")) {
    const [questionId, optionIndex] = data.slice("qsel:".length).split(":");
    return questionId && optionIndex !== undefined && Number.isInteger(Number(optionIndex))
      ? { kind: "question_select", questionId, optionIndex: Number(optionIndex) }
      : null;
  }

  if (data.startsWith("qtog:")) {
    const [questionId, optionIndex] = data.slice("qtog:".length).split(":");
    return questionId && optionIndex !== undefined && Number.isInteger(Number(optionIndex))
      ? { kind: "question_toggle", questionId, optionIndex: Number(optionIndex) }
      : null;
  }

  if (data.startsWith("qsub:")) {
    const questionId = data.slice("qsub:".length);
    return questionId ? { kind: "question_submit", questionId } : null;
  }

  if (data.startsWith("qcan:")) {
    const questionId = data.slice("qcan:".length);
    return questionId ? { kind: "question_cancel", questionId } : null;
  }

  if (data.startsWith("mforget:")) {
    const memoryId = data.slice("mforget:".length);
    return memoryId ? { kind: "memory_forget", memoryId } : null;
  }

  return null;
}

export function createSessionTitle(now: Date): string {
  return `${formatSessionDate(now)} · New session`;
}

export function deriveSessionTitle(text: string, maxLength = 80): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized || "New session";
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

export function createFirstMessageSessionTitle(createdAt: string | Date, text: string, maxLength = 80): string {
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const prefix = `${formatSessionDate(date)} · `;
  const content = deriveSessionTitle(text, Math.max(1, maxLength - prefix.length));
  return `${prefix}${content}`;
}

export function normalizeManualSessionTitle(text: string, maxLength = 80): string {
  return deriveSessionTitle(text, maxLength);
}

export function getCommandArgument(text: string): string {
  const normalized = text.trim();
  const firstSpaceIndex = normalized.search(/\s/);

  if (firstSpaceIndex === -1) {
    return "";
  }

  return normalized.slice(firstSpaceIndex).trim();
}

function formatSessionDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
