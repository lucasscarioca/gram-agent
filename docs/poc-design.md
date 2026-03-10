# gram POC design

## Goal

Validate a personal, Telegram-first agent running on Cloudflare Workers.

Non-goals for this POC:

- multi-user product
- SaaS onboarding
- coding agent
- deep agent harness/orchestration

## Hard constraints

- Only your Telegram account is allowed to use it.
- Transport is Telegram webhook, not polling.
- Infra should stay inside your Cloudflare account for runtime + state.
- Repo can be public, runtime remains personal/private.
- Keep the first version small enough for Workers Free + D1 Free.

## Provider decision

Use `AI SDK` with a normal provider API key stored in Cloudflare Worker secrets.

Implication:

- no ChatGPT subscription/session auth
- no bridge service
- no local auth files
- clean fit for serverless

## Proposed POC scope

Version `poc-0` should do only this:

1. Receive Telegram updates via webhook.
2. Accept only messages from your Telegram user ID.
3. Treat conversations as explicit sessions stored in D1.
4. Store minimal chat history per session.
5. Call one LLM backend.
6. Reply in Telegram using Telegram-native affordances, not just plain text.

Everything else is out for now:

- tools
- browser automation
- background jobs unless needed
- group support
- plugins
- admin UI

## Core architecture

Flow:

1. Telegram sends webhook update to Worker.
2. Cloudflare edge blocks obvious garbage before app logic when possible.
3. Worker verifies webhook authenticity.
4. Worker verifies sender is your allowed Telegram user ID.
5. Worker normalizes update into an internal event shape.
6. Worker resolves the active session for that chat.
7. Worker loads recent conversation state from D1.
8. Worker calls LLM adapter.
9. Worker sends one or more Telegram responses.
10. Worker stores request/response metadata in D1.

Recommended modules:

- `src/index.ts`: route wiring
- `src/telegram/webhook.ts`: webhook parse + auth
- `src/telegram/client.ts`: Bot API calls
- `src/telegram/render.ts`: Telegram-first response rendering
- `src/domain/messages.ts`: message handling orchestration
- `src/domain/access.ts`: allowlist checks
- `src/llm/provider.ts`: provider interface
- `src/llm/ai-sdk.ts`: AI SDK integration
- `src/db/schema.sql`: D1 schema

## Security model

Use defense in depth. Do not rely on only one check.

### 1. Secret webhook path

Use a hard-to-guess path, for example:

- `/webhooks/telegram/<random-id>`

This removes casual scanning noise.

### 2. Telegram webhook secret header

When calling `setWebhook`, set `secret_token`.

Then require `X-Telegram-Bot-Api-Secret-Token` to match in the Worker.

### 3. Cloudflare edge rule

If you attach the Worker to a custom domain/zone, add a WAF custom rule for the webhook path:

- block when `x-telegram-bot-api-secret-token` is missing
- block when value does not match expected secret

This is the best way to cut abusive traffic before your Worker does useful work.

### 4. Allow only your Telegram user ID

Do not trust username as primary identity. Usernames can change.

Store:

- `ALLOWED_TELEGRAM_USER_ID`
- optional `ALLOWED_CHAT_ID`

Reject everything else with fast `403` or `200 ignored`.

### 5. Ignore unsupported update types

At webhook setup, restrict `allowed_updates` to the minimum:

- `message`
- maybe `edited_message`
- maybe `callback_query`

This reduces noise and parser surface area.

## Why "user id", not "handle"

Your draft says "my telegram user handle". For enforcement, use numeric Telegram user ID. Username can be useful for logging, but not as the main access control key.

## Data design

Use one D1 database.

Initial tables:

- `sessions`
  - `id`
  - `chat_id`
  - `user_id`
  - `title`
  - `selected_model`
  - `status`
  - `last_message_at`
  - `created_at`
- `messages`
  - `id`
  - `session_id`
  - `chat_id`
  - `telegram_message_id`
  - `role`
  - `content_text`
  - `content_json`
  - `created_at`
- `runs`
  - `id`
  - `update_id`
  - `status`
  - `provider`
  - `input_tokens`
  - `output_tokens`
  - `error`
  - `created_at`

Keep schema minimal. Do not over-model "agents" yet.

Session rules:

- one active session per Telegram chat
- `/new` creates a new active session
- regular messages append to the active session
- `/list` shows recent sessions and lets you switch
- `/model` changes model for the active session

## Interaction model

This is a chat-oriented agent, closer to ChatGPT than to a command bot.

Primary path:

- you send a normal message
- bot replies in the context of the active session

Control path:

- slash commands
- inline keyboard buttons

The commands are session controls, not the main interface.

## Telegram-first product shape

The point of this project is not "LLM over chat". It is "agent that feels native to Telegram".

For `poc-0`, support a small set of Telegram-native affordances:

- typing indicator via `sendChatAction`
- reply to the exact message the user sent
- Markdown or HTML formatting, carefully escaped
- inline keyboard buttons for quick follow-ups and session controls
- edit placeholder/status messages when a response finishes

Good early commands:

- `/reset`
- `/new`
- `/list`
- `/model`
- `/help`

Good early interaction pattern:

1. User sends text or voice note.
2. Bot acknowledges with typing.
3. Bot answers in a structured message.
4. Bot includes 2-4 inline actions, for example `Refine`, `Shorter`, `New session`, `Change model`.

Recommended button surfaces:

- after a normal reply: `Refine`, `Shorter`, `New session`
- after `/list`: one button per recent session
- after `/model`: one button per allowed model

Keep model choices curated. Do not expose arbitrary provider model IDs in the first version.

## LLM provider design

Use `AI SDK` as the only model integration layer for the POC.

Why:

- provider-agnostic without adding much code
- good fit for Workers
- easy to swap model/provider later
- no custom HTTP glue for the first version

Keep a narrow internal interface anyway:

```ts
export interface LlmProvider {
  respond(input: {
    system: string;
    history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    message: string;
  }): Promise<{
    text: string;
    usage?: { inputTokens?: number; outputTokens?: number };
  }>;
}
```

Recommended initial implementation:

- `generateText` only
- a small allowlist of models
- no tools
- no streaming for `poc-0`

Suggested model policy:

- define 2-4 allowed models in config
- store selected model on the session row
- default new sessions to one sensible general-purpose model

## Deployment design

Environment/secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_WEBHOOK_PATH`
- `ALLOWED_TELEGRAM_USER_ID`
- `ALLOWED_CHAT_ID` optional
- provider API key, for example `OPENAI_API_KEY`

Bindings:

- `DB`: D1

Recommended URLs:

- `GET /healthz`
- `POST /webhooks/telegram/<secret-path>`

## Cost posture

This should fit free tier if usage stays personal and light.

Why that is realistic:

- single user
- webhook only
- tiny D1 footprint
- minimal update types
- no polling

Main cost risks:

- public endpoint abuse
- verbose logging
- large prompts/history
- voice/file handling
- unsupported browser/session automation if attempted

Cost controls:

- WAF/header gate on custom domain
- early request rejection
- cap stored history window
- cap max input chars per message
- sample logs aggressively

## Recommended roadmap

### Phase 0: transport + auth

- Telegram webhook endpoint
- secret header verification
- allowed user ID check
- send plain text echo/reply

Exit criterion:

- only you can trigger responses

### Phase 1: memory + one model

- D1 schema
- recent-history retrieval
- AI SDK provider integration
- `/new`
- `/list`
- `/model`

Exit criterion:

- bot can maintain short conversational context and switch sessions cleanly

### Phase 2: Telegram-first UX

- inline keyboards
- edit-in-place progress/status
- voice note transcription if desired
- richer formatting

Exit criterion:

- interaction clearly feels more native than plain text ping-pong and session management works via Telegram controls

## Final recommendation

Define the project as:

> A personal, Telegram-first agent starter built on Cloudflare Workers, starting with a single-user private bot and AI SDK-based LLM integration.
