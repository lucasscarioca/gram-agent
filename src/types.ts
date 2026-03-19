export interface EnvBindings {
  DB: D1Database;
  ASSETS: Fetcher;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ALLOWED_TELEGRAM_USER_ID: string;
  ALLOWED_CHAT_ID?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  EXA_API_KEY?: string;
  DEFAULT_MODEL?: string;
  ALLOWED_MODELS?: string;
  MAX_TOOL_CALLS_PER_RUN?: string;
  MAX_WEB_SEARCHES_PER_RUN?: string;
  MAX_WEB_FETCHES_PER_RUN?: string;
  MAX_WEB_FETCH_BYTES?: string;
  DEFAULT_CONTEXT_WINDOW_TOKENS?: string;
  CONTEXT_RESERVE_TOKENS?: string;
  CONTEXT_WARN_THRESHOLD?: string;
  CONTEXT_COMPACT_THRESHOLD?: string;
  SHOW_TOOL_STATUS_MESSAGES?: string;
  ADMIN_ENABLED?: string;
  ADMIN_BASE_URL?: string;
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
}

export interface ChatRow {
  chat_id: number;
  user_id: number;
  active_session_id: string | null;
  default_vision_model: string | null;
  default_transcription_model: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredMessageContent {
  kind: "text" | "image" | "audio" | "file" | "pdf";
  source: "user" | "assistant" | "system";
  telegram?: {
    file_id?: string;
    file_unique_id?: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
    caption?: string;
  };
  processing?: {
    status: "completed" | "failed" | "skipped";
    method:
      | "plain_text"
      | "vision_model"
      | "transcription"
      | "text_extract"
      | "unsupported";
    warning?: string;
  };
  derived_text?: string;
}

export interface SessionRow {
  id: string;
  chat_id: number;
  user_id: number;
  title: string;
  title_source: "default" | "first_message" | "auto" | "manual";
  title_updated_at: string;
  last_auto_title_message_count: number;
  selected_model: string;
  compacted_summary: string | null;
  compacted_at: string | null;
  last_compacted_message_id: string | null;
  last_context_warning_at: string | null;
  created_at: string;
  last_message_at: string;
}

export interface PendingChatActionRow {
  chat_id: number;
  action: "rename_session";
  session_id: string;
  created_at: string;
}

export interface MessageRow {
  id: string;
  session_id: string;
  chat_id: number;
  telegram_message_id: number | null;
  role: "user" | "assistant" | "system";
  content_text: string;
  content_json?: string | null;
  created_at: string;
}

export interface MemoryRow {
  id: string;
  user_id: number;
  chat_id: number;
  scope: "user" | "chat";
  kind: "note" | "preference" | "constraint" | "profile" | "project" | "fact";
  content_text: string;
  status: "active" | "archived";
  source_session_id: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface AgentRunRow {
  run_id: string;
  session_id: string;
  chat_id: number;
  reply_to_message_id: number;
  status: "started" | "waiting_permission" | "waiting_question" | "completed" | "failed";
  model: string;
  provider: string;
  messages_json: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ToolCallRow {
  id: string;
  run_id: string;
  tool_name: "web_search" | "web_fetch" | "question" | "datetime";
  status: "started" | "waiting_permission" | "waiting_user" | "completed" | "failed";
  input_json: string;
  output_json: string | null;
  summary_text: string | null;
  display_message_id: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolPermissionRow {
  id: string;
  chat_id: number;
  tool_name: "web_search" | "web_fetch";
  scope_type: "domain" | "provider";
  scope_value: string;
  decision: "allow";
  created_at: string;
  updated_at: string;
}

export interface PendingToolApprovalRow {
  id: string;
  run_id: string;
  tool_call_id: string;
  chat_id: number;
  tool_name: "web_search" | "web_fetch";
  scope_type: "domain" | "provider";
  scope_value: string;
  request_json: string;
  created_at: string;
}

export interface PendingQuestionRow {
  id: string;
  run_id: string;
  tool_call_id: string;
  chat_id: number;
  question_kind: "single_select" | "multi_select" | "free_text" | "confirm";
  question_json: string;
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
  cached_input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  created_at: string;
}

export interface UsageTotalsRow {
  run_count: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export interface GroupedUsageRow {
  key: string;
  run_count: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export interface DailyUsageRow {
  day: string;
  run_count: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export interface SessionListItem {
  id: string;
  title: string;
  title_source: SessionRow["title_source"];
  selected_model: string;
  created_at: string;
  last_message_at: string;
  message_count: number;
  run_count: number;
  failed_run_count: number;
  estimated_cost_usd: number;
  compacted_at: string | null;
  compacted_summary: string | null;
  is_active: boolean;
}

export interface RunListItem {
  id: string;
  session_id: string;
  session_title: string;
  provider: string;
  model: string;
  status: RunRow["status"];
  error: string | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  created_at: string;
  agent_status: AgentRunRow["status"] | null;
  agent_last_error: string | null;
}

export interface PendingApprovalListItem extends PendingToolApprovalRow {
  session_id: string;
  session_title: string;
  run_created_at: string;
}

export interface PendingQuestionListItem extends PendingQuestionRow {
  session_id: string;
  session_title: string;
  run_created_at: string;
}

export interface ToolCallListItem extends ToolCallRow {
  run_created_at: string;
}

export interface ToolPermissionListItem extends ToolPermissionRow {
  session_count?: number;
}

export interface OverviewSnapshot {
  today: UsageTotalsRow;
  seven_days: UsageTotalsRow;
  thirty_days: UsageTotalsRow;
  all_time: UsageTotalsRow;
  top_providers_30d: GroupedUsageRow[];
  top_models_30d: GroupedUsageRow[];
  daily_usage_14d: DailyUsageRow[];
  recent_failures: RunListItem[];
  pending_approvals: number;
  pending_questions: number;
  active_memories: number;
  recent_sessions: SessionListItem[];
}

export interface SessionDetail {
  session: SessionRow;
  usage: UsageTotalsRow;
  messages: MessageRow[];
  recent_runs: RunListItem[];
  tool_calls: ToolCallListItem[];
  message_count: number;
}

export interface RunDetail {
  run: RunListItem;
  agent_run: AgentRunRow | null;
  tool_calls: ToolCallRow[];
  pending_approvals: PendingToolApprovalRow[];
  pending_questions: PendingQuestionRow[];
}

export interface AdminBootstrap {
  app_name: string;
  admin_enabled: boolean;
  admin_base_url: string | null;
  authenticated_email: string | null;
  pending_approvals: number;
  pending_questions: number;
  allowed_models: string[];
  vision_model_options: string[];
  transcription_model_options: string[];
}

export interface ChatSettingsPayload {
  chat_id: number;
  default_vision_model: string | null;
  default_transcription_model: string | null;
}

export interface TelegramUser {
  id: number;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramFileRef {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
}

export interface TelegramPhotoSize extends TelegramFileRef {
  width: number;
  height: number;
}

export interface TelegramAudio extends TelegramFileRef {
  duration: number;
  file_name?: string;
  mime_type?: string;
}

export interface TelegramVoice extends TelegramFileRef {
  duration: number;
  mime_type?: string;
}

export interface TelegramDocument extends TelegramFileRef {
  file_name?: string;
  mime_type?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  audio?: TelegramAudio;
  voice?: TelegramVoice;
  document?: TelegramDocument;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
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
