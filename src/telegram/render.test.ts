import { describe, expect, it } from "vitest";

import { buildMemoryKeyboard, buildModelKeyboard, buildQuestionKeyboard, buildSessionKeyboard } from "./render";
import type { MemoryRow } from "../types";

function createMemory(index: number): MemoryRow {
  return {
    id: `mem-${index}`,
    user_id: 1,
    chat_id: 1,
    scope: "chat",
    kind: "note",
    content_text: `memory ${index}`,
    status: "active",
    source_session_id: null,
    created_at: "2026-03-15T00:00:00.000Z",
    updated_at: "2026-03-15T00:00:00.000Z",
    last_used_at: null,
  };
}

describe("memory keyboard", () => {
  it("builds one forget button per memory", () => {
    expect(buildMemoryKeyboard([createMemory(1), createMemory(2)])).toEqual([
      [{ text: "Forget 1", callback_data: "mforget:mem-1" }],
      [{ text: "Forget 2", callback_data: "mforget:mem-2" }],
    ]);
  });
});

describe("session keyboard", () => {
  it("marks the active session", () => {
    expect(
      buildSessionKeyboard(
        [
          {
            id: "session-1",
            title: "Active session",
          },
          {
            id: "session-2",
            title: "Older session",
          },
        ] as never,
        "session-1",
      ),
    ).toEqual([
      [{ text: "[current] Active session", callback_data: "session:session-1" }],
      [{ text: "Older session", callback_data: "session:session-2" }],
    ]);
  });
});

describe("model keyboard", () => {
  it("marks the current model", () => {
    expect(
      buildModelKeyboard(
        [
          { id: "google:gemini-2.5-flash", label: "Gemini Flash" },
          { id: "openai:gpt-5-mini", label: "GPT-5 Mini" },
        ] as never,
        "google:gemini-2.5-flash",
      ),
    ).toEqual([
      [{ text: "[current] Gemini Flash", callback_data: "model:google:gemini-2.5-flash" }],
      [{ text: "GPT-5 Mini", callback_data: "model:openai:gpt-5-mini" }],
    ]);
  });
});

describe("question keyboard", () => {
  it("renders single-select and multi-select controls", () => {
    expect(
      buildQuestionKeyboard({
        id: "q1",
        prompt: "Pick",
        kind: "single_select",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
        allowOther: false,
        minSelections: 1,
        maxSelections: 1,
        selectedIndexes: [],
        displayMessageId: null,
      }),
    ).toEqual([
      [{ text: "A", callback_data: "qsel:q1:0" }],
      [{ text: "B", callback_data: "qsel:q1:1" }],
      [{ text: "Cancel", callback_data: "qcan:q1" }],
    ]);

    expect(
      buildQuestionKeyboard({
        id: "q2",
        prompt: "Pick many",
        kind: "multi_select",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
        allowOther: false,
        minSelections: 1,
        maxSelections: 2,
        selectedIndexes: [1],
        displayMessageId: null,
      }),
    ).toEqual([
      [{ text: "[ ] A", callback_data: "qtog:q2:0" }],
      [{ text: "[x] B", callback_data: "qtog:q2:1" }],
      [{ text: "Submit", callback_data: "qsub:q2" }],
      [{ text: "Cancel", callback_data: "qcan:q2" }],
    ]);
  });
});
