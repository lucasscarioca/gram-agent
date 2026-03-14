import type { TelegramApiResponse, TelegramMessage } from "../types";

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface TelegramCommand {
  command: string;
  description: string;
}

export interface SendMessageOptions {
  replyToMessageId?: number;
  inlineKeyboard?: InlineKeyboardButton[][];
}

export class TelegramClient {
  private readonly baseUrl: string;

  constructor(botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async sendChatAction(chatId: number, action: "typing"): Promise<void> {
    await this.call("sendChatAction", {
      chat_id: chatId,
      action,
    });
  }

  async setMyCommands(commands: TelegramCommand[]): Promise<void> {
    await this.call("setMyCommands", {
      commands,
    });
  }

  async setChatMenuButtonToCommands(): Promise<void> {
    await this.call("setChatMenuButton", {
      menu_button: { type: "commands" },
    });
  }

  async sendMessage(
    chatId: number,
    text: string,
    options: SendMessageOptions = {},
  ): Promise<TelegramMessage> {
    const response = await this.call<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_to_message_id: options.replyToMessageId,
      reply_markup: options.inlineKeyboard
        ? { inline_keyboard: options.inlineKeyboard }
        : undefined,
    });

    return response.result;
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  async clearInlineKeyboard(chatId: number, messageId: number): Promise<void> {
    await this.call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  }

  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    options: { inlineKeyboard?: InlineKeyboardButton[][] } = {},
  ): Promise<void> {
    await this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      reply_markup: options.inlineKeyboard ? { inline_keyboard: options.inlineKeyboard } : undefined,
    });
  }

  async editInlineKeyboard(chatId: number, messageId: number, inlineKeyboard: InlineKeyboardButton[][]): Promise<void> {
    await this.call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: inlineKeyboard },
    });
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<TelegramApiResponse<T>> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Telegram API ${method} failed with ${response.status}`);
    }

    const payload = (await response.json()) as TelegramApiResponse<T>;

    if (!payload.ok) {
      throw new Error(`Telegram API ${method} returned ok=false`);
    }

    return payload;
  }
}
