import {
  Activity,
  Bot,
  ChevronRight,
  CircleAlert,
  Clock3,
  Github,
  Gauge,
  Layers3,
  LockKeyhole,
  MemoryStick,
  MessageSquarePlus,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardDescription, CardTitle } from "./components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { cn } from "./lib/cn";
import { formatCompactNumber, formatDateTime, formatNumber, formatUsd, truncate } from "./lib/format";
import { mockAdminData } from "./mock-data";
import type {
  AdminBootstrap,
  ChatSettingsPayload,
  MemoryRow,
  OverviewSnapshot,
  PendingApprovalListItem,
  PendingQuestionListItem,
  RunDetail,
  RunListItem,
  SessionDetail,
  SessionListItem,
  ToolPermissionListItem,
} from "../../src/types";

type View = "overview" | "sessions" | "runs" | "pending" | "memory";

interface RouteState {
  view: View;
  sessionId: string | null;
  runId: string | null;
}

interface MemoryPayload {
  memories: MemoryRow[];
  tool_permissions: ToolPermissionListItem[];
}

interface PendingPayload {
  approvals: PendingApprovalListItem[];
  questions: PendingQuestionListItem[];
}

const NAV_ITEMS: Array<{ view: View; label: string; icon: ReactNode }> = [
  { view: "overview", label: "Overview", icon: <Gauge className="h-4 w-4" /> },
  { view: "sessions", label: "Sessions", icon: <Layers3 className="h-4 w-4" /> },
  { view: "runs", label: "Runs", icon: <Activity className="h-4 w-4" /> },
  { view: "pending", label: "Pending", icon: <Clock3 className="h-4 w-4" /> },
  { view: "memory", label: "Memory", icon: <MemoryStick className="h-4 w-4" /> },
];

export function App() {
  const mockMode = useMemo(() => isLocalMockMode(), []);
  const [route, setRoute] = useState<RouteState>(() => parseRoute(window.location.pathname));
  const [bootstrap, setBootstrap] = useState<AdminBootstrap | null>(null);
  const [overview, setOverview] = useState<OverviewSnapshot | null>(null);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [pending, setPending] = useState<PendingPayload>({ approvals: [], questions: [] });
  const [memory, setMemory] = useState<MemoryPayload>({ memories: [], tool_permissions: [] });
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [settings, setSettings] = useState<ChatSettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedView = route.view;

  const loadDashboard = useCallback(async () => {
    setError(null);
    const [nextBootstrap, nextOverview, nextSessions, nextRuns, nextPending, nextMemory, nextSettings] = await Promise.all([
      getAdminBootstrap(mockMode),
      getOverview(mockMode),
      getSessions(mockMode),
      getRuns(mockMode),
      getPending(mockMode),
      getMemory(mockMode),
      getSettings(mockMode),
    ]);

    setBootstrap(nextBootstrap);
    setOverview(nextOverview);
    setSessions(nextSessions.sessions);
    setRuns(nextRuns.runs);
    setPending(nextPending);
    setMemory(nextMemory);
    setSettings(nextSettings);
  }, [mockMode]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await loadDashboard();
      } catch (nextError) {
        if (!cancelled) {
          setError(getErrorMessage(nextError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadDashboard]);

  useEffect(() => {
    const handlePopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!route.sessionId) {
      setSessionDetail(null);
      return;
    }

    let cancelled = false;
    void getSessionDetail(route.sessionId, mockMode)
      .then((detail) => {
        if (!cancelled) {
          setSessionDetail(detail);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(getErrorMessage(nextError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mockMode, route.sessionId]);

  useEffect(() => {
    if (!route.runId) {
      setRunDetail(null);
      return;
    }

    let cancelled = false;
    void getRunDetail(route.runId, mockMode)
      .then((detail) => {
        if (!cancelled) {
          setRunDetail(detail);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(getErrorMessage(nextError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mockMode, route.runId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadDashboard();
      if (route.sessionId) {
        setSessionDetail(await getSessionDetail(route.sessionId, mockMode));
      }
      if (route.runId) {
        setRunDetail(await getRunDetail(route.runId, mockMode));
      }
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setRefreshing(false);
    }
  }, [loadDashboard, mockMode, route.runId, route.sessionId]);

  const navigate = useCallback((path: string) => {
    window.history.pushState({}, "", path);
    setRoute(parseRoute(path));
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<ChatSettingsPayload>) => {
      if (mockMode) {
        setSettings((current) =>
          current
            ? { ...current, ...patch }
            : {
                chat_id: 0,
                default_vision_model: patch.default_vision_model ?? null,
                default_transcription_model: patch.default_transcription_model ?? null,
              },
        );
        return;
      }

      setSettings(await patchSettings(patch));
    },
    [mockMode],
  );

  const mobileTabsValue = useMemo(() => {
    if (selectedView === "sessions" && route.sessionId) {
      return "sessions";
    }

    if (selectedView === "runs" && route.runId) {
      return "runs";
    }

    return selectedView;
  }, [route.runId, route.sessionId, selectedView]);

  if (loading) {
    return <LoadingScreen />;
  }

  if (error && !bootstrap) {
    return <FatalScreen error={error} />;
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--foreground)]">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(21,32,51,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(21,32,51,0.03)_1px,transparent_1px)] bg-[size:72px_72px] opacity-40" />
        <div className="absolute left-[-8%] top-[-6%] h-[280px] w-[280px] rounded-full bg-[radial-gradient(circle,var(--accent-glow),transparent_68%)] blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-6%] h-[320px] w-[320px] rounded-full bg-[radial-gradient(circle,var(--danger-soft-strong),transparent_68%)] blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <Card className="overflow-hidden p-0">
              <div className="border-b border-[color:var(--border)] px-5 py-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-[22px] bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[0_0_40px_var(--accent-glow)]">
                    <Bot className="h-7 w-7" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold tracking-[0.22em] text-[var(--muted-foreground)]">Private ops</p>
                    <h1 className="font-[family-name:var(--font-display)] text-[1.9rem] leading-none tracking-[-0.03em]">Gram Admin</h1>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-[var(--muted-foreground)]">Sessions, runs, pending approvals, and memory in one hardened view.</p>
              </div>

              <div className="space-y-2 px-3 py-3">
                {NAV_ITEMS.map((item) => (
                  <NavButton
                    key={item.view}
                    active={selectedView === item.view}
                    icon={item.icon}
                    label={item.label}
                    onClick={() => navigate(viewToPath(item.view, route))}
                  />
                ))}
              </div>
            </Card>

            <Card className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--muted-foreground)]">Operator</p>
                  <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">{bootstrap?.authenticated_email ?? "Access session"}</p>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[color:var(--border)] bg-[rgba(243,245,251,0.03)] text-[var(--accent)]">
                  <ShieldCheck className="h-5 w-5" />
                </div>
              </div>
              <div className="rounded-[10px] border border-[color:var(--border)] bg-[rgba(243,245,251,0.025)] p-4">
                <p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--muted-foreground)]">Gate</p>
                <p className="mt-2 text-sm text-[var(--foreground)]">Cloudflare Access protected</p>
              </div>
            </Card>

            <Card className="space-y-4">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--muted-foreground)]">Multimodal</p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">Default preprocessing models for images and audio.</p>
              </div>

              <label className="block space-y-2">
                <span className="text-sm font-semibold text-[var(--foreground)]">Vision model</span>
                <select
                  className="w-full rounded-lg border border-[color:var(--border)] bg-[rgba(243,245,251,0.03)] px-3 py-2 text-sm text-[var(--foreground)]"
                  value={settings?.default_vision_model ?? ""}
                  onChange={(event) => void updateSettings({ default_vision_model: event.target.value || null })}
                >
                  <option value="">Disabled</option>
                  {(bootstrap?.vision_model_options ?? []).map((modelId) => (
                    <option key={modelId} value={modelId}>
                      {modelId}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-semibold text-[var(--foreground)]">Transcription model</span>
                <select
                  className="w-full rounded-lg border border-[color:var(--border)] bg-[rgba(243,245,251,0.03)] px-3 py-2 text-sm text-[var(--foreground)]"
                  value={settings?.default_transcription_model ?? ""}
                  onChange={(event) => void updateSettings({ default_transcription_model: event.target.value || null })}
                >
                  <option value="">Disabled</option>
                  {(bootstrap?.transcription_model_options ?? []).map((modelId) => (
                    <option key={modelId} value={modelId}>
                      {modelId}
                    </option>
                  ))}
                </select>
              </label>
            </Card>

            <Card className="space-y-4 p-4">
              <div>
                <p className="text-sm font-semibold text-[var(--foreground)]">Built on gram-agent</p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">Use this console to inspect sessions, runs, pending work, and memory while the bot stays Telegram-first.</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" asChild>
                  <a href="https://github.com/lucasscarioca/gram-agent" target="_blank" rel="noreferrer" aria-label="Open gram-agent on GitHub">
                    <Github className="h-4 w-4" />
                    Repo
                  </a>
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <a href="https://github.com/lucasscarioca/gram-agent/issues/new/choose" target="_blank" rel="noreferrer">
                    <MessageSquarePlus className="h-4 w-4" />
                    Open issue or idea
                  </a>
                </Button>
              </div>
            </Card>
          </aside>

          <main className="min-w-0 space-y-4">
            <header className="rounded-[12px] border border-[color:var(--border)] bg-[linear-gradient(180deg,rgba(24,31,28,0.98),rgba(14,19,17,0.96))] px-5 py-5 shadow-[0_18px_44px_rgba(0,0,0,0.22)] sm:px-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="border-[color:var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]">{viewLabel(selectedView)}</Badge>
                    <Badge>single-user</Badge>
                  </div>
                  <h2 className="mt-4 font-[family-name:var(--font-display)] text-[clamp(1.55rem,3vw,2.2rem)] leading-[1.08] tracking-[-0.025em]">{viewHeadline(selectedView)}</h2>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">{viewDescription(selectedView)}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3 lg:justify-end">
                  {mockMode ? <Badge className="border-[color:var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger)]">local mock data</Badge> : null}
                  {bootstrap?.admin_base_url ? (
                    <Badge className="border-[color:var(--accent-border)] bg-[var(--accent-soft)] px-4 py-2 text-[var(--accent)]">
                      {bootstrap.admin_base_url.replace(/^https?:\/\//, "")}
                    </Badge>
                  ) : null}
                  <Button variant="outline" onClick={() => void refresh()}>
                    <RefreshCcw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="mt-5 xl:hidden">
                <Tabs value={mobileTabsValue} onValueChange={(value) => navigate(viewToPath(value as View, route))}>
                  <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="sessions">Sessions</TabsTrigger>
                    <TabsTrigger value="runs">Runs</TabsTrigger>
                    <TabsTrigger value="pending">Pending</TabsTrigger>
                    <TabsTrigger value="memory">Memory</TabsTrigger>
                  </TabsList>
                  <TabsContent value={mobileTabsValue} className="hidden" />
                </Tabs>
              </div>
            </header>

            {error ? (
              <Card className="border-[color:var(--danger-border-strong)] bg-[linear-gradient(180deg,rgba(229,237,248,0.98),rgba(220,230,242,0.98))]">
                <div className="flex items-start gap-3">
                  <CircleAlert className="mt-0.5 h-5 w-5 text-[var(--danger)]" />
                  <div>
                    <CardTitle>Refresh failed</CardTitle>
                    <CardDescription className="mt-1 text-[var(--foreground)]/80">{error}</CardDescription>
                  </div>
                </div>
              </Card>
            ) : null}

            <div className="space-y-4">
              {selectedView === "overview" && overview ? <OverviewScreen overview={overview} navigate={navigate} /> : null}
              {selectedView === "sessions" ? <SessionsScreen sessions={sessions} detail={sessionDetail} navigate={navigate} /> : null}
              {selectedView === "runs" ? <RunsScreen runs={runs} detail={runDetail} navigate={navigate} /> : null}
              {selectedView === "pending" ? <PendingScreen pending={pending} navigate={navigate} /> : null}
              {selectedView === "memory" ? <MemoryScreen payload={memory} /> : null}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function OverviewScreen({ overview, navigate }: { overview: OverviewSnapshot; navigate: (path: string) => void }) {
  const cards = [
    { label: "Today", value: formatNumber(overview.today.run_count), meta: `${formatCompactNumber(overview.today.input_tokens)} input`, accent: "lime" as const },
    { label: "7d spend", value: formatUsd(overview.seven_days.estimated_cost_usd), meta: `${formatNumber(overview.seven_days.run_count)} runs`, accent: "orange" as const },
    { label: "Pending", value: formatNumber(overview.pending_approvals), meta: `${formatNumber(overview.pending_questions)} open questions`, accent: "stone" as const },
    { label: "Memory", value: formatNumber(overview.active_memories), meta: "active long-lived notes", accent: "soft" as const },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-4">
        {cards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.3fr)_380px]">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <SectionEyebrow label="14 day activity" />
              <CardTitle className="mt-3">Run volume</CardTitle>
              <CardDescription className="mt-2">Daily movement across sessions, tokens, and spend.</CardDescription>
            </div>
            <Badge>{formatUsd(overview.thirty_days.estimated_cost_usd)} / 30d</Badge>
          </div>
          <Sparkline rows={overview.daily_usage_14d} />
        </Card>

        <div className="grid gap-4">
          <Card>
            <SectionEyebrow label="30 day mix" />
            <CardTitle className="mt-3">Top models</CardTitle>
            <CardDescription className="mt-2">Where current cost concentrates.</CardDescription>
            <div className="mt-5 space-y-3">
              {overview.top_models_30d.map((row, index) => (
                <UsageRow key={row.key} title={row.key} subtitle={`${formatNumber(row.run_count)} runs`} value={formatUsd(row.estimated_cost_usd)} tone={index % 2 === 0 ? "lime" : "orange"} />
              ))}
            </div>
          </Card>

          <Card>
            <SectionEyebrow label="Provider spread" />
            <CardTitle className="mt-3">Top providers</CardTitle>
            <div className="mt-5 space-y-3">
              {overview.top_providers_30d.map((row, index) => (
                <UsageRow key={row.key} title={row.key} subtitle={`${formatCompactNumber(row.input_tokens + row.output_tokens)} tokens`} value={formatNumber(row.run_count)} tone={index % 2 === 0 ? "soft" : "lime"} />
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <SectionEyebrow label="Latest sessions" />
              <CardTitle className="mt-3">Conversation stack</CardTitle>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/sessions")}>Open list</Button>
          </div>
          <div className="mt-5 space-y-3">
            {overview.recent_sessions.map((session) => (
              <button key={session.id} className="w-full text-left" onClick={() => navigate(`/admin/sessions/${session.id}`)}>
                <SessionRowCard session={session} compact />
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <SectionEyebrow label="Failure watch" />
              <CardTitle className="mt-3">Recent failures</CardTitle>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/runs")}>Open runs</Button>
          </div>
          <div className="mt-5 space-y-3">
            {overview.recent_failures.length === 0 ? <EmptyState title="No recent failures" description="The current window looks clean." /> : null}
            {overview.recent_failures.map((run) => (
              <button key={run.id} className="w-full text-left" onClick={() => navigate(`/admin/runs/${run.id}`)}>
                <RunRowCard run={run} compact />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function SessionsScreen({ sessions, detail, navigate }: { sessions: SessionListItem[]; detail: SessionDetail | null; navigate: (path: string) => void }) {
  return (
    <div className="grid gap-4 2xl:grid-cols-[420px_minmax(0,1fr)]">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <SectionEyebrow label="Recent sessions" />
            <CardTitle className="mt-3">Session list</CardTitle>
            <CardDescription className="mt-2">Message volume, failures, cost, and current active thread.</CardDescription>
          </div>
          <Badge className="whitespace-nowrap">{formatNumber(sessions.length)} loaded</Badge>
        </div>
        <div className="mt-5 space-y-3">
          {sessions.map((session) => (
            <button key={session.id} className="w-full text-left" onClick={() => navigate(`/admin/sessions/${session.id}`)}>
              <SessionRowCard session={session} selected={detail?.session.id === session.id} />
            </button>
          ))}
        </div>
      </Card>

      <Card>
        {detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-3xl">
                <SectionEyebrow label="Session detail" />
                <CardTitle className="mt-3 text-2xl">{detail.session.title}</CardTitle>
                <CardDescription className="mt-2">{detail.session.selected_model} - last activity {formatDateTime(detail.session.last_message_at)}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge>{detail.session.title_source}</Badge>
                {detail.session.compacted_at ? <Badge className="border-[color:var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]">compacted</Badge> : null}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <StatMini label="Messages" value={formatNumber(detail.message_count)} />
              <StatMini label="Runs" value={formatNumber(detail.usage.run_count)} />
              <StatMini label="Cost" value={formatUsd(detail.usage.estimated_cost_usd)} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <div className="space-y-3">
                <SectionHeading title="Transcript" subtitle="Recent conversation history, oldest first." />
                <div className="space-y-3">
                  {detail.messages.slice(-14).map((message) => (
                    <div key={message.id} className="rounded-[10px] border border-[color:var(--border)] bg-[rgba(243,245,251,0.025)] p-4">
                      <div className="mb-2 flex items-center justify-between gap-3 text-[11px] tracking-[0.16em] text-[var(--muted-foreground)]">
                        <span>{message.role}</span>
                        <span>{formatDateTime(message.created_at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--foreground)]/92">{message.content_text}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-3">
                  <SectionHeading title="Recent runs" subtitle="Latest execution trail for this session." />
                  {detail.recent_runs.length === 0 ? <EmptyState title="No runs yet" description="This session has not triggered a model run." compact /> : null}
                  {detail.recent_runs.map((run) => (
                    <button key={run.id} className="w-full text-left" onClick={() => navigate(`/admin/runs/${run.id}`)}>
                      <RunRowCard run={run} compact />
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  <SectionHeading title="Tool activity" subtitle="Handy when the agent paused for approvals or follow-up questions." />
                  {detail.tool_calls.length === 0 ? <EmptyState title="No tool calls" description="This session history is pure chat so far." compact /> : null}
                  {detail.tool_calls.map((toolCall) => (
                    <div key={toolCall.id} className="rounded-[10px] border border-[color:var(--border)] bg-[rgba(243,245,251,0.025)] p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[var(--foreground)]">{toolCall.tool_name}</p>
                        <StatusBadge status={toolCall.status} />
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{toolCall.summary_text ?? truncate(toolCall.input_json, 96)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState title="Pick a session" description="Select a conversation to inspect transcript, usage, and tool activity." />
        )}
      </Card>
    </div>
  );
}

function RunsScreen({ runs, detail, navigate }: { runs: RunListItem[]; detail: RunDetail | null; navigate: (path: string) => void }) {
  return (
    <div className="grid gap-4 2xl:grid-cols-[420px_minmax(0,1fr)]">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <SectionEyebrow label="Recent executions" />
            <CardTitle className="mt-3">Run list</CardTitle>
            <CardDescription className="mt-2">Provider, model, token usage, and failure state.</CardDescription>
          </div>
          <Badge className="whitespace-nowrap">{formatNumber(runs.length)} loaded</Badge>
        </div>
        <div className="mt-5 space-y-3">
          {runs.map((run) => (
            <button key={run.id} className="w-full text-left" onClick={() => navigate(`/admin/runs/${run.id}`)}>
              <RunRowCard run={run} selected={detail?.run.id === run.id} />
            </button>
          ))}
        </div>
      </Card>

      <Card>
        {detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-3xl">
                <SectionEyebrow label="Run detail" />
                <CardTitle className="mt-3 text-2xl">{detail.run.session_title}</CardTitle>
                <CardDescription className="mt-2">{detail.run.provider}:{detail.run.model} - {formatDateTime(detail.run.created_at)}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={detail.run.status} />
                {detail.run.agent_status ? <StatusBadge status={detail.run.agent_status} subtle /> : null}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <StatMini label="Input" value={formatCompactNumber(detail.run.input_tokens)} />
              <StatMini label="Cached" value={formatCompactNumber(detail.run.cached_input_tokens)} />
              <StatMini label="Output" value={formatCompactNumber(detail.run.output_tokens)} />
              <StatMini label="Cost" value={formatUsd(detail.run.estimated_cost_usd)} />
            </div>

            {detail.run.error || detail.agent_run?.last_error ? (
              <Card className="border-[color:var(--danger-border-strong)] bg-[linear-gradient(180deg,rgba(229,237,248,0.98),rgba(220,230,242,0.98))] p-4 shadow-none">
                <SectionHeading title="Failure detail" subtitle={detail.run.error ?? detail.agent_run?.last_error ?? "Unknown error"} />
              </Card>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-3">
                <SectionHeading title="Tool timeline" subtitle="Every tool call attached to this run." />
                {detail.tool_calls.length === 0 ? <EmptyState title="No tool calls" description="This run was a straight model completion." compact /> : null}
                {detail.tool_calls.map((toolCall) => (
                  <div key={toolCall.id} className="rounded-[10px] border border-[color:var(--border)] bg-[rgba(243,245,251,0.025)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold">{toolCall.tool_name}</p>
                      <StatusBadge status={toolCall.status} />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{toolCall.summary_text ?? truncate(toolCall.input_json, 100)}</p>
                    {toolCall.error ? <p className="mt-2 text-sm text-[var(--danger)]">{toolCall.error}</p> : null}
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                <SectionHeading title="Pending state" subtitle="Anything still blocking the agent stays visible here." />
                {detail.pending_approvals.map((approval) => (
                  <PendingItem key={approval.id} title={`${approval.tool_name} ${approval.scope_value}`} subtitle="Approval waiting" />
                ))}
                {detail.pending_questions.map((question) => (
                  <PendingItem key={question.id} title={extractQuestionPrompt(question.question_json)} subtitle={question.question_kind.replace(/_/g, " ")} />
                ))}
                {detail.pending_approvals.length === 0 && detail.pending_questions.length === 0 ? (
                  <EmptyState title="Nothing pending" description="This run is not waiting on operator input." compact />
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState title="Pick a run" description="Select a run to inspect tool activity, errors, and pending work." />
        )}
      </Card>
    </div>
  );
}

function PendingScreen({ pending, navigate }: { pending: PendingPayload; navigate: (path: string) => void }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <SectionEyebrow label="Waiting approvals" />
        <CardTitle className="mt-3">Approval queue</CardTitle>
        <CardDescription className="mt-2">Requests paused until you allow or deny them in Telegram.</CardDescription>
        <div className="mt-5 space-y-3">
          {pending.approvals.length === 0 ? <EmptyState title="Approval queue is clear" description="No waiting domain or provider prompts right now." /> : null}
          {pending.approvals.map((approval) => (
            <button key={approval.id} className="w-full text-left" onClick={() => navigate(`/admin/runs/${approval.run_id}`)}>
              <PendingCard title={approval.scope_value} subtitle={`${approval.tool_name} - ${approval.session_title}`} meta={formatDateTime(approval.created_at)} tone="orange" />
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <SectionEyebrow label="Waiting questions" />
        <CardTitle className="mt-3">Question queue</CardTitle>
        <CardDescription className="mt-2">Questions the agent could not safely answer without your input.</CardDescription>
        <div className="mt-5 space-y-3">
          {pending.questions.length === 0 ? <EmptyState title="Question queue is clear" description="No blocked free-text or picker prompts right now." /> : null}
          {pending.questions.map((question) => (
            <button key={question.id} className="w-full text-left" onClick={() => navigate(`/admin/runs/${question.run_id}`)}>
              <PendingCard title={extractQuestionPrompt(question.question_json)} subtitle={`${question.question_kind.replace(/_/g, " ")} - ${question.session_title}`} meta={formatDateTime(question.created_at)} tone="lime" />
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function MemoryScreen({ payload }: { payload: MemoryPayload }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
      <Card>
        <SectionEyebrow label="Cross-session context" />
        <CardTitle className="mt-3">Persistent memory</CardTitle>
        <CardDescription className="mt-2">Long-lived notes and preferences stored in D1.</CardDescription>
        <div className="mt-5 space-y-3">
          {payload.memories.length === 0 ? <EmptyState title="No memories yet" description="Use /remember in Telegram to seed long-lived notes." /> : null}
          {payload.memories.map((memory) => (
            <div key={memory.id} className="rounded-[10px] border border-[color:var(--border)] bg-[rgba(243,245,251,0.025)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{memory.kind}</Badge>
                <Badge>{memory.scope}</Badge>
                <Badge className={memory.status === "active" ? "border-[color:var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]" : ""}>{memory.status}</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--foreground)]/92">{memory.content_text}</p>
              <p className="mt-3 text-[11px] tracking-[0.16em] text-[var(--muted-foreground)]">Updated {formatDateTime(memory.updated_at)}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionEyebrow label="Remembered approvals" />
        <CardTitle className="mt-3">Saved permissions</CardTitle>
        <CardDescription className="mt-2">Long-lived tool allowances granted from Telegram approval flows.</CardDescription>
        <div className="mt-5 space-y-3">
          {payload.tool_permissions.length === 0 ? <EmptyState title="No saved permissions" description="Permissions show up after you choose always allow." /> : null}
          {payload.tool_permissions.map((permission) => (
            <div key={permission.id} className="rounded-[10px] border border-[color:var(--border)] bg-[rgba(243,245,251,0.025)] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[var(--foreground)]">{permission.scope_value}</p>
                <Badge>{permission.tool_name}</Badge>
              </div>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">{permission.scope_type} - allow</p>
              <p className="mt-3 text-[11px] tracking-[0.16em] text-[var(--muted-foreground)]">Updated {formatDateTime(permission.updated_at)}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className={cn(
        "flex w-full items-center justify-between rounded-[10px] border px-4 py-3 text-left text-sm transition",
        active
          ? "border-[color:var(--accent-border)] bg-[var(--accent-soft)] text-[var(--foreground)]"
          : "border-transparent bg-transparent text-[var(--muted-foreground)] hover:border-[color:var(--border)] hover:bg-[rgba(243,245,251,0.03)] hover:text-[var(--foreground)]",
      )}
      onClick={onClick}
    >
      <span className="flex items-center gap-3">{icon}{label}</span>
      <ChevronRight className="h-4 w-4 opacity-60" />
    </button>
  );
}

function MetricCard({ label, value, meta, accent }: { label: string; value: string; meta: string; accent: "lime" | "orange" | "stone" | "soft" }) {
  return (
    <Card className="overflow-hidden p-4 xl:min-h-[132px]">
      <div className={cn("mb-3 h-1.5 w-16 rounded-full", accentClass(accent))} />
      <p className="text-[11px] font-semibold tracking-[0.22em] text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-2.5 font-[family-name:var(--font-display)] text-[1.85rem] leading-none tracking-[-0.03em]">{value}</p>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">{meta}</p>
    </Card>
  );
}

function SessionRowCard({ session, compact = false, selected = false }: { session: SessionListItem; compact?: boolean; selected?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[10px] border p-4 transition",
        selected
          ? "border-[color:var(--accent-border)] bg-[var(--accent-soft)]"
          : "border-[color:var(--border)] bg-[rgba(243,245,251,0.025)] hover:border-[color:var(--border-strong)] hover:bg-[rgba(243,245,251,0.04)]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--foreground)]">{session.title}</p>
            {session.is_active ? <Badge className="border-[color:var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]">active</Badge> : null}
          </div>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">{session.selected_model}</p>
        </div>
        <div className="text-right text-[11px] tracking-[0.08em] text-[var(--muted-foreground)]">
          <p>{formatDateTime(session.last_message_at)}</p>
          <p className="mt-2">{formatUsd(session.estimated_cost_usd)}</p>
        </div>
      </div>
      {!compact ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--muted-foreground)]">
          <span>{formatNumber(session.message_count)} messages</span>
          <span>-</span>
          <span>{formatNumber(session.run_count)} runs</span>
          <span>-</span>
          <span>{formatNumber(session.failed_run_count)} failed</span>
        </div>
      ) : null}
    </div>
  );
}

function RunRowCard({ run, compact = false, selected = false }: { run: RunListItem; compact?: boolean; selected?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[10px] border p-4 transition",
        selected
          ? "border-[color:var(--danger-border-strong)] bg-[var(--danger-soft)]"
          : "border-[color:var(--border)] bg-[rgba(243,245,251,0.025)] hover:border-[color:var(--border-strong)] hover:bg-[rgba(243,245,251,0.04)]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--foreground)]">{run.session_title}</p>
            <StatusBadge status={run.status} />
          </div>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">{run.provider}:{run.model}</p>
          {run.error ? <p className="mt-2 text-sm text-[var(--danger)]">{truncate(run.error, compact ? 72 : 120)}</p> : null}
        </div>
        <div className="text-right text-[11px] tracking-[0.08em] text-[var(--muted-foreground)]">
          <p>{formatDateTime(run.created_at)}</p>
          <p className="mt-2">{formatUsd(run.estimated_cost_usd)}</p>
        </div>
      </div>
      {!compact ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--muted-foreground)]">
          <span>{formatCompactNumber(run.input_tokens)} in</span>
          <span>-</span>
          <span>{formatCompactNumber(run.output_tokens)} out</span>
          {run.agent_status ? (
            <>
              <span>-</span>
              <span>agent {run.agent_status}</span>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PendingCard({ title, subtitle, meta, tone }: { title: string; subtitle: string; meta: string; tone: "lime" | "orange" }) {
  return (
    <div className={cn("rounded-[10px] border p-4 transition hover:border-[color:var(--border-strong)]", tone === "lime" ? "border-[color:var(--accent-border)] bg-[var(--accent-soft)]" : "border-[color:var(--danger-border)] bg-[var(--danger-soft)]")}>
      <p className="text-sm font-semibold text-[var(--foreground)]">{title}</p>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">{subtitle}</p>
      <p className="mt-3 text-[11px] tracking-[0.16em] text-[var(--muted-foreground)]">{meta}</p>
    </div>
  );
}

function PendingItem({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rounded-[10px] border border-[color:var(--border)] bg-[rgba(243,245,251,0.025)] p-4">
      <p className="text-sm font-semibold text-[var(--foreground)]">{title}</p>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">{subtitle}</p>
    </div>
  );
}

function StatusBadge({ status, subtle = false }: { status: string; subtle?: boolean }) {
  const palette =
    status.includes("failed") || status === "deny"
      ? "border-[color:var(--danger-border-strong)] bg-[var(--danger-soft)] text-[var(--danger)]"
      : status.includes("wait")
        ? "border-[color:var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]"
        : "border-[color:var(--neutral-border)] bg-[var(--neutral-soft)] text-[var(--foreground)]";

  return <Badge className={cn(subtle && "opacity-80", palette)}>{status.replace(/_/g, " ")}</Badge>;
}

function SectionEyebrow({ label }: { label: string }) {
  return <p className="text-[11px] font-semibold tracking-[0.22em] text-[var(--muted-foreground)]">{label}</p>;
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-[var(--foreground)]">{title}</p>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">{subtitle}</p>
    </div>
  );
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-[color:var(--border)] bg-[rgba(243,245,251,0.025)] p-4">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-3 font-[family-name:var(--font-display)] text-[1.5rem] leading-none tracking-[-0.03em]">{value}</p>
    </div>
  );
}

function EmptyState({ title, description, compact = false }: { title: string; description: string; compact?: boolean }) {
  return (
    <div className={cn("rounded-[10px] border border-dashed border-[color:var(--border)] bg-[rgba(243,245,251,0.02)] text-center", compact ? "p-5" : "p-8")}>
      <p className="text-sm font-semibold text-[var(--foreground)]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{description}</p>
    </div>
  );
}

function Sparkline({ rows }: { rows: OverviewSnapshot["daily_usage_14d"] }) {
  const peak = Math.max(...rows.map((row) => row.run_count), 1);

  return (
    <div className="mt-8 space-y-6">
      <div className="grid h-[260px] grid-cols-[repeat(auto-fit,minmax(28px,1fr))] items-end gap-3">
        {rows.map((row, index) => (
          <div key={row.day} className="flex h-full flex-col justify-end gap-3">
            <div className="relative flex-1 rounded-[10px] border border-[color:var(--border)] bg-[rgba(255,255,255,0.02)] px-2 py-3">
              <div className="absolute inset-x-2 bottom-3 rounded-[8px] bg-[rgba(255,255,255,0.03)]" style={{ height: `${Math.max((row.run_count / peak) * 180, 14)}px` }}>
                <div className={cn("h-full w-full rounded-[8px]", index % 3 === 1 ? "bg-[linear-gradient(180deg,var(--accent-2),rgba(182,238,143,0.74))]" : "bg-[linear-gradient(180deg,var(--accent),rgba(143,214,106,0.74))]")} />
              </div>
            </div>
            <div className="text-center">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-[var(--foreground)]">{formatNumber(row.run_count)}</p>
              <p className="mt-1 text-[10px] tracking-[0.16em] text-[var(--muted-foreground)]">{row.day.slice(5)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <StatMini label="14d runs" value={formatNumber(rows.reduce((sum, row) => sum + row.run_count, 0))} />
        <StatMini label="14d tokens" value={formatCompactNumber(rows.reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0))} />
        <StatMini label="14d cost" value={formatUsd(rows.reduce((sum, row) => sum + row.estimated_cost_usd, 0))} />
      </div>
    </div>
  );
}

function UsageRow({ title, subtitle, value, tone }: { title: string; subtitle: string; value: string; tone: "lime" | "orange" | "soft" }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[color:var(--border)] bg-[rgba(243,245,251,0.025)] px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={cn("h-3 w-3 rounded-full", toneClass(tone))} />
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">{title}</p>
          <p className="mt-1 text-[11px] tracking-[0.16em] text-[var(--muted-foreground)]">{subtitle}</p>
        </div>
      </div>
      <p className="text-sm font-semibold text-[var(--foreground)]">{value}</p>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-6 text-[var(--foreground)]">
      <Card className="max-w-xl text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[0_0_40px_var(--accent-glow)]">
          <LockKeyhole className="h-6 w-6" />
        </div>
        <h1 className="mt-5 font-[family-name:var(--font-display)] text-[2rem] leading-none tracking-[-0.03em]">Opening console</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">Checking Cloudflare Access session and loading dashboard data.</p>
      </Card>
    </div>
  );
}

function FatalScreen({ error }: { error: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-6 text-[var(--foreground)]">
      <Card className="max-w-xl text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-[var(--danger-soft)] text-[var(--danger)]">
          <CircleAlert className="h-6 w-6" />
        </div>
        <h1 className="mt-5 font-[family-name:var(--font-display)] text-[2rem] leading-none tracking-[-0.03em]">Dashboard unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">{error}</p>
      </Card>
    </div>
  );
}

function parseRoute(pathname: string): RouteState {
  const trimmed = pathname.replace(/^\/admin\/?/, "");
  const [section, id] = trimmed.split("/");

  if (section === "sessions") {
    return { view: "sessions", sessionId: id ?? null, runId: null };
  }

  if (section === "runs") {
    return { view: "runs", sessionId: null, runId: id ?? null };
  }

  if (section === "pending") {
    return { view: "pending", sessionId: null, runId: null };
  }

  if (section === "memory") {
    return { view: "memory", sessionId: null, runId: null };
  }

  return { view: "overview", sessionId: null, runId: null };
}

function viewToPath(view: View, route: RouteState): string {
  switch (view) {
    case "sessions":
      return route.sessionId ? `/admin/sessions/${route.sessionId}` : "/admin/sessions";
    case "runs":
      return route.runId ? `/admin/runs/${route.runId}` : "/admin/runs";
    case "pending":
      return "/admin/pending";
    case "memory":
      return "/admin/memory";
    default:
      return "/admin";
  }
}

function viewLabel(view: View): string {
  return view === "overview" ? "Overview" : view === "pending" ? "Pending queue" : view;
}

function viewHeadline(view: View): string {
  switch (view) {
    case "sessions":
      return "Session monitor";
    case "runs":
      return "Run monitor";
    case "pending":
      return "Decision queue";
    case "memory":
      return "Memory ledger";
    default:
      return "Private dashboard";
  }
}

function viewDescription(view: View): string {
  switch (view) {
    case "sessions":
      return "Jump into active conversations, inspect transcript history, and trace recent tool activity without hunting through Telegram scrollback.";
    case "runs":
      return "Watch execution state, token spend, tool calls, and failure details in a cleaner operator view.";
    case "pending":
      return "Keep approvals and blocked questions visible so the agent never stalls quietly.";
    case "memory":
      return "Review long-lived notes and remembered tool permissions that shape future runs.";
    default:
      return "A tighter, quieter control surface for live bot activity, recent failures, pending decisions, and cross-session state.";
  }
}

function accentClass(accent: "lime" | "orange" | "stone" | "soft"): string {
  if (accent === "lime") {
    return "bg-[linear-gradient(90deg,var(--accent),rgba(143,214,106,0.18))]";
  }
  if (accent === "orange") {
    return "bg-[linear-gradient(90deg,var(--accent-2),rgba(182,238,143,0.18))]";
  }
  if (accent === "stone") {
    return "bg-[linear-gradient(90deg,rgba(245,239,228,0.9),rgba(245,239,228,0.16))]";
  }

  return "bg-[linear-gradient(90deg,rgba(243,245,251,0.6),rgba(243,245,251,0.12))]";
}

function toneClass(tone: "lime" | "orange" | "soft"): string {
  if (tone === "lime") {
    return "bg-[var(--accent)]";
  }
  if (tone === "orange") {
    return "bg-[var(--accent-2)]";
  }

  return "bg-[var(--accent-3)]";
}

function extractQuestionPrompt(questionJson: string): string {
  try {
    const parsed = JSON.parse(questionJson) as { prompt?: string };
    return parsed.prompt ? truncate(parsed.prompt, 100) : "User question";
  } catch {
    return "User question";
  }
}

function isLocalMockMode(): boolean {
  const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (!isLocalHost) {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  return params.get("mock") === "1";
}

async function getAdminBootstrap(mockMode: boolean): Promise<AdminBootstrap> {
  return mockMode ? mockAdminData.bootstrap : fetchJson<AdminBootstrap>("/admin/api/bootstrap");
}

async function getOverview(mockMode: boolean): Promise<OverviewSnapshot> {
  return mockMode ? mockAdminData.overview : fetchJson<OverviewSnapshot>("/admin/api/overview");
}

async function getSessions(mockMode: boolean): Promise<{ sessions: SessionListItem[] }> {
  return mockMode ? { sessions: mockAdminData.sessions } : fetchJson<{ sessions: SessionListItem[] }>("/admin/api/sessions");
}

async function getRuns(mockMode: boolean): Promise<{ runs: RunListItem[] }> {
  return mockMode ? { runs: mockAdminData.runs } : fetchJson<{ runs: RunListItem[] }>("/admin/api/runs");
}

async function getPending(mockMode: boolean): Promise<PendingPayload> {
  return mockMode ? mockAdminData.pending : fetchJson<PendingPayload>("/admin/api/pending");
}

async function getMemory(mockMode: boolean): Promise<MemoryPayload> {
  return mockMode ? mockAdminData.memory : fetchJson<MemoryPayload>("/admin/api/memories");
}

async function getSettings(mockMode: boolean): Promise<ChatSettingsPayload> {
  return mockMode
    ? {
        chat_id: 0,
        default_vision_model: null,
        default_transcription_model: null,
      }
    : fetchJson<ChatSettingsPayload>("/admin/api/settings");
}

async function patchSettings(patch: Partial<ChatSettingsPayload>): Promise<ChatSettingsPayload> {
  const response = await fetch("/admin/api/settings", {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ChatSettingsPayload;
}

async function getSessionDetail(sessionId: string, mockMode: boolean): Promise<SessionDetail> {
  if (mockMode) {
    const detail = mockAdminData.sessionDetails[sessionId];
    if (!detail) {
      throw new Error("Session not found");
    }

    return detail;
  }

  return fetchJson<SessionDetail>(`/admin/api/sessions/${sessionId}`);
}

async function getRunDetail(runId: string, mockMode: boolean): Promise<RunDetail> {
  if (mockMode) {
    const detail = mockAdminData.runDetails[runId];
    if (!detail) {
      throw new Error("Run not found");
    }

    return detail;
  }

  return fetchJson<RunDetail>(`/admin/api/runs/${runId}`);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as T;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
