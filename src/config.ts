import { z } from "zod";

import {
  BUILTIN_MODEL_IDS,
  BUILTIN_TRANSCRIPTION_MODEL_IDS,
  getModelSpec,
  getTranscriptionModelSpec,
  type QualifiedModelId,
  type QualifiedTranscriptionModelId,
} from "./llm/catalog";
import type { EnvBindings } from "./types";

const DEFAULT_MODEL = "google:gemini-2.5-flash";
const DEFAULT_CONTEXT_WINDOW_TOKENS = 290_000;
const DEFAULT_CONTEXT_RESERVE_TOKENS = 24_000;
const DEFAULT_CONTEXT_WARN_THRESHOLD = 0.72;
const DEFAULT_CONTEXT_COMPACT_THRESHOLD = 0.86;

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return value === "1" || value === "true";
}

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  ALLOWED_TELEGRAM_USER_ID: z.coerce.number().int().positive(),
  ALLOWED_CHAT_ID: z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }, z.coerce.number().int().optional()),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  EXA_API_KEY: z.string().min(1).optional(),
  DEFAULT_MODEL: z.string().optional(),
  ALLOWED_MODELS: z.string().optional(),
  MAX_TOOL_CALLS_PER_RUN: z.coerce.number().int().positive().optional(),
  MAX_WEB_SEARCHES_PER_RUN: z.coerce.number().int().positive().optional(),
  MAX_WEB_FETCHES_PER_RUN: z.coerce.number().int().positive().optional(),
  MAX_WEB_FETCH_BYTES: z.coerce.number().int().positive().optional(),
  DEFAULT_CONTEXT_WINDOW_TOKENS: z.coerce.number().int().positive().optional(),
  CONTEXT_RESERVE_TOKENS: z.coerce.number().int().positive().optional(),
  CONTEXT_WARN_THRESHOLD: z.coerce.number().positive().max(1).optional(),
  CONTEXT_COMPACT_THRESHOLD: z.coerce.number().positive().max(1).optional(),
  SHOW_TOOL_STATUS_MESSAGES: z.enum(["0", "1", "false", "true"]).optional(),
  ADMIN_ENABLED: z.enum(["0", "1", "false", "true"]).optional(),
  ADMIN_BASE_URL: z.string().url().optional(),
  TEAM_DOMAIN: z.string().url().optional(),
  POLICY_AUD: z.string().min(1).optional(),
});

export interface AppConfig {
  telegramBotToken: string;
  telegramWebhookSecret: string;
  allowedTelegramUserId: number;
  allowedChatId?: number;
  googleApiKey?: string;
  openAiApiKey?: string;
  anthropicApiKey?: string;
  openRouterApiKey?: string;
  exaApiKey?: string;
  allowedModels: QualifiedModelId[];
  allowedTranscriptionModels: QualifiedTranscriptionModelId[];
  defaultModel: QualifiedModelId;
  maxToolCallsPerRun: number;
  maxWebSearchesPerRun: number;
  maxWebFetchesPerRun: number;
  maxWebFetchBytes: number;
  defaultContextWindowTokens: number;
  contextReserveTokens: number;
  contextWarnThreshold: number;
  contextCompactThreshold: number;
  showToolStatusMessages: boolean;
  adminEnabled: boolean;
  adminBaseUrl?: string;
  teamDomain?: string;
  policyAud?: string;
}

export function getConfig(env: EnvBindings): AppConfig {
  const parsed = envSchema.parse(env);
  const availableProviders = {
    google: Boolean(parsed.GOOGLE_GENERATIVE_AI_API_KEY),
    openai: Boolean(parsed.OPENAI_API_KEY),
    anthropic: Boolean(parsed.ANTHROPIC_API_KEY),
    openrouter: Boolean(parsed.OPENROUTER_API_KEY),
  } as const;

  const configuredModels =
    parsed.ALLOWED_MODELS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? BUILTIN_MODEL_IDS;

  const knownModels = configuredModels.map((modelId) => {
    const spec = getModelSpec(modelId);

    if (!spec) {
      throw new Error(`Unknown model in ALLOWED_MODELS: ${modelId}`);
    }

    return spec;
  });

  const allowedModels = knownModels
    .filter((model) => availableProviders[model.provider])
    .map((model) => model.id);
  const allowedTranscriptionModels = BUILTIN_TRANSCRIPTION_MODEL_IDS.filter((modelId) => {
    const spec = getTranscriptionModelSpec(modelId);
    return spec ? availableProviders[spec.provider] : false;
  });

  if (allowedModels.length === 0) {
    throw new Error("No allowed models remain after filtering unconfigured providers");
  }

  const configuredDefault = parsed.DEFAULT_MODEL ?? DEFAULT_MODEL;
  const defaultSpec = getModelSpec(configuredDefault);

  if (!defaultSpec) {
    throw new Error(`Unknown DEFAULT_MODEL: ${configuredDefault}`);
  }

  const defaultModel = allowedModels.includes(defaultSpec.id)
    ? defaultSpec.id
    : (allowedModels[0] ?? DEFAULT_MODEL);
  const contextWarnThreshold = parsed.CONTEXT_WARN_THRESHOLD ?? DEFAULT_CONTEXT_WARN_THRESHOLD;
  const contextCompactThreshold = parsed.CONTEXT_COMPACT_THRESHOLD ?? DEFAULT_CONTEXT_COMPACT_THRESHOLD;

  if (contextCompactThreshold <= contextWarnThreshold) {
    throw new Error("CONTEXT_COMPACT_THRESHOLD must be greater than CONTEXT_WARN_THRESHOLD");
  }

  return {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramWebhookSecret: parsed.TELEGRAM_WEBHOOK_SECRET,
    allowedTelegramUserId: parsed.ALLOWED_TELEGRAM_USER_ID,
    allowedChatId: parsed.ALLOWED_CHAT_ID,
    googleApiKey: parsed.GOOGLE_GENERATIVE_AI_API_KEY,
    openAiApiKey: parsed.OPENAI_API_KEY,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
    openRouterApiKey: parsed.OPENROUTER_API_KEY,
    exaApiKey: parsed.EXA_API_KEY,
    allowedModels,
    allowedTranscriptionModels,
    defaultModel,
    maxToolCallsPerRun: parsed.MAX_TOOL_CALLS_PER_RUN ?? 8,
    maxWebSearchesPerRun: parsed.MAX_WEB_SEARCHES_PER_RUN ?? 2,
    maxWebFetchesPerRun: parsed.MAX_WEB_FETCHES_PER_RUN ?? 4,
    maxWebFetchBytes: parsed.MAX_WEB_FETCH_BYTES ?? 250_000,
    defaultContextWindowTokens: parsed.DEFAULT_CONTEXT_WINDOW_TOKENS ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
    contextReserveTokens: parsed.CONTEXT_RESERVE_TOKENS ?? DEFAULT_CONTEXT_RESERVE_TOKENS,
    contextWarnThreshold,
    contextCompactThreshold,
    showToolStatusMessages: parseBooleanFlag(parsed.SHOW_TOOL_STATUS_MESSAGES, true),
    adminEnabled: parseBooleanFlag(parsed.ADMIN_ENABLED, false),
    adminBaseUrl: parsed.ADMIN_BASE_URL,
    teamDomain: parsed.TEAM_DOMAIN,
    policyAud: parsed.POLICY_AUD,
  };
}
