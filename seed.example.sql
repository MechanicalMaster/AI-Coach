-- Replace these placeholders with your real triaged domains and projects.
-- Run with:
-- npx wrangler d1 execute ai-accountability-coach --remote --file=seed.example.sql

INSERT INTO domains (name, active)
VALUES
  ('Career', 1),
  ('Health', 1);

INSERT INTO projects (
  domain_id,
  name,
  status,
  done_state,
  next_action,
  weekly_commitment_hours,
  status_changed_at
)
VALUES
  (
    (SELECT id FROM domains WHERE name = 'Career'),
    'Replace me',
    'active',
    'Replace me with the concrete outcome that counts as done',
    'Replace me with the smallest next action',
    5,
    datetime('now')
  );
