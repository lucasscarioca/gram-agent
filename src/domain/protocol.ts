const COMMANDS = new Set(["help", "new", "list", "model"]);

export type SupportedCommand = "help" | "new" | "list" | "model";

export type CallbackAction =
  | { kind: "command"; command: Exclude<SupportedCommand, "help"> }
  | { kind: "session"; sessionId: string }
  | { kind: "model"; modelId: string };

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

    if (command === "new" || command === "list" || command === "model") {
      return { kind: "command", command };
    }

    return null;
  }

  if (data.startsWith("session:")) {
    const sessionId = data.slice("session:".length);
    return sessionId ? { kind: "session", sessionId } : null;
  }

  if (data.startsWith("model:")) {
    const modelId = data.slice("model:".length);
    return modelId ? { kind: "model", modelId } : null;
  }

  return null;
}

export function createSessionTitle(now: Date): string {
  const iso = now.toISOString().replace("T", " ");
  return `Session ${iso.slice(0, 16)}`;
}

export function deriveSessionTitle(text: string, maxLength = 60): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized || "New session";
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}
