import { describe, expect, it } from "vitest";

import { estimateCostUsd, getContextWindowTokens, getModelSpec, parseQualifiedModelId } from "./catalog";

describe("catalog", () => {
  it("parses qualified model ids", () => {
    expect(parseQualifiedModelId("openrouter:openai/gpt-oss-120b")).toEqual({
      provider: "openrouter",
      modelId: "openai/gpt-oss-120b",
      qualified: "openrouter:openai/gpt-oss-120b",
    });
    expect(parseQualifiedModelId("bad")).toBeNull();
  });

  it("returns model specs for curated models", () => {
    expect(getModelSpec("openai:gpt-5.1")?.modelId).toBe("gpt-5.1");
    expect(getModelSpec("openai:not-real")).toBeNull();
  });

  it("estimates cost with cached input tokens", () => {
    expect(
      estimateCostUsd({
        modelId: "openai:gpt-5.1",
        inputTokens: 1_000_000,
        cachedInputTokens: 200_000,
        outputTokens: 500_000,
      }),
    ).toBe(6.025);
  });

  it("resolves context windows with fallback support", () => {
    expect(getContextWindowTokens("openai:gpt-5.1", 290_000)).toBe(400_000);
    expect(getContextWindowTokens("openai:not-real", 290_000)).toBe(290_000);
  });
});
