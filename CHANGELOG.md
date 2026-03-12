# Changelog

## Unreleased

Adds:

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
