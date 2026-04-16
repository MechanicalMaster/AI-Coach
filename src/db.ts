import type {
  ActiveFlow,
  CheckinStatus,
  CheckinType,
  CommitmentRow,
  CommitmentStatus,
  ConversationStateRow,
  DomainRow,
  FlowData,
  ParsedCommitment,
  ProjectRow,
  ProjectStatus,
  StreakRow,
} from "./types";
import { daysBetween, parseJson } from "./utils";

export async function getDomains(db: D1Database, _chatId: string): Promise<DomainRow[]> {
  const result = await db.prepare("SELECT * FROM domains WHERE active = 1 ORDER BY id ASC").all<DomainRow>();
  return result.results ?? [];
}

export async function findDomainByName(
  db: D1Database,
  _chatId: string,
  name: string,
): Promise<DomainRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM domains WHERE lower(name) = lower(?) LIMIT 1")
      .bind(name)
      .first<DomainRow>()) ?? null
  );
}

export async function createDomain(db: D1Database, _chatId: string, name: string): Promise<number> {
  const result = await db.prepare("INSERT INTO domains (name, active) VALUES (?, 1)").bind(name).run();
  return Number(result.meta.last_row_id);
}

export async function countActiveProjectsForDomain(
  db: D1Database,
  _chatId: string,
  domainId: number,
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM projects WHERE domain_id = ? AND status = 'active'")
    .bind(domainId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function createProject(
  db: D1Database,
  _chatId: string,
  input: {
    domainId: number;
    name: string;
    doneState: string;
    weeklyCommitmentHours?: number | null;
  },
): Promise<number> {
  const result = await db
    .prepare(
      `
        INSERT INTO projects (
          domain_id,
          name,
          status,
          done_state,
          weekly_commitment_hours,
          status_changed_at
        ) VALUES (?, ?, 'active', ?, ?, datetime('now'))
      `,
    )
    .bind(input.domainId, input.name, input.doneState, input.weeklyCommitmentHours ?? null)
    .run();

  return Number(result.meta.last_row_id);
}

export async function getActiveProjects(db: D1Database, _chatId: string): Promise<ProjectRow[]> {
  const result = await db
    .prepare(
      `
        SELECT
          p.*,
          d.name AS domain_name
        FROM projects p
        JOIN domains d ON d.id = p.domain_id
        WHERE p.status = 'active'
        ORDER BY p.id ASC
      `,
    )
    .all<ProjectRow>();
  return result.results ?? [];
}

export async function getProjectById(
  db: D1Database,
  _chatId: string,
  projectId: number,
): Promise<ProjectRow | null> {
  return (
    (await db
      .prepare(
        `
          SELECT p.*, d.name AS domain_name
          FROM projects p
          JOIN domains d ON d.id = p.domain_id
          WHERE p.id = ?
          LIMIT 1
        `,
      )
      .bind(projectId)
      .first<ProjectRow>()) ?? null
  );
}

export async function updateProjectStatus(
  db: D1Database,
  _chatId: string,
  projectId: number,
  status: ProjectStatus,
  extra: {
    restartDate?: string | null;
    killedReason?: string | null;
    killedLessons?: string | null;
  } = {},
): Promise<void> {
  await db
    .prepare(
      `
        UPDATE projects
        SET
          status = ?,
          restart_date = COALESCE(?, restart_date),
          killed_reason = COALESCE(?, killed_reason),
          killed_lessons = COALESCE(?, killed_lessons),
          status_changed_at = datetime('now')
        WHERE id = ?
      `,
    )
    .bind(status, extra.restartDate ?? null, extra.killedReason ?? null, extra.killedLessons ?? null, projectId)
    .run();
}

export async function insertCommitments(
  db: D1Database,
  _chatId: string,
  date: string,
  commitments: ParsedCommitment[],
): Promise<void> {
  const statements = commitments.map((commitment) =>
    db
      .prepare(
        `
          INSERT INTO commitments (date, domain_id, project_id, commitment_text, status)
          VALUES (?, ?, ?, ?, 'pending')
        `,
      )
      .bind(date, commitment.domain_id, commitment.project_id, commitment.commitment_text),
  );

  if (statements.length > 0) {
    await db.batch(statements);
  }
}

export async function getCommitmentsForDate(
  db: D1Database,
  _chatId: string,
  date: string,
): Promise<CommitmentRow[]> {
  const result = await db
    .prepare(
      `
        SELECT
          c.*,
          d.name AS domain_name,
          p.name AS project_name
        FROM commitments c
        LEFT JOIN domains d ON d.id = c.domain_id
        LEFT JOIN projects p ON p.id = c.project_id
        WHERE c.date = ?
        ORDER BY c.id ASC
      `,
    )
    .bind(date)
    .all<CommitmentRow>();
  return result.results ?? [];
}

export async function getPendingCommitmentsForDate(
  db: D1Database,
  chatId: string,
  date: string,
): Promise<CommitmentRow[]> {
  return (await getCommitmentsForDate(db, chatId, date)).filter((commitment) => commitment.status === "pending");
}

export async function getCommitmentById(
  db: D1Database,
  _chatId: string,
  commitmentId: number,
): Promise<CommitmentRow | null> {
  return (
    (await db
      .prepare(
        `
          SELECT
            c.*,
            d.name AS domain_name,
            p.name AS project_name
          FROM commitments c
          LEFT JOIN domains d ON d.id = c.domain_id
          LEFT JOIN projects p ON p.id = c.project_id
          WHERE c.id = ?
          LIMIT 1
        `,
      )
      .bind(commitmentId)
      .first<CommitmentRow>()) ?? null
  );
}

export async function updateCommitmentStatus(
  db: D1Database,
  _chatId: string,
  commitmentId: number,
  status: CommitmentStatus,
  reflectionNote?: string | null,
): Promise<void> {
  await db
    .prepare(
      `
        UPDATE commitments
        SET status = ?, reflection_note = COALESCE(?, reflection_note)
        WHERE id = ?
      `,
    )
    .bind(status, reflectionNote ?? null, commitmentId)
    .run();
}

export async function insertCheckin(
  db: D1Database,
  _chatId: string,
  input: {
    type: CheckinType;
    domainId: number | null;
    projectId: number | null;
    status: CheckinStatus;
    note?: string | null;
    skipReason?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `
        INSERT INTO checkins (type, domain_id, project_id, status, note, skip_reason)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.type,
      input.domainId,
      input.projectId,
      input.status,
      input.note ?? null,
      input.skipReason ?? null,
    )
    .run();
}

export async function getStreaks(db: D1Database, _chatId: string): Promise<StreakRow[]> {
  const result = await db
    .prepare(
      `
        SELECT s.*, d.name AS domain_name
        FROM streaks s
        JOIN domains d ON d.id = s.domain_id
        ORDER BY s.domain_id ASC
      `,
    )
    .all<StreakRow>();
  return result.results ?? [];
}

export async function updateDomainStreakIfComplete(
  db: D1Database,
  chatId: string,
  domainId: number,
  date: string,
): Promise<void> {
  const commitments = (await getCommitmentsForDate(db, chatId, date)).filter(
    (commitment) => commitment.domain_id === domainId,
  );

  if (commitments.length === 0) {
    return;
  }

  if (commitments.some((commitment) => commitment.status === "pending")) {
    return;
  }

  const success = commitments.every((commitment) => commitment.status !== "skipped");
  const existing =
    (await db
      .prepare("SELECT * FROM streaks WHERE domain_id = ? LIMIT 1")
      .bind(domainId)
      .first<StreakRow>()) ?? null;

  if (!existing) {
    const current = success ? 1 : 0;
    await db
      .prepare(
        `
          INSERT INTO streaks (domain_id, current_streak, longest_streak, last_checkin_date)
          VALUES (?, ?, ?, ?)
        `,
      )
      .bind(domainId, current, current, date)
      .run();
    return;
  }

  if (existing.last_checkin_date === date) {
    const current = success ? Math.max(existing.current_streak, 1) : 0;
    const longest = Math.max(existing.longest_streak, current);
    await db
      .prepare(
        `
          UPDATE streaks
          SET current_streak = ?, longest_streak = ?, last_checkin_date = ?
          WHERE domain_id = ?
        `,
      )
      .bind(current, longest, date, domainId)
      .run();
    return;
  }

  const current = success ? existing.current_streak + 1 : 0;
  const longest = Math.max(existing.longest_streak, current);

  await db
    .prepare(
      `
        UPDATE streaks
        SET current_streak = ?, longest_streak = ?, last_checkin_date = ?
        WHERE domain_id = ?
      `,
    )
    .bind(current, longest, date, domainId)
    .run();
}

export async function getConversationState(
  db: D1Database,
  chatId: string,
): Promise<{ activeFlow: ActiveFlow | null; flowData: FlowData }> {
  const row =
    (await db
      .prepare("SELECT * FROM conversation_state WHERE chat_id = ? LIMIT 1")
      .bind(chatId)
      .first<ConversationStateRow>()) ?? null;

  return {
    activeFlow: row?.active_flow ?? null,
    flowData: parseJson<FlowData>(row?.flow_data, {}),
  };
}

export async function upsertConversationState(
  db: D1Database,
  chatId: string,
  activeFlow: ActiveFlow | null,
  flowData: FlowData | null,
): Promise<void> {
  await db
    .prepare(
      `
        INSERT INTO conversation_state (chat_id, active_flow, flow_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(chat_id) DO UPDATE SET
          active_flow = excluded.active_flow,
          flow_data = excluded.flow_data,
          updated_at = datetime('now')
      `,
    )
    .bind(chatId, activeFlow, flowData ? JSON.stringify(flowData) : null)
    .run();
}

export async function clearConversationState(db: D1Database, chatId: string): Promise<void> {
  await upsertConversationState(db, chatId, null, null);
}

export async function getLastCheckinDate(db: D1Database, _chatId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT DATE(MAX(timestamp)) AS date FROM checkins")
    .first<{ date: string | null }>();
  return row?.date ?? null;
}

export async function getDaysSinceLastCheckin(
  db: D1Database,
  chatId: string,
  today: string,
): Promise<number | null> {
  const last = await getLastCheckinDate(db, chatId);
  if (!last) {
    return null;
  }
  return daysBetween(last, today);
}

export async function buildFourteenDayContext(
  db: D1Database,
  chatId: string,
  endDate: string,
): Promise<string> {
  const rows = await db
    .prepare(
      `
        SELECT
          c.date,
          c.commitment_text,
          c.status,
          c.reflection_note,
          p.name AS project_name,
          d.name AS domain_name
        FROM commitments c
        LEFT JOIN projects p ON p.id = c.project_id
        LEFT JOIN domains d ON d.id = c.domain_id
        WHERE c.date BETWEEN DATE(?, '-13 day') AND ?
        ORDER BY c.date DESC, c.id DESC
      `,
    )
    .bind(endDate, endDate)
    .all<{
      date: string;
      commitment_text: string;
      status: CommitmentStatus;
      reflection_note: string | null;
      project_name: string | null;
      domain_name: string | null;
    }>();

  const activeProjects = await getActiveProjects(db, chatId);
  const streaks = await getStreaks(db, chatId);

  const commitmentLines = (rows.results ?? []).map((row) => {
    const target = row.project_name ?? row.domain_name ?? "Unscoped";
    const reflection = row.reflection_note ? ` | note: ${row.reflection_note}` : "";
    return `- ${row.date} | ${target} | ${row.status} | ${row.commitment_text}${reflection}`;
  });

  const projectLines = activeProjects.map(
    (project) =>
      `- [${project.id}] ${project.name} (${project.domain_name}) | done_state: ${project.done_state ?? "n/a"} | next_action: ${project.next_action ?? "n/a"}`,
  );

  const streakLines = streaks.map(
    (streak) =>
      `- ${streak.domain_name ?? `Domain ${streak.domain_id}`}: current ${streak.current_streak}, longest ${streak.longest_streak}`,
  );

  return [
    "Active projects:",
    projectLines.length > 0 ? projectLines.join("\n") : "- none",
    "",
    "Recent commitments (last 14 days):",
    commitmentLines.length > 0 ? commitmentLines.join("\n") : "- none",
    "",
    "Streaks:",
    streakLines.length > 0 ? streakLines.join("\n") : "- none",
  ].join("\n");
}

export async function buildWeeklyContext(
  db: D1Database,
  chatId: string,
  weekStart: string,
  weekEnd: string,
): Promise<string> {
  const rows = await db
    .prepare(
      `
        SELECT
          c.date,
          c.commitment_text,
          c.status,
          c.reflection_note,
          p.name AS project_name,
          d.name AS domain_name
        FROM commitments c
        LEFT JOIN projects p ON p.id = c.project_id
        LEFT JOIN domains d ON d.id = c.domain_id
        WHERE c.date BETWEEN ? AND ?
        ORDER BY c.date ASC, c.id ASC
      `,
    )
    .bind(weekStart, weekEnd)
    .all<{
      date: string;
      commitment_text: string;
      status: CommitmentStatus;
      reflection_note: string | null;
      project_name: string | null;
      domain_name: string | null;
    }>();

  const activeProjects = await getActiveProjects(db, chatId);
  const grouped = (rows.results ?? []).map((row) => {
    const owner = row.project_name ?? row.domain_name ?? "Unscoped";
    const note = row.reflection_note ? ` | note: ${row.reflection_note}` : "";
    return `- ${row.date} | ${owner} | ${row.status} | ${row.commitment_text}${note}`;
  });

  return [
    `Week range: ${weekStart} to ${weekEnd}`,
    "",
    "Commitments:",
    grouped.length > 0 ? grouped.join("\n") : "- none",
    "",
    "Current active projects:",
    activeProjects.length > 0
      ? activeProjects
          .map((project) => `- [${project.id}] ${project.name} (${project.domain_name}) -> ${project.done_state ?? "No done state"}`)
          .join("\n")
      : "- none",
  ].join("\n");
}
