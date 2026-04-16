# AI Accountability Coach

Cloudflare Worker + D1 + Telegram bot + OpenAI-backed accountability coach built for Cloudflare's free tier.

## What is included

- Telegram webhook handler for text, voice notes, audio files, and callback queries
- D1 migrations for domains, projects, commitments, checkins, streaks, and flow state
- Morning, evening, Sunday review, and re-entry scheduled flows
- Command handling for `/status`, `/kill`, `/pause`, `/add`, `/reentry`, and `/cancel`
- OpenAI Responses API integration for coaching + structured parsing
- OpenAI Audio transcription integration for Telegram voice notes
- Prompt kept in a separate `SYSTEM_PROMPT.md` file and bundled into the Worker as text

## Project layout

- `src/index.ts`: Worker entrypoint
- `src/db.ts`: D1 data access
- `src/openai.ts`: text + transcription helpers
- `src/telegram.ts`: Telegram API helpers
- `src/coach.ts`: coach logic, commands, flows, crons
- `migrations/0001_initial.sql`: schema
- `seed.example.sql`: starter insert template

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a D1 database:

```bash
npx wrangler d1 create ai-accountability-coach
```

3. Copy the generated `database_id` into `wrangler.toml`.

4. Copy `.dev.vars.example` to `.dev.vars` and fill the secrets for local development.

5. Apply the D1 migration locally:

```bash
npx wrangler d1 migrations apply ai-accountability-coach --local
```

6. Run the Worker locally with scheduled-route testing enabled:

```bash
npm run dev
```

7. In another terminal, test cron routes locally:

```bash
curl "http://127.0.0.1:8787/__scheduled?cron=30+3+*+*+*"
curl "http://127.0.0.1:8787/__scheduled?cron=30+15+*+*+*"
curl "http://127.0.0.1:8787/__scheduled?cron=30+13+*+*+0"
```

## Deploy

1. Apply the migration to your remote D1 database:

```bash
npx wrangler d1 migrations apply ai-accountability-coach --remote
```

2. Add remote secrets:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ALLOWED_CHAT_ID
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ACCOUNTABILITY_PARTNER_CHAT_ID
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

3. Deploy:

```bash
npm run deploy
```

4. Register the Telegram webhook. Replace the URL and secret token as needed:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<your-worker-domain>/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

If you do not want to use Telegram's secret-token header, omit `secret_token` here and leave `TELEGRAM_WEBHOOK_SECRET` unset.

## GitHub -> Cloudflare auto deploy

This repo includes `.github/workflows/deploy.yml` so every push to `main` can deploy the Worker automatically.

Add these GitHub repository secrets before expecting CI deploys to work:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `TELEGRAM_BOT_TOKEN`
- `ALLOWED_CHAT_ID`
- `OPENAI_API_KEY`
- `ACCOUNTABILITY_PARTNER_CHAT_ID`
- `TELEGRAM_WEBHOOK_SECRET` if you use Telegram's webhook secret header

The workflow writes the runtime secrets into Cloudflare with `wrangler secret put` and then runs `wrangler deploy`.

## Command usage

- `/status`
- `/kill 1`
- `/pause 2 2026-05-01`
- `/add Career | Infrente | Land 3 PM interviews by shipping product`
- `/reentry`
- `/cancel`

Projects are shown with short numeric IDs in `/status`.

## Notes

- Cron expressions are stored in UTC because Cloudflare Cron Triggers run in UTC.
- Flow routing is explicit through the `conversation_state` table, so multi-step conversations do not get mixed with general coaching chat.
- The current app is single-user gated by `ALLOWED_CHAT_ID`, but repository functions already accept `chatId` so a future `user_id` migration is straightforward.
