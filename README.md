# gram-agent

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lucasscarioca/gram-agent)

Minimal starter for building personal, Telegram-first agents on Cloudflare Workers.

This project is intentionally small. It is a private-bot starter, not a SaaS product and not a full agent framework.

## What this gives you

- Telegram webhook bot on Cloudflare Workers
- Hono app skeleton
- D1-backed chat sessions
- AI SDK integration
- single-user allowlist by Telegram user/chat ID
- Telegram-first session controls with slash commands and inline buttons

Built-in commands:

- `/help`
- `/new`
- `/list`
- `/model`

## Architecture

Flow:

1. Telegram sends updates to the Worker webhook.
2. The Worker verifies the webhook path and Telegram secret header.
3. The Worker ignores all senders except the configured Telegram user/chat.
4. D1 stores sessions, messages, and run metadata.
5. AI SDK calls the configured model provider.
6. The bot replies in Telegram with normal chat messages and inline controls.

The point is to keep the interface Telegram-native:

- chat is the primary UX
- sessions are explicit
- slash commands manage the session harness
- inline keyboards handle session and model selection

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
- apply the schema
- set your secrets
- register the Telegram webhook

### Option B: Manual setup

#### 1. Clone and install

```bash
pnpm install
```

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
pnpm exec wrangler d1 execute gram --local --file=db/schema.sql
```

Remote:

```bash
pnpm exec wrangler d1 execute gram --remote --file=db/schema.sql
```

#### 6. Set Worker secrets

```bash
pnpm exec wrangler secret put TELEGRAM_BOT_TOKEN
pnpm exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
pnpm exec wrangler secret put ALLOWED_TELEGRAM_USER_ID
pnpm exec wrangler secret put ALLOWED_CHAT_ID
pnpm exec wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY
```

Generate `TELEGRAM_WEBHOOK_SECRET` with something like:

```bash
openssl rand -hex 32
```

#### 7. Deploy

```bash
pnpm run deploy
```

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

Current default:

- `ai`
- `@ai-sdk/google`

The Telegram/session architecture is provider-agnostic enough to swap later.

## Notes

- [docs/poc-design.md](./docs/poc-design.md) contains the original POC design notes.
- `wrangler.jsonc` intentionally uses a placeholder D1 database ID in git.
- Future versions can add more built-in features, but the goal is to keep this starter lightweight.
