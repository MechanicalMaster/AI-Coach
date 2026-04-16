# AI Accountability Coach — Build Spec

## Stack
Cloudflare Workers (TypeScript) + D1 + Cron Triggers + Telegram Bot API + OpenAI GPT-4o API + Whisper API (speech-to-text)

## D1 Schema

```sql
CREATE TABLE domains (
  id INTEGER PRIMARY KEY, name TEXT, active BOOLEAN DEFAULT 1,
  unlock_date TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE projects (
  id INTEGER PRIMARY KEY, domain_id INTEGER REFERENCES domains(id),
  name TEXT, status TEXT CHECK(status IN ('active','paused','killed')),
  done_state TEXT, next_action TEXT, weekly_commitment_hours REAL,
  restart_date TEXT, killed_reason TEXT, killed_lessons TEXT,
  created_at TEXT DEFAULT (datetime('now')), status_changed_at TEXT
);
CREATE TABLE commitments (
  id INTEGER PRIMARY KEY, date TEXT, domain_id INTEGER REFERENCES domains(id),
  project_id INTEGER REFERENCES projects(id), commitment_text TEXT,
  status TEXT CHECK(status IN ('pending','done','partial','skipped')) DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE checkins (
  id INTEGER PRIMARY KEY, timestamp TEXT DEFAULT (datetime('now')),
  type TEXT CHECK(type IN ('morning','evening','weekly')),
  domain_id INTEGER, project_id INTEGER,
  status TEXT CHECK(status IN ('done','partial','skipped')),
  note TEXT, skip_reason TEXT
);
CREATE TABLE streaks (
  id INTEGER PRIMARY KEY, domain_id INTEGER REFERENCES domains(id),
  current_streak INTEGER DEFAULT 0, longest_streak INTEGER DEFAULT 0,
  last_checkin_date TEXT
);
```

## Cron Triggers (wrangler.toml)
```toml
[triggers]
crons = ["30 3 * * *", "30 15 * * *", "30 13 * * 0"]
# 9:00 AM IST, 9:00 PM IST, 7:00 PM IST Sunday
```

## Input Handling: Text + Voice Notes
- Text messages: process directly
- Telegram voice notes: bot receives `voice` or `audio` object → download file via Telegram `getFile` API → send OGG/MP3 to **OpenAI Whisper API** (`/v1/audio/transcriptions`) → get transcript text → process as regular text input
- All downstream logic (commands, LLM calls, DB writes) works on the transcript — voice is just an input layer

## Core Flows

### 1. Morning Cron (9 AM IST)
Query yesterday's commitments + statuses, active projects, streaks, days since last interaction. Inject into system prompt → LLM generates morning message → send via Telegram. User replies (text or voice) with today's focus → parse → INSERT into `commitments`.

### 2. Evening Cron (9 PM IST)
Send inline keyboard per pending commitment: ✅ Done / 🔶 Partial / ❌ Skipped. On callback → UPDATE status. If skipped → require one-sentence reason (text or voice). Update `streaks`.

### 3. Sunday Weekly Review (7 PM IST)
Aggregate week's data → LLM generates review using 5 fixed questions → collect answers → compile summary → send to user AND accountability partner (`ACCOUNTABILITY_PARTNER_CHAT_ID`).

### 4. Re-entry Protocol
On every cron, check days since last checkin. 1 day: acknowledge. 2-3 days: "pause or drift?" 4+ days: override normal flow → send smallest `next_action` from active project.

### 5. Commands
`/status` — active projects, streaks, today's commitments. `/kill <project>` — prompt reason → UPDATE killed. `/pause <project> <date>` — UPDATE paused. `/add <domain> <project> <done_state>` — INSERT, reject if 2 active already. `/reentry` — manual re-entry trigger.

### 6. Natural Language / Voice
Non-command messages → inject last 14 days context + system prompt → LLM → reply.

## Env Vars
`TELEGRAM_BOT_TOKEN`, `ALLOWED_CHAT_ID`, `OPENAI_API_KEY`, `ACCOUNTABILITY_PARTNER_CHAT_ID`

## System Prompt
Maintained as separate file (`SYSTEM_PROMPT.md`). Loaded at runtime. See companion doc for full prompt + tuning instructions.

## Build Order
1. Scaffold Worker + D1 migrations
2. Telegram webhook + chat ID validation
3. Voice note handler (download → Whisper → transcript)
4. Command parser (/status, /kill, /pause, /add, /reentry)
5. Morning cron → LLM → send
6. Evening cron → inline buttons → callbacks
7. Sunday cron → weekly summary → forward to partner
8. Re-entry detection in cron handlers
9. Seed domains + triaged projects
10. Deploy + register webhook + test full loop