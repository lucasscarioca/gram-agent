import type { Context, Hono } from "hono";

import { getConfig, type AppConfig } from "../config";
import { Repo } from "../db/repo";
import type {
  AdminBootstrap,
  ChatSettingsPayload,
  EnvBindings,
  OverviewSnapshot,
  RunDetail,
  SessionDetail,
} from "../types";
import { getTranscriptionModelSpec, getVisionCapableModels } from "../llm/catalog";
import { verifyAccessJwt } from "./auth";

export interface AdminAppEnv {
  Bindings: EnvBindings;
  Variables: {
    adminEmail: string | null;
  };
}

export function registerAdminRoutes(app: Hono<AdminAppEnv>) {
  app.use("/admin", adminGate);
  app.use("/admin/*", adminGate);

  app.get("/admin/api/bootstrap", async (c) => {
    const config = getAdminConfig(c);
    if (config instanceof Response) {
      return config;
    }

    const repo = new Repo(c.env.DB);
    const chatId = getDashboardChatId(config);
    const pendingApprovals = await repo.countPendingToolApprovalsForChat(chatId);
    const pendingQuestions = await repo.countPendingQuestionsForChat(chatId);
    const payload: AdminBootstrap = {
      app_name: "gram",
      admin_enabled: true,
      admin_base_url: config.adminBaseUrl ?? null,
      authenticated_email: c.get("adminEmail"),
      pending_approvals: pendingApprovals,
      pending_questions: pendingQuestions,
      allowed_models: config.allowedModels,
      vision_model_options: getVisionCapableModels(config.allowedModels).map((model) => model.id),
      transcription_model_options: config.allowedTranscriptionModels,
    };

    return c.json(payload);
  });

  app.get("/admin/api/settings", async (c) => {
    const config = getAdminConfig(c);
    if (config instanceof Response) {
      return config;
    }

    const repo = new Repo(c.env.DB);
    const chatId = getDashboardChatId(config);
    await repo.ensureChat(chatId, config.allowedTelegramUserId, new Date().toISOString());
    const chat = await repo.getChat(chatId);

    const payload: ChatSettingsPayload = {
      chat_id: chat?.chat_id ?? chatId,
      default_vision_model: chat?.default_vision_model ?? null,
      default_transcription_model: chat?.default_transcription_model ?? null,
    };

    return c.json(payload);
  });

  app.patch("/admin/api/settings", async (c) => {
    const config = getAdminConfig(c);
    if (config instanceof Response) {
      return config;
    }

    const repo = new Repo(c.env.DB);
    const chatId = getDashboardChatId(config);
    await repo.ensureChat(chatId, config.allowedTelegramUserId, new Date().toISOString());
    const body = (await c.req.json()) as Partial<ChatSettingsPayload>;

    if (body.default_vision_model !== undefined) {
      const visionModel = body.default_vision_model;
      const allowedVisionModels = new Set(getVisionCapableModels(config.allowedModels).map((model) => model.id));

      if (visionModel !== null && !allowedVisionModels.has(visionModel as (typeof config.allowedModels)[number])) {
        return c.json({ error: "Vision model not allowed" }, 400);
      }

      await repo.updateChatVisionModel(chatId, visionModel ?? null, new Date().toISOString());
    }

    if (body.default_transcription_model !== undefined) {
      const transcriptionModel = body.default_transcription_model;

      if (
        transcriptionModel !== null &&
        (!config.allowedTranscriptionModels.includes(transcriptionModel as (typeof config.allowedTranscriptionModels)[number]) ||
          !getTranscriptionModelSpec(transcriptionModel))
      ) {
        return c.json({ error: "Transcription model not allowed" }, 400);
      }

      await repo.updateChatTranscriptionModel(chatId, transcriptionModel ?? null, new Date().toISOString());
    }

    const chat = await repo.getChat(chatId);
    return c.json({
      chat_id: chatId,
      default_vision_model: chat?.default_vision_model ?? null,
      default_transcription_model: chat?.default_transcription_model ?? null,
    } satisfies ChatSettingsPayload);
  });

  app.get("/admin/api/overview", async (c) => {
    const config = getAdminConfig(c);
    if (config instanceof Response) {
      return config;
    }

    const repo = new Repo(c.env.DB);
    const chatId = getDashboardChatId(config);
    const [today, sevenDays, thirtyDays, allTime, topProviders, topModels, dailyUsage, recentFailures, approvals, questions, memoryCount, recentSessions] =
      await Promise.all([
        repo.getUsageTotalsSince(startOfUtcDay()),
        repo.getUsageTotalsSince(subtractDays(7)),
        repo.getUsageTotalsSince(subtractDays(30)),
        repo.getGlobalUsageTotals(),
        repo.getTopProviders({ since: subtractDays(30), limit: 4 }),
        repo.getTopModels({ since: subtractDays(30), limit: 5 }),
        repo.getDailyUsageSince(subtractDays(14)),
        repo.listRunsForDashboard({ chatId, status: "failed", limit: 6 }),
        repo.countPendingToolApprovalsForChat(chatId),
        repo.countPendingQuestionsForChat(chatId),
        repo.countActiveMemoriesForChat(chatId),
        repo.listSessionsForDashboard(chatId, 6),
      ]);

    const payload: OverviewSnapshot = {
      today,
      seven_days: sevenDays,
      thirty_days: thirtyDays,
      all_time: allTime,
      top_providers_30d: topProviders,
      top_models_30d: topModels,
      daily_usage_14d: dailyUsage,
      recent_failures: recentFailures,
      pending_approvals: approvals,
      pending_questions: questions,
      active_memories: memoryCount,
      recent_sessions: recentSessions,
    };

    return c.json(payload);
  });

  app.get("/admin/api/sessions", async (c) => {
    const config = getAdminConfig(c);
    if (config instanceof Response) {
      return config;
    }

    const repo = new Repo(c.env.DB);
    const chatId = getDashboardChatId(config);
    const sessions = await repo.listSessionsForDashboard(chatId, 30);
    return c.json({ sessions });
  });

  app.get("/admin/api/sessions/:id", async (c) => {
    const config = getAdminConfig(c);
    if (config instanceof Response) {
      return config;
    }

    const repo = new Repo(c.env.DB);
    const session = await repo.getSession(c.req.param("id"));
    const chatId = getDashboardChatId(config);

    if (!session || session.chat_id !== chatId) {
      return c.json({ error: "Session not found" }, 404);
    }

    const payload: SessionDetail = {
      session,
      usage: await repo.getSessionUsageTotals(session.id),
      messages: await repo.getSessionMessages(session.id),
      recent_runs: await repo.listRunsForDashboard({ chatId, sessionId: session.id, limit: 10 }),
      tool_calls: await repo.listRecentToolCallsForSession(session.id, 20),
      message_count: await repo.countMessages(session.id),
    };

    return c.json(payload);
  });

  app.get("/admin/api/runs", async (c) => {
    const config = getAdminConfig(c);
    if (config instanceof Response) {
      return config;
    }

    const repo = new Repo(c.env.DB);
    const chatId = getDashboardChatId(config);
    const runs = await repo.listRunsForDashboard({ chatId, limit: 40 });
    return c.json({ runs });
  });

  app.get("/admin/api/runs/:id", async (c) => {
    const config = getAdminConfig(c);
    if (config instanceof Response) {
      return config;
    }

    const repo = new Repo(c.env.DB);
    const runId = c.req.param("id");
    const run = await repo.getRun(runId);

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    const session = await repo.getSession(run.session_id);
    const chatId = getDashboardChatId(config);
    if (!session || session.chat_id !== chatId) {
      return c.json({ error: "Run not found" }, 404);
    }

    const agentRun = await repo.getAgentRun(runId);
    const runSummary = {
      id: run.id,
      session_id: run.session_id,
      session_title: session.title,
      provider: run.provider,
      model: run.model,
      status: run.status,
      error: run.error,
      input_tokens: run.input_tokens,
      cached_input_tokens: run.cached_input_tokens,
      output_tokens: run.output_tokens,
      estimated_cost_usd: run.estimated_cost_usd,
      created_at: run.created_at,
      agent_status: agentRun?.status ?? null,
      agent_last_error: agentRun?.last_error ?? null,
    };

    const payload: RunDetail = {
      run: runSummary,
      agent_run: agentRun,
      tool_calls: await repo.listToolCallsForRun(runId),
      pending_approvals: await repo.listPendingToolApprovals(runId),
      pending_questions: await repo.listPendingQuestions(runId),
    };

    return c.json(payload);
  });

  app.get("/admin/api/memories", async (c) => {
    const config = getAdminConfig(c);
    if (config instanceof Response) {
      return config;
    }

    const repo = new Repo(c.env.DB);
    const chatId = getDashboardChatId(config);
    const [memories, toolPermissions] = await Promise.all([
      repo.listMemoriesForDashboard(chatId),
      repo.listToolPermissionsForChat(chatId),
    ]);
    return c.json({ memories, tool_permissions: toolPermissions });
  });

  app.get("/admin/api/pending", async (c) => {
    const config = getAdminConfig(c);
    if (config instanceof Response) {
      return config;
    }

    const repo = new Repo(c.env.DB);
    const chatId = getDashboardChatId(config);
    const [approvals, questions] = await Promise.all([
      repo.listPendingToolApprovalsForChat(chatId, 20),
      repo.listPendingQuestionsForChat(chatId, 20),
    ]);
    return c.json({ approvals, questions });
  });
  app.get("/admin", (c) => serveAdminAsset(c, "/admin/index.html"));
  app.get("/admin/", (c) => serveAdminAsset(c, "/admin/index.html"));
  app.get("/admin/*", async (c) => {
    const pathname = new URL(c.req.url).pathname;
    const adminPath = pathname.slice("/admin".length) || "/";

    if (adminPath.startsWith("/api/")) {
      return c.json({ error: "Not found" }, 404);
    }

    if (looksLikeAsset(adminPath)) {
      return serveAdminAsset(c, pathname);
    }

    return serveAdminAsset(c, "/admin/index.html");
  });
}

async function adminGate(c: Context<AdminAppEnv>, next: () => Promise<void>) {
  const config = getAdminConfig(c);
  if (config instanceof Response) {
    return config;
  }

  const token = c.req.header("cf-access-jwt-assertion");
  if (!token) {
    return c.text("Missing required Cloudflare Access token", 403);
  }

  try {
    const identity = await verifyAccessJwt({
      token,
      teamDomain: config.teamDomain!,
      audience: config.policyAud!,
    });
    c.set("adminEmail", identity.email);
    await next();
  } catch (error) {
    console.warn("admin access verification failed", error);
    return c.text("Invalid Cloudflare Access token", 403);
  }
}

function getAdminConfig(c: Context<AdminAppEnv>): AppConfig | Response {
  const activeConfig = getConfig(c.env);

  if (activeConfig && isAdminConfigured(activeConfig)) {
    return activeConfig;
  }

  return c.text("Admin dashboard is not configured yet.", 503);
}

export function isAdminConfigured(config: AppConfig): boolean {
  return Boolean(config.adminEnabled && config.adminBaseUrl && config.teamDomain && config.policyAud);
}

export function getDashboardChatId(config: AppConfig): number {
  return config.allowedChatId ?? config.allowedTelegramUserId;
}

async function serveAdminAsset(c: Context<AdminAppEnv>, assetPath: string): Promise<Response> {
  let requestUrl = new URL(c.req.url);
  requestUrl.pathname = assetPath;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await c.env.ASSETS.fetch(
      new Request(requestUrl.toString(), {
        method: "GET",
        headers: c.req.raw.headers,
      }),
    );

    if (!isRedirect(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    const nextUrl = new URL(location, requestUrl);
    if (nextUrl.toString() === requestUrl.toString()) {
      return response;
    }

    requestUrl = nextUrl;
  }

  return new Response("Admin asset redirect loop", { status: 500 });
}

function looksLikeAsset(pathname: string): boolean {
  return /\.[a-zA-Z0-9]+$/.test(pathname);
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function startOfUtcDay(reference = new Date()): string {
  const start = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate(), 0, 0, 0, 0),
  );
  return start.toISOString();
}

function subtractDays(days: number, reference = new Date()): string {
  return new Date(reference.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
