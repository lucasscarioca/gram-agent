# Security hardening

Recommended production split for `gram-agent`:

- `/webhooks/telegram/*`
  - public to Telegram
  - verified inside the Worker with the webhook secret in the path and `x-telegram-bot-api-secret-token`
  - additionally hardened with Cloudflare WAF on your custom domain
- `/admin/*`
  - private to you
  - protected with Cloudflare Access
  - also verified inside the Worker with Access JWT validation

## Important rules

- do not put Cloudflare Access on `/webhooks/telegram/*`
- do not expose `/admin/*` publicly without Access if you are using the dashboard
- do not assume `workers.dev` gives you pre-Worker filtering; that requires a custom domain on a Cloudflare zone you control

## Recommended WAF direction for the Telegram webhook

Scope rules to `/webhooks/telegram/*`.

Recommended checks:

- block requests missing `x-telegram-bot-api-secret-token`
- block requests whose header value does not match your webhook secret
- optionally rate-limit obvious abusive patterns before Worker execution

The goal is to cut bad traffic before it reaches your Worker and before it can consume model or fetch budget.

## Recommended Cloudflare Access direction for the admin dashboard

Protect `/admin/*` with a self-hosted Access application.

Recommended shape:

- custom domain URL like `https://gram.example.com/admin`
- single Access app scoped to `/admin/*`
- allow only your own identity or a tiny allowlist
- short-to-medium session duration

Set these values in your Worker config:

- `ADMIN_ENABLED=1`
- `ADMIN_BASE_URL=https://gram.example.com/admin`
- `TEAM_DOMAIN=https://your-team.cloudflareaccess.com`
- `POLICY_AUD=<access-audience-tag>`

## `workers.dev` vs custom domain

`workers.dev` is fine for:

- quick bot-only setup
- local or early validation

Use a custom domain if you want:

- WAF protection for the Telegram webhook
- the recommended `/admin/*` Access deployment
- the full hardened split between webhook and dashboard paths

## Validation checklist

- Telegram webhook still works after WAF rules are enabled
- bad webhook requests are blocked before Worker execution
- `/admin` and `/admin/` both go through Access on the custom domain
- `/admin/api/bootstrap` only works after successful Access auth
- `/dashboard` in Telegram points to the expected admin URL
