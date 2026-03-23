import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  experimental_transcribe: vi.fn(),
}));

import { experimental_transcribe, generateText } from "ai";

import { prepareTelegramUserInput } from "./multimodal";
import type { ChatRow, SessionRow, TelegramMessage } from "./types";

function createChat(overrides: Partial<ChatRow> = {}): ChatRow {
  return {
    chat_id: 1,
    user_id: 1,
    active_session_id: "session-1",
    default_vision_model: null,
    default_transcription_model: "google:gemini-2.5-flash",
    created_at: "2026-03-15T00:00:00.000Z",
    updated_at: "2026-03-15T00:00:00.000Z",
    ...overrides,
  };
}

function createSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    chat_id: 1,
    user_id: 1,
    title: "Test",
    title_source: "manual",
    title_updated_at: "2026-03-15T00:00:00.000Z",
    last_auto_title_message_count: 0,
    selected_model: "google:gemini-2.5-flash",
    compacted_summary: null,
    compacted_at: null,
    last_compacted_message_id: null,
    last_context_warning_at: null,
    created_at: "2026-03-15T00:00:00.000Z",
    last_message_at: "2026-03-15T00:00:00.000Z",
    ...overrides,
  };
}

function createVoiceMessage(): TelegramMessage {
  return {
    message_id: 1,
    chat: { id: 1, type: "private" },
    voice: {
      file_id: "voice-file",
      file_unique_id: "voice-unique",
      duration: 3,
      mime_type: "audio/ogg",
      file_size: 128,
    },
  };
}

function createPhotoMessage(): TelegramMessage {
  return {
    message_id: 2,
    chat: { id: 1, type: "private" },
    photo: [
      {
        file_id: "photo-file",
        file_unique_id: "photo-unique",
        width: 320,
        height: 240,
        file_size: 128,
      },
    ],
  };
}

describe("prepareTelegramUserInput audio", () => {
  it("uses Gemini file prompts for audio transcription", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "hello from audio" } as Awaited<ReturnType<typeof generateText>>);

    const telegram = {
      getFile: vi.fn().mockResolvedValue({
        file_id: "voice-file",
        file_unique_id: "voice-unique",
        file_path: "voice.ogg",
        file_size: 128,
      }),
      downloadFile: vi.fn().mockResolvedValue({
        data: new Uint8Array([1, 2, 3]),
        mediaType: "audio/ogg",
      }),
    };
    const llm = {
      getModel: vi.fn().mockReturnValue("gemini-model"),
      getTranscriptionModel: vi.fn(),
    };

    const result = await prepareTelegramUserInput({
      message: createVoiceMessage(),
      session: createSession(),
      chat: createChat(),
      telegram: telegram as never,
      llm: llm as never,
    });

    expect(llm.getModel).toHaveBeenCalledWith("google:gemini-2.5-flash");
    expect(llm.getTranscriptionModel).not.toHaveBeenCalled();
    expect(experimental_transcribe).not.toHaveBeenCalled();
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-model",
        messages: [
          {
            role: "user",
            content: [
              expect.objectContaining({ type: "text" }),
              expect.objectContaining({
                type: "file",
                mediaType: "audio/ogg",
                data: new Uint8Array([1, 2, 3]),
              }),
            ],
          },
        ],
      }),
    );

    expect(result).toEqual({
      contentText: [
        "User sent an audio message.",
        "The following is an automatic transcription and may contain recognition errors:",
        "hello from audio",
      ].join("\n\n"),
      contentJson: expect.any(String),
    });
  });

  it("rejects audio when transcription is not configured", async () => {
    const result = await prepareTelegramUserInput({
      message: createVoiceMessage(),
      session: createSession(),
      chat: createChat({ default_transcription_model: null }),
      telegram: {} as never,
      llm: {} as never,
    });

    expect(result).toEqual({
      errorMessage: "Audio transcription not enabled. Configure a default transcription model in /settings or the admin dashboard.",
    });
  });
});

describe("prepareTelegramUserInput image", () => {
  it("rejects images when no vision model is available", async () => {
    const result = await prepareTelegramUserInput({
      message: createPhotoMessage(),
      session: createSession({ selected_model: "openrouter:minimax/minimax-m2.5" }),
      chat: createChat({ default_vision_model: null }),
      telegram: {} as never,
      llm: {} as never,
    });

    expect(result).toEqual({
      errorMessage: "Vision not enabled. Configure a default vision model in /settings or the admin dashboard.",
    });
  });
});
