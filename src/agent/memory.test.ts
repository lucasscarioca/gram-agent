import { describe, expect, it } from "vitest";

import { buildPersistentMemoryMessage, selectMemoriesWithinBudget } from "./memory";
import type { MemoryRow } from "../types";

function createMemory(index: number, content = `memory ${index}`): MemoryRow {
  return {
    id: `mem-${index}`,
    user_id: 1,
    chat_id: 1,
    scope: "chat",
    kind: "note",
    content_text: content,
    status: "active",
    source_session_id: null,
    created_at: "2026-03-15T00:00:00.000Z",
    updated_at: "2026-03-15T00:00:00.000Z",
    last_used_at: null,
  };
}

describe("persistent memory", () => {
  it("returns null when there are no memories", () => {
    expect(buildPersistentMemoryMessage({ memories: [] })).toBeNull();
  });

  it("builds a system message from selected memories", () => {
    expect(buildPersistentMemoryMessage({ memories: [createMemory(1, "use pnpm"), createMemory(2, "prefer concise replies")] }))
      .toMatchObject({
        role: "system",
      });
    expect(buildPersistentMemoryMessage({ memories: [createMemory(1, "use pnpm")] })?.content).toContain(
      "Persistent memory:\n- use pnpm",
    );
  });

  it("respects item and token budgets", () => {
    expect(
      selectMemoriesWithinBudget({
        memories: [createMemory(1, "short"), createMemory(2, "another short"), createMemory(3, "third")],
        maxItems: 2,
        maxTokens: 1_000,
        estimateTokens: (value) => value.length,
      }),
    ).toHaveLength(2);

    expect(
      selectMemoriesWithinBudget({
        memories: [createMemory(1, "1234567890"), createMemory(2, "1234567890")],
        maxItems: 10,
        maxTokens: 40,
        estimateTokens: (value) => value.length,
      }),
    ).toHaveLength(1);
  });
});
