export type ProviderId = "google" | "openai" | "anthropic" | "openrouter";

export type QualifiedModelId =
  | `google:${string}`
  | `openai:${string}`
  | `anthropic:${string}`
  | `openrouter:${string}`;

export interface ModelPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cachedInputPerMillionUsd?: number;
}

export interface ModelSpec {
  id: QualifiedModelId;
  provider: ProviderId;
  modelId: string;
  label: string;
  pricing: ModelPricing;
}

const MODEL_SPECS = [
  {
    id: "google:gemini-2.5-flash",
    provider: "google",
    modelId: "gemini-2.5-flash",
    label: "Google / Gemini 2.5 Flash",
    pricing: {
      inputPerMillionUsd: 0.3,
      cachedInputPerMillionUsd: 0.075,
      outputPerMillionUsd: 2.5,
    },
  },
  {
    id: "google:gemini-2.5-pro",
    provider: "google",
    modelId: "gemini-2.5-pro",
    label: "Google / Gemini 2.5 Pro",
    pricing: {
      inputPerMillionUsd: 1.25,
      cachedInputPerMillionUsd: 0.3125,
      outputPerMillionUsd: 10,
    },
  },
  {
    id: "google:gemini-3-flash-preview",
    provider: "google",
    modelId: "gemini-3-flash-preview",
    label: "Google / Gemini 3 Flash Preview",
    pricing: {
      inputPerMillionUsd: 0.3,
      cachedInputPerMillionUsd: 0.075,
      outputPerMillionUsd: 2.5,
    },
  },
  {
    id: "google:gemini-3-pro-preview",
    provider: "google",
    modelId: "gemini-3-pro-preview",
    label: "Google / Gemini 3 Pro Preview",
    pricing: {
      inputPerMillionUsd: 1.25,
      cachedInputPerMillionUsd: 0.3125,
      outputPerMillionUsd: 10,
    },
  },
  {
    id: "openai:gpt-5.1",
    provider: "openai",
    modelId: "gpt-5.1",
    label: "OpenAI / GPT-5.1",
    pricing: {
      inputPerMillionUsd: 1.25,
      cachedInputPerMillionUsd: 0.125,
      outputPerMillionUsd: 10,
    },
  },
  {
    id: "openai:gpt-5-mini",
    provider: "openai",
    modelId: "gpt-5-mini",
    label: "OpenAI / GPT-5 Mini",
    pricing: {
      inputPerMillionUsd: 0.25,
      cachedInputPerMillionUsd: 0.025,
      outputPerMillionUsd: 2,
    },
  },
  {
    id: "openai:gpt-5-nano",
    provider: "openai",
    modelId: "gpt-5-nano",
    label: "OpenAI / GPT-5 Nano",
    pricing: {
      inputPerMillionUsd: 0.05,
      cachedInputPerMillionUsd: 0.005,
      outputPerMillionUsd: 0.4,
    },
  },
  {
    id: "anthropic:claude-opus-4-6",
    provider: "anthropic",
    modelId: "claude-opus-4-6",
    label: "Anthropic / Claude Opus 4.6",
    pricing: {
      inputPerMillionUsd: 15,
      cachedInputPerMillionUsd: 1.5,
      outputPerMillionUsd: 75,
    },
  },
  {
    id: "anthropic:claude-sonnet-4-5",
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    label: "Anthropic / Claude Sonnet 4.5",
    pricing: {
      inputPerMillionUsd: 3,
      cachedInputPerMillionUsd: 0.3,
      outputPerMillionUsd: 15,
    },
  },
  {
    id: "anthropic:claude-haiku-4-5",
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
    label: "Anthropic / Claude Haiku 4.5",
    pricing: {
      inputPerMillionUsd: 1,
      cachedInputPerMillionUsd: 0.1,
      outputPerMillionUsd: 5,
    },
  },
  {
    id: "openrouter:minimax/minimax-m2.5",
    provider: "openrouter",
    modelId: "minimax/minimax-m2.5",
    label: "OpenRouter / MiniMax M2.5",
    pricing: {
      inputPerMillionUsd: 0.38,
      outputPerMillionUsd: 1.2,
    },
  },
  {
    id: "openrouter:moonshotai/kimi-k2.5",
    provider: "openrouter",
    modelId: "moonshotai/kimi-k2.5",
    label: "OpenRouter / Kimi K2.5",
    pricing: {
      inputPerMillionUsd: 0.6,
      outputPerMillionUsd: 2.5,
    },
  },
  {
    id: "openrouter:z-ai/glm-5",
    provider: "openrouter",
    modelId: "z-ai/glm-5",
    label: "OpenRouter / GLM 5",
    pricing: {
      inputPerMillionUsd: 0.3,
      outputPerMillionUsd: 1.2,
    },
  },
  {
    id: "openrouter:openai/gpt-oss-120b",
    provider: "openrouter",
    modelId: "openai/gpt-oss-120b",
    label: "OpenRouter / gpt-oss-120b",
    pricing: {
      inputPerMillionUsd: 0.15,
      outputPerMillionUsd: 0.6,
    },
  },
] as const satisfies readonly ModelSpec[];

const MODEL_SPEC_MAP = new Map<QualifiedModelId, ModelSpec>(
  MODEL_SPECS.map((model) => [model.id, model]),
);

export const BUILTIN_MODEL_IDS = MODEL_SPECS.map((model) => model.id);

export function parseQualifiedModelId(value: string): {
  provider: ProviderId;
  modelId: string;
  qualified: QualifiedModelId;
} | null {
  const separator = value.indexOf(":");

  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }

  const provider = value.slice(0, separator);
  const modelId = value.slice(separator + 1);

  if (
    provider !== "google" &&
    provider !== "openai" &&
    provider !== "anthropic" &&
    provider !== "openrouter"
  ) {
    return null;
  }

  return {
    provider,
    modelId,
    qualified: value as QualifiedModelId,
  };
}

export function getModelSpec(modelId: string): ModelSpec | null {
  const parsed = parseQualifiedModelId(modelId);

  if (!parsed) {
    return null;
  }

  return MODEL_SPEC_MAP.get(parsed.qualified) ?? null;
}

export function getModelSpecs(modelIds: readonly string[]): ModelSpec[] {
  return modelIds
    .map((modelId) => getModelSpec(modelId))
    .filter((model): model is ModelSpec => model !== null);
}

export function estimateCostUsd(input: {
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}): number | null {
  const spec = getModelSpec(input.modelId);

  if (!spec) {
    return null;
  }

  const inputTokens = input.inputTokens ?? 0;
  const cachedInputTokens = input.cachedInputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const uncachedInputTokens = Math.max(inputTokens - cachedInputTokens, 0);

  if (input.inputTokens == null && input.outputTokens == null && input.cachedInputTokens == null) {
    return null;
  }

  const inputCost = (uncachedInputTokens / 1_000_000) * spec.pricing.inputPerMillionUsd;
  const cachedCost =
    (cachedInputTokens / 1_000_000) * (spec.pricing.cachedInputPerMillionUsd ?? spec.pricing.inputPerMillionUsd);
  const outputCost = (outputTokens / 1_000_000) * spec.pricing.outputPerMillionUsd;

  return roundUsd(inputCost + cachedCost + outputCost);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
