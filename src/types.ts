export interface EnvBindings {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ALLOWED_TELEGRAM_USER_ID: string;
  ALLOWED_CHAT_ID?: string;
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  DEFAULT_MODEL?: string;
  ALLOWED_MODELS?: string;
}

export interface ChatRow {
  chat_id: number;
  user_id: number;
  active_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  chat_id: number;
  user_id: number;
  title: string;
  selected_model: string;
  created_at: string;
  last_message_at: string;
}

export interface MessageRow {
  id: string;
  session_id: string;
  chat_id: number;
  telegram_message_id: number | null;
  role: "user" | "assistant" | "system";
  content_text: string;
  created_at: string;
}

export interface RunRow {
  id: string;
  session_id: string;
  update_id: number;
  provider: string;
  model: string;
  status: "started" | "completed" | "failed";
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

export interface TelegramUser {
  id: number;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
}
