import type { ModelMessage } from "ai";

export type AgentToolName = "web_search" | "web_fetch" | "question" | "datetime";

export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface QuestionState {
  id: string;
  prompt: string;
  kind: "single_select" | "multi_select" | "free_text" | "confirm";
  options: QuestionOption[];
  allowOther: boolean;
  minSelections: number;
  maxSelections: number;
  submitLabel?: string;
  cancelLabel?: string;
  selectedIndexes: number[];
  displayMessageId: number | null;
}

export interface QuestionAnswer {
  prompt: string;
  kind: QuestionState["kind"];
  values: string[];
  labels: string[];
  freeText?: string;
  confirmed?: boolean;
}

export interface PendingApprovalRequest {
  approvalId: string;
  toolCallId: string;
  toolName: "web_search" | "web_fetch";
  scopeType: "domain" | "provider";
  scopeValue: string;
  title: string;
  summary: string;
}

export interface AgentRunState {
  messages: ModelMessage[];
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  domain: string;
}

export interface WebSearchResult {
  query: string;
  results: WebSearchResultItem[];
}

export interface WebFetchResult {
  url: string;
  finalUrl: string;
  domain: string;
  contentType: string;
  title?: string;
  description?: string;
  excerpt: string;
  truncated: boolean;
}

export interface ToolDisplayText {
  pending: string;
  complete: string;
  denied?: string;
  failed?: string;
}
