import { z } from "zod";

import type { EnvBindings } from "./types";

const DEFAULT_ALLOWED_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"];
const DEFAULT_MODEL = "gemini-2.5-flash";

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
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
  DEFAULT_MODEL: z.string().optional(),
  ALLOWED_MODELS: z.string().optional(),
});

export interface AppConfig {
  telegramBotToken: string;
  telegramWebhookSecret: string;
  allowedTelegramUserId: number;
  allowedChatId?: number;
  googleApiKey: string;
  allowedModels: string[];
  defaultModel: string;
}

export function getConfig(env: EnvBindings): AppConfig {
  const parsed = envSchema.parse(env);
  const allowedModels =
    parsed.ALLOWED_MODELS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? DEFAULT_ALLOWED_MODELS;

  const defaultModel = parsed.DEFAULT_MODEL ?? allowedModels[0] ?? DEFAULT_MODEL;

  if (!allowedModels.includes(defaultModel)) {
    throw new Error("DEFAULT_MODEL must be included in ALLOWED_MODELS");
  }

  return {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramWebhookSecret: parsed.TELEGRAM_WEBHOOK_SECRET,
    allowedTelegramUserId: parsed.ALLOWED_TELEGRAM_USER_ID,
    allowedChatId:
      typeof parsed.ALLOWED_CHAT_ID === "number" && Number.isFinite(parsed.ALLOWED_CHAT_ID)
        ? parsed.ALLOWED_CHAT_ID
        : undefined,
    googleApiKey: parsed.GOOGLE_GENERATIVE_AI_API_KEY,
    allowedModels,
    defaultModel,
  };
}
