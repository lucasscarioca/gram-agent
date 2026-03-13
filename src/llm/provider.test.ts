import { describe, expect, it } from "vitest";

import { getCachedInputTokens, type LlmUsage } from "./provider";

describe("getCachedInputTokens", () => {
  it("reads cached input from the AI SDK v6 canonical field", () => {
    const usage = {
      inputTokens: 1200,
      inputTokenDetails: {
        noCacheTokens: 900,
        cacheReadTokens: 300,
        cacheWriteTokens: undefined,
      },
      outputTokens: 100,
      outputTokenDetails: {
        textTokens: 100,
        reasoningTokens: undefined,
      },
      totalTokens: 1300,
    } satisfies LlmUsage;

    expect(getCachedInputTokens(usage)).toBe(300);
  });

  it("falls back to the deprecated alias when needed", () => {
    const usage = {
      inputTokens: 1200,
      inputTokenDetails: {
        noCacheTokens: 1200,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokens: 100,
      outputTokenDetails: {
        textTokens: 100,
        reasoningTokens: undefined,
      },
      totalTokens: 1300,
      cachedInputTokens: 250,
    } satisfies LlmUsage;

    expect(getCachedInputTokens(usage)).toBe(250);
  });
});
