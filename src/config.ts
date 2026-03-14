import { z } from "zod";

import { BUILTIN_MODEL_IDS, getModelSpec, type QualifiedModelId } from "./llm/catalog";
import type { EnvBindings } from "./types";

const DEFAULT_MODEL = "google:gemini-2.5-flash";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  ALLOWED_TELEGRAM_USER_ID: z.coerce.number().int().positive(),
  ALLOWED_CHAT_ID: z.string().optional().transform((value) => {
    if (!value || value.trim().length === 0) {
      return undefined;
    }

    return Number(value);
  }),
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
  SHOW_TOOL_STATUS_MESSAGES: z
    .enum(["0", "1", "false", "true"])
    .optional()
    .transform((value) => {
      if (!value) {
        return true;
      }

      return value === "1" || value === "true";
    }),
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
  defaultModel: QualifiedModelId;
  maxToolCallsPerRun: number;
  maxWebSearchesPerRun: number;
  maxWebFetchesPerRun: number;
  maxWebFetchBytes: number;
  showToolStatusMessages: boolean;
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

  return {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramWebhookSecret: parsed.TELEGRAM_WEBHOOK_SECRET,
    allowedTelegramUserId: parsed.ALLOWED_TELEGRAM_USER_ID,
    allowedChatId:
      typeof parsed.ALLOWED_CHAT_ID === "number" && Number.isFinite(parsed.ALLOWED_CHAT_ID)
        ? parsed.ALLOWED_CHAT_ID
        : undefined,
    googleApiKey: parsed.GOOGLE_GENERATIVE_AI_API_KEY,
    openAiApiKey: parsed.OPENAI_API_KEY,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
    openRouterApiKey: parsed.OPENROUTER_API_KEY,
    exaApiKey: parsed.EXA_API_KEY,
    allowedModels,
    defaultModel,
    maxToolCallsPerRun: parsed.MAX_TOOL_CALLS_PER_RUN ?? 8,
    maxWebSearchesPerRun: parsed.MAX_WEB_SEARCHES_PER_RUN ?? 2,
    maxWebFetchesPerRun: parsed.MAX_WEB_FETCHES_PER_RUN ?? 4,
    maxWebFetchBytes: parsed.MAX_WEB_FETCH_BYTES ?? 250_000,
    showToolStatusMessages: parsed.SHOW_TOOL_STATUS_MESSAGES,
  };
}
