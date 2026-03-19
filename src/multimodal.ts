import { experimental_transcribe as transcribe, generateText, type ModelMessage } from "ai";

import {
  getModelSpec,
  getTranscriptionModelSpec,
  type TranscriptionModelSpec,
  type QualifiedModelId,
  type QualifiedTranscriptionModelId,
} from "./llm/catalog";
import type { LlmRegistry } from "./llm/registry";
import type { TelegramClient } from "./telegram/client";
import type { ChatRow, SessionRow, StoredMessageContent, TelegramDocument, TelegramMessage } from "./types";

const IMAGE_ANALYSIS_PROMPT = [
  "Interpret this user image for a text-only chat agent.",
  "Extract the details that matter for answering the user next.",
  "If visible text exists, include it.",
  "Be explicit when something is uncertain.",
  "Keep the result concise but information-dense.",
].join(" ");

const AUDIO_TRANSCRIPTION_PROMPT = [
  "Transcribe this audio for a text-only chat agent.",
  "Return only the transcript.",
  "Do not summarize or explain.",
  "If parts are unclear, mark them as [unclear].",
].join(" ");

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_EXTRACT_BYTES = 2 * 1024 * 1024;

export interface PreparedUserInput {
  contentText: string;
  contentJson: string;
}

export async function prepareTelegramUserInput(input: {
  message: TelegramMessage;
  session: SessionRow;
  chat: ChatRow;
  telegram: TelegramClient;
  llm: LlmRegistry;
}): Promise<PreparedUserInput | { errorMessage: string }> {
  if (input.message.text) {
    return buildPreparedInput({
      kind: "text",
      messageText: input.message.text,
      content: {
        kind: "text",
        source: "user",
        processing: { status: "completed", method: "plain_text" },
        derived_text: input.message.text,
      },
    });
  }

  if (input.message.photo?.length) {
    return prepareImageInput(input);
  }

  if (input.message.voice || input.message.audio) {
    return prepareAudioInput(input);
  }

  if (input.message.document) {
    return prepareDocumentInput(input);
  }

  return {
    errorMessage: "Unsupported message type for now. Send text, photo, voice, audio, or document.",
  };
}

export function buildUserModelMessage(input: PreparedUserInput): ModelMessage {
  return {
    role: "user",
    content: input.contentText,
  } as ModelMessage;
}

function buildPreparedInput(input: {
  kind: StoredMessageContent["kind"];
  messageText: string;
  content: StoredMessageContent;
}): PreparedUserInput {
  return {
    contentText: input.messageText,
    contentJson: JSON.stringify(input.content),
  };
}

async function prepareImageInput(input: {
  message: TelegramMessage;
  session: SessionRow;
  chat: ChatRow;
  telegram: TelegramClient;
  llm: LlmRegistry;
}): Promise<PreparedUserInput | { errorMessage: string }> {
  const photo = input.message.photo?.[input.message.photo.length - 1];

  if (!photo) {
    return { errorMessage: "Could not read the image payload." };
  }

  const analysisModelId = getModelSpec(input.session.selected_model)?.supportsVisionInput
    ? input.session.selected_model
    : input.chat.default_vision_model;

  if (!analysisModelId) {
    return {
      errorMessage: "Vision not enabled. Configure a default vision model in /settings or the admin dashboard.",
    };
  }

  const file = await input.telegram.getFile(photo.file_id);

  if (!file.file_path) {
    return { errorMessage: "Telegram did not provide an image download path." };
  }

  if ((file.file_size ?? photo.file_size ?? 0) > MAX_DOWNLOAD_BYTES) {
    return { errorMessage: "Image is too large to process." };
  }

  const download = await input.telegram.downloadFile(file.file_path);
  const derivedText = (
    await generateText({
      model: input.llm.getModel(analysisModelId as QualifiedModelId),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: IMAGE_ANALYSIS_PROMPT },
            { type: "image", image: download.data, mediaType: download.mediaType ?? "image/jpeg" },
          ],
        },
      ],
    })
  ).text.trim();

  const messageText = formatImageDerivedText({
    derivedText,
    caption: input.message.caption,
    modelId: analysisModelId,
    usedActiveModel: analysisModelId === input.session.selected_model,
  });

  return buildPreparedInput({
    kind: "image",
    messageText,
    content: {
      kind: "image",
      source: "user",
      telegram: {
        file_id: photo.file_id,
        file_unique_id: photo.file_unique_id,
        file_size: photo.file_size,
        caption: input.message.caption,
      },
      processing: {
        status: "completed",
        method: "vision_model",
      },
      derived_text: messageText,
    },
  });
}

async function prepareAudioInput(input: {
  message: TelegramMessage;
  chat: ChatRow;
  telegram: TelegramClient;
  llm: LlmRegistry;
}): Promise<PreparedUserInput | { errorMessage: string }> {
  const source = input.message.voice ?? input.message.audio;
  const fileName = input.message.audio?.file_name;

  if (!source) {
    return { errorMessage: "Could not read the audio payload." };
  }

  const modelId = input.chat.default_transcription_model;

  if (!modelId) {
    return {
      errorMessage: "Audio transcription not enabled. Configure a default transcription model in /settings or the admin dashboard.",
    };
  }

  const modelSpec = getTranscriptionModelSpec(modelId);

  if (!modelSpec) {
    return { errorMessage: "Configured transcription model is invalid. Update it in /settings." };
  }

  const file = await input.telegram.getFile(source.file_id);

  if (!file.file_path) {
    return { errorMessage: "Telegram did not provide an audio download path." };
  }

  if ((file.file_size ?? source.file_size ?? 0) > MAX_DOWNLOAD_BYTES) {
    return { errorMessage: "Audio file is too large to process." };
  }

  const download = await input.telegram.downloadFile(file.file_path);
  const transcript = await transcribeAudio({
    model: modelSpec,
    audio: download.data,
    audioMediaType: resolveAudioMediaType({
      fileName,
      sourceMimeType: source.mime_type,
      downloadMediaType: download.mediaType,
    }),
    fileName,
    llm: input.llm,
  });

  if (!transcript) {
    return { errorMessage: "I could not transcribe that audio." };
  }

  const messageText = [
    "User sent an audio message.",
    "The following is an automatic transcription and may contain recognition errors:",
    transcript,
  ].join("\n\n");

  return buildPreparedInput({
    kind: "audio",
    messageText,
    content: {
      kind: "audio",
      source: "user",
      telegram: {
        file_id: source.file_id,
        file_unique_id: source.file_unique_id,
        file_name: fileName,
        mime_type: source.mime_type,
        file_size: source.file_size,
        caption: input.message.caption,
      },
      processing: {
        status: "completed",
        method: "transcription",
      },
      derived_text: messageText,
    },
  });
}

async function transcribeAudio(input: {
  model: TranscriptionModelSpec;
  audio: Uint8Array;
  audioMediaType: string;
  fileName?: string;
  llm: LlmRegistry;
}): Promise<string> {
  if (input.model.inputMethod === "native_transcription") {
    const result = await transcribe({
      model: input.llm.getTranscriptionModel(input.model.id),
      audio: input.audio,
    });

    return String(result.text ?? "").trim();
  }

  const result = await generateText({
    model: input.llm.getModel(input.model.id as QualifiedModelId),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: AUDIO_TRANSCRIPTION_PROMPT },
          {
            type: "file",
            data: input.audio,
            mediaType: input.audioMediaType,
            filename: input.fileName,
          },
        ],
      },
    ],
  });

  return result.text.trim();
}

async function prepareDocumentInput(input: {
  message: TelegramMessage;
  telegram: TelegramClient;
}): Promise<PreparedUserInput | { errorMessage: string }> {
  const document = input.message.document;

  if (!document) {
    return { errorMessage: "Could not read the document payload." };
  }

  const file = await input.telegram.getFile(document.file_id);

  if (!file.file_path) {
    return { errorMessage: "Telegram did not provide a document download path." };
  }

  if ((file.file_size ?? document.file_size ?? 0) > MAX_DOWNLOAD_BYTES) {
    return { errorMessage: "Document is too large to process." };
  }

  const download = await input.telegram.downloadFile(file.file_path);
  const fileName = document.file_name ?? "uploaded file";
  const mimeType = document.mime_type ?? download.mediaType ?? inferMimeType(fileName);

  if (isPdf(fileName, mimeType)) {
    const extracted = extractPdfText(download.data).trim();

    if (!extracted) {
      return {
        errorMessage: "This PDF does not contain extractable text. Scanned or image-only PDFs are not enabled.",
      };
    }

    const messageText = [
      `User uploaded a PDF (${fileName}).`,
      "The following text was extracted automatically and may omit formatting:",
      extracted,
    ].join("\n\n");

    return buildPreparedInput({
      kind: "pdf",
      messageText,
      content: {
        kind: "pdf",
        source: "user",
        telegram: buildDocumentTelegramMetadata(document, input.message.caption),
        processing: { status: "completed", method: "text_extract" },
        derived_text: messageText,
      },
    });
  }

  if (!isTextLikeDocument(document, mimeType)) {
    return { errorMessage: "This file type is not supported for text extraction." };
  }

  if (download.data.byteLength > MAX_TEXT_EXTRACT_BYTES) {
    return { errorMessage: "Text file is too large to extract safely." };
  }

  const extracted = new TextDecoder("utf-8", { fatal: false }).decode(download.data).trim();

  if (!extracted) {
    return { errorMessage: "This file did not contain extractable text." };
  }

  const messageText = [
    `User uploaded a file (${fileName}).`,
    "The following text was extracted automatically and may omit formatting:",
    extracted,
  ].join("\n\n");

  return buildPreparedInput({
    kind: "file",
    messageText,
    content: {
      kind: "file",
      source: "user",
      telegram: buildDocumentTelegramMetadata(document, input.message.caption),
      processing: { status: "completed", method: "text_extract" },
      derived_text: messageText,
    },
  });
}

export function parseStoredMessageContent(value: string | null): StoredMessageContent | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as StoredMessageContent;
  } catch {
    return null;
  }
}

function buildDocumentTelegramMetadata(document: TelegramDocument, caption: string | undefined): StoredMessageContent["telegram"] {
  return {
    file_id: document.file_id,
    file_unique_id: document.file_unique_id,
    file_name: document.file_name,
    mime_type: document.mime_type,
    file_size: document.file_size,
    caption,
  };
}

function formatImageDerivedText(input: {
  derivedText: string;
  caption?: string;
  modelId: string;
  usedActiveModel: boolean;
}): string {
  const header = input.usedActiveModel
    ? `User sent an image. The active model interpreted it directly (${input.modelId}).`
    : `User sent an image. The configured vision model interpreted it (${input.modelId}).`;

  return [
    header,
    input.caption ? `Telegram caption: ${input.caption}` : null,
    "The following interpretation may be imperfect:",
    input.derivedText || "No image details could be extracted.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function inferMimeType(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }

  if (lower.endsWith(".md")) {
    return "text/markdown";
  }

  if (lower.endsWith(".json")) {
    return "application/json";
  }

  if (lower.endsWith(".csv")) {
    return "text/csv";
  }

  if (lower.endsWith(".tsv")) {
    return "text/tab-separated-values";
  }

  return undefined;
}

function resolveAudioMediaType(input: {
  fileName?: string;
  sourceMimeType?: string;
  downloadMediaType?: string;
}): string {
  if (input.sourceMimeType) {
    return input.sourceMimeType;
  }

  if (input.downloadMediaType) {
    return input.downloadMediaType;
  }

  const fileName = input.fileName?.toLowerCase();

  if (fileName?.endsWith(".mp3")) {
    return "audio/mpeg";
  }

  if (fileName?.endsWith(".wav")) {
    return "audio/wav";
  }

  if (fileName?.endsWith(".m4a")) {
    return "audio/mp4";
  }

  if (fileName?.endsWith(".ogg") || fileName?.endsWith(".oga")) {
    return "audio/ogg";
  }

  return "audio/ogg";
}

function isPdf(fileName: string, mimeType?: string): boolean {
  return mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
}

function isTextLikeDocument(document: TelegramDocument, mimeType?: string): boolean {
  const fileName = document.file_name?.toLowerCase() ?? "";

  if (mimeType?.startsWith("text/")) {
    return true;
  }

  return [
    ".txt",
    ".md",
    ".json",
    ".csv",
    ".tsv",
    ".xml",
    ".html",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".sh",
    ".yaml",
    ".yml",
    ".toml",
  ].some((suffix) => fileName.endsWith(suffix));
}

function extractPdfText(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1", { fatal: false }).decode(bytes);
  const matches = [...raw.matchAll(/\((?:\\.|[^\\()])+\)\s*Tj/g), ...raw.matchAll(/\[(.*?)\]\s*TJ/gs)];
  const chunks: string[] = [];

  for (const match of matches) {
    const value = match[0].includes("[") ? match[1] ?? "" : match[0];
    const nested = value.match(/\((?:\\.|[^\\()])+\)/g) ?? [value];

    for (const item of nested) {
      const cleaned = item
        .replace(/^\(/, "")
        .replace(/\)\s*Tj$/, "")
        .replace(/\)$/, "")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\n/g, " ")
        .replace(/\\r/g, " ")
        .replace(/\\t/g, " ")
        .replace(/\\\\/g, "\\")
        .trim();

      if (cleaned) {
        chunks.push(cleaned);
      }
    }
  }

  return chunks.join(" ").replace(/\s+/g, " ").trim();
}
