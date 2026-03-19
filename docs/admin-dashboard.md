# Admin dashboard

Private monitoring console for `gram-agent` deployments.

## Intent

- keep Telegram as primary UX
- add a private web console for monitoring and inspection
- harden admin access with Cloudflare Access
- keep the dashboard optional for bot-only deployments

## Current shape

- SPA route: `/admin`
- API routes: `/admin/api/*`
- Telegram shortcut: `/dashboard`
- root path `/` can stay public for starter links or a simple landing page
- data source: the same D1 database used by the bot

Views included now:

- overview
- sessions
- runs
- pending approvals/questions
- memories
- saved tool permissions

## Security model

Recommended production split:

- `/webhooks/telegram/*`
  - public to Telegram
  - protected with webhook secret checks in Worker
  - protected with WAF rules on the custom domain
- `/admin/*`
  - private to the deployer only
  - protected with Cloudflare Access
  - JWT also validated inside the Worker as defense in depth

Do not put Cloudflare Access on `/webhooks/telegram/*`.

## Why custom domain

Required for the recommended setup because:

- WAF hardening for the Telegram webhook sits on a Cloudflare zone/custom domain
- the dashboard is designed around a stable custom-domain `/admin/*` path behind Cloudflare Access

`workers.dev` is still acceptable for:

- quick bot-only setup
- early testing before hardening

But the dashboard should be treated as custom-domain-oriented.

## Required config

Worker vars/secrets:

- `ADMIN_ENABLED=1`
- `ADMIN_BASE_URL=https://your-domain/admin`
- `TEAM_DOMAIN=https://your-team.cloudflareaccess.com`
- `POLICY_AUD=<cloudflare-access-audience-tag>`

Notes:

- `ADMIN_BASE_URL` powers Telegram `/dashboard` replies and UI metadata
- `TEAM_DOMAIN` and `POLICY_AUD` power in-Worker JWT validation
- if these are missing, `/admin/*` returns a setup error and `/dashboard` stays hidden from help and command menus

## Cloudflare Access setup

1. Move the Worker onto your custom domain.
2. Create a Cloudflare Access self-hosted application for `/admin/*`.
3. Allow only your own identity.
4. Copy the application audience tag into `POLICY_AUD`.
5. Copy your Access team domain into `TEAM_DOMAIN`.
6. Set `ADMIN_BASE_URL` to the final `/admin` URL.

Recommended policy shape:

- one Access app for `your-domain/admin/*`
- make sure `/admin` and `/admin/` both land inside the protected app path behavior you expect
- instant auth if you only allow a single IdP
- short-to-medium session duration

## WAF notes for webhook

Recommended direction:

- scope rules to `/webhooks/telegram/*`
- block missing `x-telegram-bot-api-secret-token`
- block wrong secret header values
- optionally rate-limit obviously abusive patterns before Worker execution

See [`docs/security-hardening.md`](security-hardening.md) for a public-repo version of the same guidance.

## Local/dev notes

- build admin assets with `pnpm run build:admin`
- run Worker dev with `pnpm run dev`
- for SPA-only iteration, use `pnpm run dev:admin`

Access will not be fully testable locally the same way it is on the real domain.

## Validation checklist

- `/dashboard` returns the configured admin URL in Telegram
- `/admin` redirects through Cloudflare Access on the custom domain
- `/admin/api/bootstrap` works only after successful Access auth
- `/webhooks/telegram/:secret` still works for Telegram after Access is added to `/admin/*`
- WAF rules block bad webhook traffic without affecting Telegram
- overview, sessions, runs, pending, and memory screens load on desktop and mobile
