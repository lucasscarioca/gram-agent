import { afterEach, describe, expect, it, vi } from "vitest";

import { TelegramClient } from "./client";

describe("telegram client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends HTML messages with inline keyboards", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 123 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new TelegramClient("bot-token");
    await client.sendMessage(1, "Hello", {
      replyToMessageId: 9,
      inlineKeyboard: [[{ text: "Go", callback_data: "go" }]],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/botbot-token/sendMessage",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body).toMatchObject({
      chat_id: 1,
      text: "Hello",
      parse_mode: "HTML",
      reply_to_message_id: 9,
      reply_markup: { inline_keyboard: [[{ text: "Go", callback_data: "go" }]] },
    });
  });

  it("throws on Telegram ok=false responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: false }),
      }),
    );

    const client = new TelegramClient("bot-token");
    await expect(client.answerCallbackQuery("cb-1")).rejects.toThrow("returned ok=false");
  });
});
