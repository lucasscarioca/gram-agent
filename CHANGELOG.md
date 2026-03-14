# Changelog

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
