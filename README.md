# gram-agent

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lucasscarioca/gram-agent)

Minimal starter for building personal, Telegram-first agents on Cloudflare Workers.

This project is intentionally small. It is a private-bot starter, not a SaaS product and not a full agent framework.

## Versioning

This template uses lightweight `0.x` releases.

- `main` keeps moving
- tags/releases mark stable starter milestones
- breaking changes are acceptable while the project is still in `0.x`

If you build your own bot from this template, create your own repo and treat the tagged releases as safe starting points.

## What this gives you

- Telegram webhook bot on Cloudflare Workers
- Hono app skeleton
- D1-backed chat sessions
- AI SDK integration
- single-user allowlist by Telegram user/chat ID
- Telegram-first session controls with slash commands and contextual inline pickers

Built-in commands:

- `/help`
- `/new`
- `/list`
- `/model`
- `/status`
- `/analytics`

## Architecture

Flow:

1. Telegram sends updates to the Worker webhook.
2. The Worker verifies the webhook path and Telegram secret header.
3. The Worker ignores all senders except the configured Telegram user/chat.
4. D1 stores sessions, messages, and run metadata.
5. AI SDK calls the configured model provider.
6. The bot replies in Telegram with normal chat messages, while commands and pickers handle session management.

The point is to keep the interface Telegram-native:

- chat is the primary UX
- sessions are explicit
- Telegram's command menu is the default control surface
- inline keyboards appear only for session and model selection

## Security and cost

Already in place:

- secret webhook path
- Telegram `X-Telegram-Bot-Api-Secret-Token` verification
- allowlist by Telegram user ID
- optional allowlist by Telegram chat ID
- restricted `allowed_updates`

That is enough for a personal POC and stops unauthorized use of the bot logic.

What is **not** in place by default on `workers.dev`:

- Cloudflare WAF in front of the Worker

Why:

- WAF custom rules sit on a Cloudflare zone/custom domain
- `workers.dev` is great for quick setup, but not for pre-Worker filtering

Recommended hardening for better abuse resistance and lower cost:

1. Move the Worker to a custom domain on a zone you control.
2. Add a WAF custom rule for the webhook path.
3. Block requests with missing `x-telegram-bot-api-secret-token`.
4. Block requests whose header value does not match your webhook secret.

That is the best way to cut abusive traffic before it reaches your Worker.

## Quick start

### Option A: Deploy button

Use the button at the top of this README to bootstrap the project into your Cloudflare account.

After that, you still need to:

- create/bind D1 if the button flow did not provision it
- apply the schema if this is a fresh database
- apply migrations when upgrading an existing deployment
- register the Telegram webhook

### Option B: Manual setup

#### 1. Clone and install

```bash
pnpm install
```

If you want local secret placeholders, copy values from `.dev.vars.example` into your own `.dev.vars`.

#### 2. Create a Telegram bot

Use `@BotFather`:

1. Run `/newbot`
2. Choose a bot name
3. Copy the bot token

#### 3. Find your Telegram user ID and chat ID

Send a message to your bot and inspect the webhook payload, or use a helper bot like `@userinfobot`.

For a direct private chat:

- `message.from.id` is your user ID
- `message.chat.id` is your chat ID

These values are often the same in a 1:1 bot chat, but not always.

#### 4. Create D1

```bash
pnpm exec wrangler d1 create gram
```

Copy the returned `database_id` into [wrangler.jsonc](/home/lucas/dev/projects/gram/wrangler.jsonc).

#### 5. Apply the schema

Local:

```bash
pnpm run db:setup:local
```

Remote:

```bash
pnpm run db:setup:remote
```

#### 5b. Apply migrations for upgrades

Use this only when upgrading an existing database after pulling newer changes.
Do not use migrations to create the initial schema from scratch.

Local:

```bash
pnpm run db:migrate:local
```

Remote:

```bash
pnpm run db:migrate:remote
```

#### 6. Set Worker secrets

```bash
pnpm exec wrangler secret put TELEGRAM_BOT_TOKEN
pnpm exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
pnpm exec wrangler secret put ALLOWED_TELEGRAM_USER_ID
pnpm exec wrangler secret put ALLOWED_CHAT_ID
pnpm exec wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY
pnpm exec wrangler secret put OPENAI_API_KEY
pnpm exec wrangler secret put ANTHROPIC_API_KEY
pnpm exec wrangler secret put OPENROUTER_API_KEY
```

Generate `TELEGRAM_WEBHOOK_SECRET` with something like:

```bash
openssl rand -hex 32
```

#### 7. Deploy

```bash
pnpm run deploy
```

This runs remote D1 migrations before deploying the Worker.

#### 8. Register the Telegram webhook

Use the same secret in the path and in `secret_token`:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://<your-worker-domain>/webhooks/telegram/<TELEGRAM_WEBHOOK_SECRET>",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query"]
  }'
```

Verify:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

## Local development

```bash
pnpm run dev
```

Checks:

```bash
pnpm run typecheck
pnpm run test
pnpm run cf-typegen
```

## Provider setup

Built-in provider support:

- Google Gemini
- OpenAI
- Anthropic
- OpenRouter

Built-in models use `provider:model` ids, for example:

- `google:gemini-2.5-flash`
- `google:gemini-3-pro-preview`
- `openai:gpt-5.1`
- `anthropic:claude-sonnet-4-5`
- `openrouter:openai/gpt-oss-120b`

Only models whose provider API key is configured are shown in `/model`.

Analytics:

- completed runs store input tokens, cached input tokens, output tokens, and estimated cost
- `/status` shows current session totals plus global totals
- `/analytics` shows totals for today, 7d, 30d, and all time

## Notes

- `wrangler.jsonc` intentionally uses a placeholder D1 database ID in git.
- `db/schema.sql` is for fresh databases; upgrades should use `db/migrations/`.
- Fresh setup:
  `pnpm run db:setup:local` or `pnpm run db:setup:remote`
- Upgrades:
  `pnpm run db:migrate:local` or `pnpm run db:migrate:remote`
- Add a new numbered SQL file in `db/migrations/` for every schema change after initial setup.
- Future versions can add more built-in features, but the goal is to keep this starter lightweight.
- See [CHANGELOG.md](./CHANGELOG.md) for tagged starter milestones.
