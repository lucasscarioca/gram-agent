import type { ModelMessage } from "ai";

import type { MemoryRow } from "../types";

const PERSISTENT_MEMORY_LABEL = "Persistent memory";
const DEFAULT_MAX_MEMORY_ITEMS = 10;
const DEFAULT_MAX_MEMORY_TOKENS = 1_500;

export function buildPersistentMemoryMessage(input: {
  memories: MemoryRow[];
  maxItems?: number;
  maxTokens?: number;
  estimateTokens?: (value: string) => number;
}): ModelMessage | null {
  const estimateTokens = input.estimateTokens ?? estimateTextTokens;
  const selected = selectMemoriesWithinBudget({
    memories: input.memories,
    maxItems: input.maxItems ?? DEFAULT_MAX_MEMORY_ITEMS,
    maxTokens: input.maxTokens ?? DEFAULT_MAX_MEMORY_TOKENS,
    estimateTokens,
  });

  if (selected.length === 0) {
    return null;
  }

  return {
    role: "system",
    content: `${PERSISTENT_MEMORY_LABEL}:\n${selected.map((memory) => `- ${memory.content_text.trim()}`).join("\n")}`,
  } as ModelMessage;
}

export function selectMemoriesWithinBudget(input: {
  memories: MemoryRow[];
  maxItems: number;
  maxTokens: number;
  estimateTokens: (value: string) => number;
}): MemoryRow[] {
  const selected: MemoryRow[] = [];
  let total = input.estimateTokens(`${PERSISTENT_MEMORY_LABEL}:\n`);

  for (const memory of input.memories) {
    if (selected.length >= input.maxItems) {
      break;
    }

    const content = memory.content_text.trim();

    if (!content) {
      continue;
    }

    const memoryTokens = input.estimateTokens(`- ${content}`);

    if (selected.length > 0 && total + memoryTokens > input.maxTokens) {
      break;
    }

    selected.push(memory);
    total += memoryTokens;
  }

  return selected;
}

function estimateTextTokens(value: string): number {
  const normalized = value.trim();

  if (normalized.length === 0) {
    return 0;
  }

  return Math.ceil(normalized.length / 3.5) + 12;
}
