# Changelog

## Unreleased

Adds:

- retry-safe Telegram webhook failure responses so transient processing errors return `500` instead of silently acknowledging dropped updates
- strict `ALLOWED_CHAT_ID` validation so bad config fails fast instead of disabling the extra chat guard
- focused tests for Cloudflare Access JWT verification, provider registry wiring, multimodal guardrails, and webhook retry behavior

## v0.9.0

Adds:

- token-aware session context management with a default `290k` window and optional per-model overrides
- durable session memory compaction with automatic warnings, automatic compaction before oversized runs, and manual `/compact`
- status visibility for current context usage and saved compaction state
- D1-backed persistent memory with `/remember`, `/memories`, `/forget`, and bounded prompt injection across sessions
- status visibility for saved persistent memory count
- Telegram-safe `/help` rendering so command args like `<title>` no longer fail under HTML parse mode
- broader pragmatic test coverage for webhook routing, runtime resume flows, repo lifecycle, Telegram clients/keyboards, search, and web fetch behavior
- Vitest coverage reporting via `pnpm run test:coverage`, plus CI for typecheck and tests
- cleanup for stale free-text question state, invalid question option callbacks, and broader private-network URL blocking
- private `/admin` monitoring console served from Worker assets with a responsive React SPA tuned for desktop and mobile
- Cloudflare Access protected `/admin/*` routes with in-Worker JWT validation for the admin dashboard and API
- dashboard read models for overview, sessions, runs, pending approvals/questions, memories, and saved tool permissions
- Telegram `/dashboard` command for jumping from chat into the admin console
- custom-domain-oriented docs for WAF hardening on the webhook path and Access protection on the admin path
- production fixes for custom-domain admin routing, asset-path handling, and Access compatibility on `/admin` and `/admin/`
- refreshed admin console palette plus a public root landing page that points to the `gram-agent` GitHub starter
- multimodal input v1 for Telegram with photo vision, audio transcription, and file/PDF text extraction
- Gemini-backed audio transcription so Telegram voice/audio works without an OpenAI key
- chat-level default vision/transcription model settings via Telegram `/settings` and the admin dashboard
- transient media processing with structured derived-message metadata, provenance-aware replay, and no raw asset storage
- explicit disabled paths for unconfigured vision/audio processing and scanned PDFs without extractable text
- admin dashboard commands and help text now stay hidden unless the admin feature flag is fully configured

## v0.3.0

Adds:

- Telegram-first agent tools: `datetime`, `question`, `web_search`, and `web_fetch`
- D1-backed resumable agent runs, tool-call state, pending approvals, and pending questions
- per-chat tool permissions for web search provider access and web fetch domain access
- Exa-backed web search with explicit native `web_fetch` page reads on Cloudflare Workers
- Telegram-native tool status messages, permission prompts, and inline question flows
- SSRF guards and response-size limits for `web_fetch`
- tests for tool runtime helpers and web fetch URL safety
- session rename and delete flows via Telegram commands and inline session management actions
- D1-backed pending session rename state for Telegram callback-to-message flows
- date-prefixed session titles with first-message naming and manual-title precedence metadata
- D1 doctor scripts and pre-migration checks to catch schema vs migration-ledger drift early
- D1 migration stamping during fresh schema setup so later upgrades do not start with ledger drift
- Telegram-safe HTML rendering for assistant replies
- minimal system prompt guidance for Telegram-friendly formatting
- tests for Telegram formatting behavior
- Telegram command-menu-first navigation instead of persistent per-message controls
- contextual picker cleanup after session or model selection
- AI SDK v6 usage typing alignment for cached input token tracking via `inputTokenDetails.cacheReadTokens`

## v0.2.0

Adds:

- built-in multi-provider support for Google, OpenAI, Anthropic, and OpenRouter
- qualified model ids in `provider:model` format
- built-in analytics commands: `/status` and `/analytics`
- per-run input, cached input, output, and estimated cost tracking
- D1 migration workflow with `db/migrations/`
- explicit fresh setup vs upgrade scripts for D1
- deploy-button-friendly secret example file

## v0.1.0

Initial public starter release.

Includes:

- Telegram webhook Worker built with Hono
- D1-backed sessions, messages, and runs
- single-user allowlist by Telegram user/chat ID
- AI SDK integration with Google provider
- built-in commands: `/help`, `/new`, `/list`, `/model`
- Telegram inline keyboards for session and model selection
- public starter README, deploy button, and template repo setup
