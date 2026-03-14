import { describe, expect, it } from "vitest";

import {
  createFirstMessageSessionTitle,
  createSessionTitle,
  getCommandArgument,
  normalizeManualSessionTitle,
  parseCallbackAction,
  parseCommand,
} from "./protocol";

describe("parseCommand", () => {
  it("parses supported slash commands", () => {
    expect(parseCommand("/new")).toBe("new");
    expect(parseCommand("/model@grambot")).toBe("model");
    expect(parseCommand("/rename hello")).toBe("rename");
    expect(parseCommand("/delete")).toBe("delete");
    expect(parseCommand("/cancel")).toBe("cancel");
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
      kind: "session_manage",
      sessionId: "abc",
    });
    expect(parseCallbackAction("session_use:abc")).toEqual({
      kind: "session_use",
      sessionId: "abc",
    });
    expect(parseCallbackAction("session_rename:abc")).toEqual({
      kind: "session_rename",
      sessionId: "abc",
    });
    expect(parseCallbackAction("session_delete:abc")).toEqual({
      kind: "session_delete",
      sessionId: "abc",
    });
    expect(parseCallbackAction("session_delete_confirm:abc")).toEqual({
      kind: "session_delete_confirm",
      sessionId: "abc",
    });
    expect(parseCallbackAction("session_delete_cancel:abc")).toEqual({
      kind: "session_delete_cancel",
      sessionId: "abc",
    });
    expect(parseCallbackAction("model:gemini-2.5-flash")).toEqual({
      kind: "model",
      modelId: "gemini-2.5-flash",
    });
    expect(parseCallbackAction("tpd:perm1")).toEqual({
      kind: "tool_permission",
      decision: "deny",
      approvalId: "perm1",
    });
    expect(parseCallbackAction("tpo:perm1")).toEqual({
      kind: "tool_permission",
      decision: "once",
      approvalId: "perm1",
    });
    expect(parseCallbackAction("tpa:perm1")).toEqual({
      kind: "tool_permission",
      decision: "always",
      approvalId: "perm1",
    });
    expect(parseCallbackAction("qsel:q1:2")).toEqual({
      kind: "question_select",
      questionId: "q1",
      optionIndex: 2,
    });
    expect(parseCallbackAction("qtog:q1:1")).toEqual({
      kind: "question_toggle",
      questionId: "q1",
      optionIndex: 1,
    });
    expect(parseCallbackAction("qsub:q1")).toEqual({
      kind: "question_submit",
      questionId: "q1",
    });
    expect(parseCallbackAction("qcan:q1")).toEqual({
      kind: "question_cancel",
      questionId: "q1",
    });
  });
});

describe("session titles", () => {
  it("creates default timestamp titles", () => {
    expect(createSessionTitle(new Date("2026-03-09T12:34:56.000Z"))).toBe("Mar 9 · New session");
  });

  it("creates first-message titles with a date prefix", () => {
    expect(createFirstMessageSessionTitle("2026-03-09T12:34:56.000Z", "   hello    world   ")).toBe(
      "Mar 9 · hello world",
    );
  });

  it("normalizes manual titles and command arguments", () => {
    expect(normalizeManualSessionTitle("   hello    world   ")).toBe("hello world");
    expect(normalizeManualSessionTitle("x".repeat(120))).toHaveLength(80);
    expect(getCommandArgument("/rename   new title  ")).toBe("new title");
    expect(getCommandArgument("/rename")).toBe("");
  });
});
