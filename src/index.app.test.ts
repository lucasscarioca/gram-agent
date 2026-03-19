import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repoMock = vi.hoisted(() => ({
  ensureChat: vi.fn(),
  getActiveSession: vi.fn().mockResolvedValue({ id: "session-1" }),
  createMemory: vi.fn().mockResolvedValue(undefined),
  getSession: vi.fn(),
  setActiveSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  getMostRecentSession: vi.fn().mockResolvedValue(null),
  countPendingToolApprovalsForChat: vi.fn().mockResolvedValue(2),
  countPendingQuestionsForChat: vi.fn().mockResolvedValue(1),
}));

const telegramMock = vi.hoisted(() => ({
  setMyCommands: vi.fn().mockResolvedValue(undefined),
  setChatMenuButtonToCommands: vi.fn().mockResolvedValue(undefined),
  answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
  clearInlineKeyboard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./db/repo", () => ({
  Repo: class {
    constructor() {
      return repoMock;
    }
  },
}));

vi.mock("./telegram/client", () => ({
  TelegramClient: class {
    constructor() {
      return telegramMock;
    }
  },
}));

vi.mock("./llm/registry", () => ({
  LlmRegistry: {
    fromConfig: vi.fn(() => ({})),
  },
}));

vi.mock("./admin/auth", () => ({
  verifyAccessJwt: vi.fn(async () => ({ email: "admin@example.com" })),
}));

import app from "./index";

function createEnv() {
  return {
    DB: {} as D1Database,
    ASSETS: {
      fetch: vi.fn(async () => new Response("<html>admin</html>", { headers: { "content-type": "text/html" } })),
    } as unknown as Fetcher,
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    ALLOWED_TELEGRAM_USER_ID: "1",
    ALLOWED_CHAT_ID: "1",
    GOOGLE_GENERATIVE_AI_API_KEY: "google",
    ADMIN_ENABLED: "true",
    ADMIN_BASE_URL: "https://gram.example.com/admin",
    TEAM_DOMAIN: "https://team.cloudflareaccess.com",
    POLICY_AUD: "aud-tag",
  };
}

function createRedirectingAssetEnv() {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "/admin/" } }))
    .mockResolvedValueOnce(new Response("<html>admin</html>", { headers: { "content-type": "text/html" } }));

  return {
    ...createEnv(),
    ASSETS: {
      fetch: fetchMock,
    } as unknown as Fetcher,
  };
}

describe("webhook app", () => {
  beforeEach(() => {
    repoMock.ensureChat.mockResolvedValue(undefined);
    repoMock.getActiveSession.mockResolvedValue({ id: "session-1" });
    repoMock.getSession.mockResolvedValue({
      id: "session-1",
      chat_id: 1,
      title: "Session 1",
      selected_model: "google:gemini-2.5-flash",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects wrong webhook secrets", async () => {
    const response = await app.request(
      "/webhooks/telegram/wrong",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "secret",
        },
        body: JSON.stringify({ update_id: 1 }),
      },
      createEnv(),
    );

    expect(response.status).toBe(404);
  });

  it("rejects wrong Telegram secret headers", async () => {
    const response = await app.request(
      "/webhooks/telegram/secret",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "wrong",
        },
        body: JSON.stringify({ update_id: 1 }),
      },
      createEnv(),
    );

    expect(response.status).toBe(403);
  });

  it("routes unsupported callback actions to Telegram feedback", async () => {
    const response = await app.request(
      "/webhooks/telegram/secret",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "secret",
        },
        body: JSON.stringify({
          update_id: 1,
          callback_query: {
            id: "cb-1",
            from: { id: 1 },
            data: "unsupported:1",
            message: {
              message_id: 11,
              chat: { id: 1, type: "private" },
            },
          },
        }),
      },
      createEnv(),
    );

    expect(response.status).toBe(200);
    expect(telegramMock.answerCallbackQuery).toHaveBeenCalledWith("cb-1", "Unsupported action");
  });

  it("routes /remember through the webhook handler", async () => {
    const response = await app.request(
      "/webhooks/telegram/secret",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "secret",
        },
        body: JSON.stringify({
          update_id: 1,
          message: {
            message_id: 12,
            from: { id: 1 },
            chat: { id: 1, type: "private" },
            text: "/remember use pnpm",
          },
        }),
      },
      createEnv(),
    );

    expect(response.status).toBe(200);
    expect(repoMock.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 1, userId: 1, contentText: "use pnpm" }),
    );
    expect(telegramMock.sendMessage).toHaveBeenCalledWith(1, "Saved to memory.", { replyToMessageId: 12 });
  });

  it("omits /dashboard from Telegram commands when admin is disabled", async () => {
    const env = {
      ...createEnv(),
      ADMIN_ENABLED: "false",
      ADMIN_BASE_URL: undefined,
      TEAM_DOMAIN: undefined,
      POLICY_AUD: undefined,
    };

    const response = await app.request(
      "/webhooks/telegram/secret",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "secret",
        },
        body: JSON.stringify({
          update_id: 1,
          message: {
            message_id: 15,
            from: { id: 1 },
            chat: { id: 1, type: "private" },
            text: "/help",
          },
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(telegramMock.setMyCommands).toHaveBeenCalledWith(
      expect.not.arrayContaining([expect.objectContaining({ command: "dashboard" })]),
    );
  });

  it("routes session switch callbacks through the webhook handler", async () => {
    const response = await app.request(
      "/webhooks/telegram/secret",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "secret",
        },
        body: JSON.stringify({
          update_id: 1,
          callback_query: {
            id: "cb-2",
            from: { id: 1 },
            data: "session_use:session-1",
            message: {
              message_id: 13,
              chat: { id: 1, type: "private" },
            },
          },
        }),
      },
      createEnv(),
    );

    expect(response.status).toBe(200);
    expect(repoMock.setActiveSession).toHaveBeenCalledWith(1, "session-1", expect.any(String));
    expect(telegramMock.answerCallbackQuery).toHaveBeenCalledWith("cb-2", "Session switched");
  });

  it("routes session delete confirm callbacks through the webhook handler", async () => {
    repoMock.getMostRecentSession.mockResolvedValueOnce({
      id: "session-2",
      title: "Session 2",
    });

    const response = await app.request(
      "/webhooks/telegram/secret",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "secret",
        },
        body: JSON.stringify({
          update_id: 1,
          callback_query: {
            id: "cb-3",
            from: { id: 1 },
            data: "session_delete_confirm:session-1",
            message: {
              message_id: 14,
              chat: { id: 1, type: "private" },
            },
          },
        }),
      },
      createEnv(),
    );

    expect(response.status).toBe(200);
    expect(repoMock.deleteSession).toHaveBeenCalledWith("session-1", 1);
    expect(repoMock.setActiveSession).toHaveBeenCalledWith(1, "session-2", expect.any(String));
    expect(telegramMock.answerCallbackQuery).toHaveBeenCalledWith("cb-3", "Session deleted");
  });

  it("rejects admin API requests without an access token", async () => {
    const response = await app.request("/admin/api/bootstrap", undefined, createEnv());

    expect(response.status).toBe(403);
  });

  it("renders a simple landing page on the subdomain root without auth cookies", async () => {
    const response = await app.request("/", undefined, createEnv());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("Gram Agent working");
  });

  it("rejects /admin without an access token", async () => {
    const response = await app.request("/admin", undefined, createEnv());

    expect(response.status).toBe(403);
  });

  it("serves the admin shell on /admin/ with a valid access token", async () => {
    const response = await app.request(
      "/admin/",
      {
        headers: {
          "cf-access-jwt-assertion": "valid-token",
        },
      },
      createEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("admin");
  });

  it("serves admin bootstrap data when the access token is valid", async () => {
    const response = await app.request(
      "/admin/api/bootstrap",
      {
        headers: {
          "cf-access-jwt-assertion": "valid-token",
        },
      },
      createEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        authenticated_email: "admin@example.com",
        pending_approvals: 2,
        pending_questions: 1,
      }),
    );
  });

  it("serves the admin shell on /admin when the access token is valid", async () => {
    const response = await app.request(
      "/admin",
      {
        headers: {
          "cf-access-jwt-assertion": "valid-token",
        },
      },
      createEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("admin");
  });

  it("follows asset redirects when serving the admin shell", async () => {
    const response = await app.request(
      "/admin",
      {
        headers: {
          "cf-access-jwt-assertion": "valid-token",
        },
      },
      createRedirectingAssetEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("admin");
  });
});
