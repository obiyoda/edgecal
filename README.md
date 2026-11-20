# EdgeCal — Self-Hosted Scheduling on Cloudflare Workers & Durable Objects

A clean-room, open-source self-hosted scheduling platform inspired by Cal.diy, engineered natively for **Cloudflare Workers** + **SQLite-backed Durable Objects** — with zero PostgreSQL, zero Redis, and zero Docker required.

## Why Durable Objects?

- **Zero External Database**: Each host has a dedicated `HostSchedulerDO` with embedded SQLite storage (`this.ctx.storage.sql`), while `DirectoryDO` handles usernames, sessions, and booking UID routing.
- **Zero Double-Bookings by Construction**: Because each host's Durable Object is single-threaded, slot validation and booking creation execute atomically inside `storage.transactionSync()`.
- **Native Reminders & Calendar Sync via Alarms**: `HostSchedulerDO.alarm()` fires 24-hour and 1-hour reminders, auto-expires past unconfirmed bookings, and refreshes connected external `.ics` busy feeds automatically.
- **One-Command Deploy**: Frontend static assets (`./dist`) and Worker API deploy together via `wrangler.jsonc`.

## Simple 3-Step Install

```bash
npm install
npx wrangler login
npm run deploy
```

Visit your deployed `*.workers.dev` URL — the first-run setup wizard will walk you through creating your admin account, working hours, and starter event types.

## Cloudflare Email Sending (Zero Third-Party Email Deps)

Booking confirmations, `.ics` calendar invites, and Durable Object reminder emails use Cloudflare's native `SEND_EMAIL` binding in `wrangler.jsonc` — no Resend or external SMTP provider needed:

1. In the Cloudflare Dashboard, enable **Email Routing / Email Sending** on your domain.
2. Update `EMAIL_FROM` in `wrangler.jsonc` (or under **Apps & Webhooks** in the dashboard) to your Cloudflare domain sender address (for example `bookings@yourdomain.com`).
3. Run `npm run deploy`.

## Optional Secrets

```bash
# Optional: Auto-create private Daily.co video rooms per booking (Jitsi works out of the box)
npx wrangler secret put DAILY_API_KEY
```

## Scripts

- `npm run build` — Typecheck Worker + Client and build static assets into `dist/`
- `npm run deploy` — Build and deploy to Cloudflare Workers
- `npm run dev:worker` — Run locally with Wrangler (live local SQLite Durable Objects)
- `npm test` — Run scheduling engine, ICS, and double-booking conflict test suite
