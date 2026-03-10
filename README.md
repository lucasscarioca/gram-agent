```txt
npm install
npm run dev
```

```txt
npm run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```

## Project docs

- POC design: [`docs/poc-design.md`](./docs/poc-design.md)

## POC setup

This repo now contains:

- Telegram webhook handler on `POST /webhooks/telegram/:secret`
- D1-backed chat sessions
- slash commands: `/new`, `/list`, `/model`, `/help`
- Google provider integration through AI SDK

### 1. Install deps

```txt
pnpm install
```

### 2. Create and bind D1

Create the database, then replace `database_id` in `wrangler.jsonc`.

Apply the schema:

```txt
pnpm exec wrangler d1 execute gram --local --file=db/schema.sql
```

### 3. Set Worker secrets

```txt
pnpm exec wrangler secret put TELEGRAM_BOT_TOKEN
pnpm exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
pnpm exec wrangler secret put ALLOWED_TELEGRAM_USER_ID
pnpm exec wrangler secret put ALLOWED_CHAT_ID
pnpm exec wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY
```

`DEFAULT_MODEL` and `ALLOWED_MODELS` are configured in `wrangler.jsonc`.

### 4. Register the Telegram webhook

Use your deployed custom-domain URL and the same webhook secret for both the path and Telegram secret header:

```txt
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://<your-domain>/webhooks/telegram/<TELEGRAM_WEBHOOK_SECRET>",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query"]
  }'
```

### 5. Checks

```txt
pnpm run typecheck
pnpm run test
pnpm run cf-typegen
```
