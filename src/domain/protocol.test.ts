import { describe, expect, it } from "vitest";

import {
  createSessionTitle,
  deriveSessionTitle,
  parseCallbackAction,
  parseCommand,
} from "./protocol";

describe("parseCommand", () => {
  it("parses supported slash commands", () => {
    expect(parseCommand("/new")).toBe("new");
    expect(parseCommand("/model@grambot")).toBe("model");
    expect(parseCommand("/status")).toBe("status");
    expect(parseCommand("/analytics")).toBe("analytics");
    expect(parseCommand("hello")).toBeNull();
  });
});

describe("parseCallbackAction", () => {
  it("parses command actions", () => {
    expect(parseCallbackAction("command:list")).toEqual({
      kind: "command",
      command: "list",
    });
  });

  it("parses session and model actions", () => {
    expect(parseCallbackAction("session:abc")).toEqual({
      kind: "session",
      sessionId: "abc",
    });
    expect(parseCallbackAction("model:gemini-2.5-flash")).toEqual({
      kind: "model",
      modelId: "gemini-2.5-flash",
    });
  });
});

describe("session titles", () => {
  it("creates default timestamp titles", () => {
    expect(createSessionTitle(new Date("2026-03-09T12:34:56.000Z"))).toBe("Session 2026-03-09 12:34");
  });

  it("derives trimmed titles from first user messages", () => {
    expect(deriveSessionTitle("   hello    world   ")).toBe("hello world");
    expect(deriveSessionTitle("x".repeat(80))).toHaveLength(60);
  });
});
