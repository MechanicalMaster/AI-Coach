-- AI Coach Seed Data — Ronak's Triage (April 2026)
-- Run with:
-- npx wrangler d1 execute ai-accountability-coach --remote --file=seed.example.sql

-- ============================================================
-- DOMAINS
-- ============================================================
INSERT INTO domains (id, name, active, unlock_date) VALUES
  (1, 'Career/Projects', 1, NULL),
  (2, 'Vocal/Communication', 1, NULL),
  (3, 'Fitness', 0, '2026-05-17'),
  (4, 'Reading', 0, '2026-06-17');

-- ============================================================
-- ACTIVE PROJECTS
-- ============================================================
INSERT INTO projects (id, domain_id, name, status, done_state, next_action, weekly_commitment_hours, created_at) VALUES
  (1, 1, 'AI Coach', 'active',
   'Used daily for 30 consecutive days with weekly summaries sent to accountability partner',
   'Deploy bot, register Telegram webhook, send first morning check-in',
   5, datetime('now')),

  (2, 1, 'Weight Tracker App', 'active',
   'Approved on Google Play, 20 active users retained for 2 weeks',
   'Check Google Play review status and address any rejection feedback',
   6, datetime('now')),

  (3, 2, 'Interview-Ready Voice', 'active',
   '30 daily practice sessions completed (target 6/week), 4 mock interviews recorded and self-reviewed, measurable reduction in filler words, one external listener confirms improvement',
   'Do 15-min practice session: 5 min tongue twisters, 5 min read-aloud, 5 min impromptu topic recording',
   3, datetime('now'));

-- ============================================================
-- PAUSED PROJECTS
-- ============================================================
INSERT INTO projects (id, domain_id, name, status, done_state, next_action, weekly_commitment_hours, restart_date, created_at) VALUES
  (4, 1, 'PM Prep Chatbot', 'paused',
   'Live URL shared with 3 recruiters, response quality reviewed and polished',
   'Open the Cloudflare Workers project and test 5 sample recruiter questions',
   NULL, '2026-05-10', datetime('now')),

  (5, 1, 'Local AI Model Demo', 'paused',
   'Fine-tuned on proprietary data, published as portfolio piece with write-up',
   'Open the Android project and run the existing pipeline end-to-end',
   NULL, '2026-05-17', datetime('now')),

  (6, 1, 'Swipe - Inventory App', 'paused',
   'In real users hands for 2 consecutive weeks with feedback collected',
   'Identify the single biggest blocker to getting it into users hands',
   NULL, '2026-06-15', datetime('now'));

-- ============================================================
-- KILLED PROJECTS
-- ============================================================
INSERT INTO projects (id, domain_id, name, status, killed_reason, killed_lessons, status_changed_at, created_at) VALUES
  (7, 1, 'Supply Chain GPT', 'killed',
   'Demo done but never published on LinkedIn. No users, no momentum, no publish plan.',
   'Building for LinkedIn clout without a publishing plan means it never ships. Demo is not done.',
   datetime('now'), datetime('now')),

  (8, 1, 'SAF Lead Management App', 'killed',
   'Demo-only project, served its purpose. No further action needed.',
   'Completed its scope. Archive and move on.',
   datetime('now'), datetime('now')),

  (9, 1, 'Invoicing App', 'killed',
   'Similar to Swipe, more or less done. No active users or growth plan.',
   'Finished as a learning exercise. Not a portfolio piece without users.',
   datetime('now'), datetime('now')),

  (10, 1, 'Other Side Projects', 'killed',
   'Bulk kill — idea-stage or done-stage with no publishing. They exist on GitHub, that is enough.',
   'Unpublished projects are learning exercises, not portfolio pieces. Stop carrying them mentally.',
   datetime('now'), datetime('now'));

-- ============================================================
-- STREAKS (initialize at zero)
-- ============================================================
INSERT INTO streaks (domain_id, current_streak, longest_streak, last_checkin_date) VALUES
  (1, 0, 0, NULL),
  (2, 0, 0, NULL);

-- ============================================================
-- NOTE: Portfolio Website is DONE, not tracked.
-- It is live on Cloudflare, maintenance only. Not a project.
-- Weight loss + Daily German are queued for Day 30 domain unlock.
-- ============================================================
