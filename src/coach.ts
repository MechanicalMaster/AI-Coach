import systemPrompt from "../SYSTEM_PROMPT.md";
import {
  buildFourteenDayContext,
  buildWeeklyContext,
  clearConversationState,
  countActiveProjectsForDomain,
  createDomain,
  createProject,
  findDomainByName,
  getActiveProjects,
  getCommitmentById,
  getCommitmentsForDate,
  getConversationState,
  getDaysSinceLastCheckin,
  getDomains,
  getPendingCommitmentsForDate,
  getProjectById,
  getStreaks,
  insertCheckin,
  insertCommitments,
  updateCommitmentStatus,
  updateDomainStreakIfComplete,
  updateProjectStatus,
  upsertConversationState,
} from "./db";
import { draftWeeklySummary, generateCoachReply, parseMorningCommitments, transcribeAudio } from "./openai";
import {
  answerCallbackQuery,
  downloadTelegramFile,
  editTelegramMessage,
  isAllowedChat,
  sendTelegramMessage,
} from "./telegram";
import type {
  ActiveFlow,
  CommitmentRow,
  Env,
  FlowData,
  KillReasonFlowData,
  MorningCommitFlowData,
  ParsedCommitment,
  ProjectRow,
  SkipReasonFlowData,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
  WeeklyAnswer,
  WeeklyReviewFlowData,
} from "./types";
import { formatDateHuman, isoDateInTimeZone, shiftIsoDate, truncate } from "./utils";

const MORNING_CRON = "30 3 * * *";
const EVENING_CRON = "30 15 * * *";
const WEEKLY_CRON = "30 13 * * 0";

const WEEKLY_QUESTIONS = [
  "What did you actually ship this week? Shipped units - not features promised, not work started.",
  "Vocal practice: how many sessions completed out of your target? What shifted in your delivery?",
  "What did you commit to but not do? For each miss - was it a real blocker or avoidance?",
  "Are your current active projects still serving the tier-1 PM career transition, or are you drifting?",
  "What are your top 3 commitments for next week? Be specific - name the project, the action, and when.",
];

export async function handleTelegramWebhook(env: Env, update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(env, update.callback_query);
    return;
  }

  if (!update.message || !isAllowedChat(env, update.message)) {
    return;
  }

  const chatId = String(update.message.chat.id);
  const text = await extractMessageText(env, update.message);
  if (!text) {
    await sendTelegramMessage(env, chatId, "That did not come through as usable text. Send it again in text or a short voice note.");
    return;
  }

  if (text.startsWith("/cancel")) {
    await clearConversationState(env.DB, chatId);
    await sendTelegramMessage(env, chatId, "Current flow cleared. Now answer the question you have been dodging.");
    return;
  }

  const { activeFlow, flowData } = await getConversationState(env.DB, chatId);
  if (activeFlow) {
    if (text.startsWith("/")) {
      await sendTelegramMessage(
        env,
        chatId,
        "You are in the middle of a flow. Finish it or send /cancel first if you want to abandon it.",
      );
      return;
    }

    await handleActiveFlow(env, chatId, activeFlow, flowData, text);
    return;
  }

  if (text.startsWith("/")) {
    await handleCommand(env, chatId, text);
    return;
  }

  await handleGeneralConversation(env, chatId, text);
}

export async function handleScheduledCron(env: Env, cron: string, scheduledTime: number): Promise<void> {
  const chatId = env.ALLOWED_CHAT_ID;
  const now = new Date(scheduledTime);
  const today = isoDateInTimeZone(now);
  const flowState = await getConversationState(env.DB, chatId);

  if (flowState.activeFlow) {
    await sendTelegramMessage(env, chatId, buildFlowReminder(flowState.activeFlow));
    return;
  }

  if (cron === MORNING_CRON) {
    await handleMorningCron(env, chatId, today);
    return;
  }

  if (cron === EVENING_CRON) {
    await handleEveningCron(env, chatId, today);
    return;
  }

  if (cron === WEEKLY_CRON) {
    await handleWeeklyCron(env, chatId, today);
  }
}

async function extractMessageText(env: Env, message: TelegramMessage): Promise<string | null> {
  if (message.text?.trim()) {
    return message.text.trim();
  }

  const fileId = message.voice?.file_id ?? message.audio?.file_id;
  if (!fileId) {
    return null;
  }

  const blob = await downloadTelegramFile(env, fileId);
  const filename = message.audio?.file_name ?? (message.voice ? "voice.ogg" : "audio.bin");
  return transcribeAudio(env, blob, filename);
}

async function handleActiveFlow(
  env: Env,
  chatId: string,
  activeFlow: ActiveFlow,
  rawFlowData: FlowData,
  text: string,
): Promise<void> {
  if (activeFlow === "kill_reason") {
    const flowData = rawFlowData as unknown as KillReasonFlowData;
    const project = await getProjectById(env.DB, chatId, flowData.project_id);
    if (!project) {
      await clearConversationState(env.DB, chatId);
      await sendTelegramMessage(env, chatId, "That project no longer exists. Convenient. The flow is cleared.");
      return;
    }

    await updateProjectStatus(env.DB, chatId, project.id, "killed", {
      killedReason: truncate(text, 500),
    });
    await clearConversationState(env.DB, chatId);
    await sendTelegramMessage(
      env,
      chatId,
      `Killed [${project.id}] ${project.name}. Reason recorded. Good. Dead projects stop draining attention.`,
    );
    return;
  }

  if (activeFlow === "skip_reason") {
    const flowData = rawFlowData as unknown as SkipReasonFlowData;
    const commitment = await getCommitmentById(env.DB, chatId, flowData.commitment_id);
    if (!commitment) {
      await clearConversationState(env.DB, chatId);
      await sendTelegramMessage(env, chatId, "That skipped item vanished. Flow cleared.");
      return;
    }

    const reason = truncate(text, 500);
    await updateCommitmentStatus(env.DB, chatId, commitment.id, "skipped", reason);
    await insertCheckin(env.DB, chatId, {
      type: "evening",
      domainId: commitment.domain_id,
      projectId: commitment.project_id,
      status: "skipped",
      note: commitment.commitment_text,
      skipReason: reason,
    });
    if (commitment.domain_id) {
      await updateDomainStreakIfComplete(env.DB, chatId, commitment.domain_id, commitment.date);
    }
    await clearConversationState(env.DB, chatId);

    const pushback = /\bbusy\b/i.test(reason)
      ? "\"Busy\" is not a reason. It is camouflage. What did you choose instead?"
      : "Reason logged. Now name the next action that keeps this from becoming a pattern.";

    await sendTelegramMessage(env, chatId, pushback);
    return;
  }

  if (activeFlow === "morning_commit") {
    const flowData = rawFlowData as unknown as MorningCommitFlowData;
    const activeProjects = await getActiveProjects(env.DB, chatId);
    const commitments = await parseMorningCommitments(env, systemPrompt, text, activeProjects);

    if (commitments.length === 0) {
      await sendTelegramMessage(
        env,
        chatId,
        "That was all fog and no commitments. Reply with 1-3 concrete actions for today.",
      );
      return;
    }

    await insertCommitments(env.DB, chatId, flowData.date, normalizeCommitmentDomains(commitments, activeProjects));
    await insertCheckin(env.DB, chatId, {
      type: "morning",
      domainId: null,
      projectId: null,
      status: "done",
      note: `Logged ${commitments.length} commitments for ${flowData.date}`,
    });
    await clearConversationState(env.DB, chatId);

    const summary = commitments
      .map((commitment, index) => `${index + 1}. ${commitment.commitment_text}`)
      .join("\n");
    await sendTelegramMessage(
      env,
      chatId,
      `Logged for ${formatDateHuman(flowData.date)}:\n${summary}\n\nNow do the first one before your brain starts negotiating.`,
    );
    return;
  }

  if (activeFlow === "weekly_review") {
    const flowData = rawFlowData as unknown as WeeklyReviewFlowData;
    const currentQuestion = WEEKLY_QUESTIONS[flowData.step_index];
    const answers: WeeklyAnswer[] = [...flowData.answers, { question: currentQuestion, answer: truncate(text, 1200) }];
    const nextIndex = flowData.step_index + 1;

    if (nextIndex < WEEKLY_QUESTIONS.length) {
      await upsertConversationState(env.DB, chatId, "weekly_review", {
        ...flowData,
        step_index: nextIndex,
        answers,
      });
      await sendTelegramMessage(env, chatId, `Question ${nextIndex + 1}/5:\n${WEEKLY_QUESTIONS[nextIndex]}`);
      return;
    }

    const weeklyContext = await buildWeeklyContext(env.DB, chatId, flowData.week_start, flowData.week_end);
    const summary = await draftWeeklySummary(
      env,
      systemPrompt,
      flowData.week_start,
      flowData.week_end,
      weeklyContext,
      answers,
    );

    await insertCheckin(env.DB, chatId, {
      type: "weekly",
      domainId: null,
      projectId: null,
      status: "done",
      note: summary,
    });
    await clearConversationState(env.DB, chatId);
    await sendTelegramMessage(env, chatId, summary);
    await sendTelegramMessage(env, env.ACCOUNTABILITY_PARTNER_CHAT_ID, summary);
    return;
  }
}

async function handleCommand(env: Env, chatId: string, commandText: string): Promise<void> {
  const [command, ...rest] = commandText.trim().split(/\s+/);

  if (command === "/status") {
    await sendTelegramMessage(env, chatId, await buildStatusMessage(env, chatId));
    return;
  }

  if (command === "/kill") {
    const projectId = Number(rest[0]);
    if (!Number.isInteger(projectId)) {
      await sendTelegramMessage(env, chatId, "Usage: /kill <project_id>");
      return;
    }

    const project = await getProjectById(env.DB, chatId, projectId);
    if (!project || project.status !== "active") {
      await sendTelegramMessage(env, chatId, "That project is not an active target. Try /status and use a real ID.");
      return;
    }

    await upsertConversationState(env.DB, chatId, "kill_reason", { project_id: projectId });
    await sendTelegramMessage(
      env,
      chatId,
      `Why are you killing [${project.id}] ${project.name}? One sentence. No speeches.`,
    );
    return;
  }

  if (command === "/pause") {
    const projectId = Number(rest[0]);
    const restartDate = rest[1];
    if (!Number.isInteger(projectId) || !restartDate) {
      await sendTelegramMessage(env, chatId, "Usage: /pause <project_id> <YYYY-MM-DD>");
      return;
    }

    const project = await getProjectById(env.DB, chatId, projectId);
    if (!project) {
      await sendTelegramMessage(env, chatId, "That project ID does not exist.");
      return;
    }

    await updateProjectStatus(env.DB, chatId, projectId, "paused", { restartDate });
    await sendTelegramMessage(
      env,
      chatId,
      `Paused [${project.id}] ${project.name} until ${restartDate}. Better a clean pause than fake progress.`,
    );
    return;
  }

  if (command === "/add") {
    const raw = commandText.slice(command.length).trim();
    const parts = raw.split("|").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) {
      await sendTelegramMessage(
        env,
        chatId,
        "Usage: /add <domain> | <project> | <done_state>\nExample: /add Career | Infrente | Land 3 PM interviews by shipping product",
      );
      return;
    }

    const [domainName, projectName, doneState] = parts;
    let domain = await findDomainByName(env.DB, chatId, domainName);
    if (!domain) {
      const domainId = await createDomain(env.DB, chatId, domainName);
      const domains = await getDomains(env.DB, chatId);
      domain = domains.find((row) => row.id === domainId) ?? null;
    }

    if (!domain) {
      await sendTelegramMessage(env, chatId, "Failed to create or find that domain.");
      return;
    }

    const activeCount = await countActiveProjectsForDomain(env.DB, chatId, domain.id);
    if (activeCount >= 2) {
      await sendTelegramMessage(
        env,
        chatId,
        `Domain "${domain.name}" already has 2 active projects. Kill or pause one before adding a third.`,
      );
      return;
    }

    const projectId = await createProject(env.DB, chatId, {
      domainId: domain.id,
      name: projectName,
      doneState,
    });

    await sendTelegramMessage(
      env,
      chatId,
      `Added [${projectId}] ${projectName} under ${domain.name}. Now ship toward the done state instead of collecting intentions.`,
    );
    return;
  }

  if (command === "/reentry") {
    await sendTelegramMessage(env, chatId, await buildReentryMessage(env, chatId));
    return;
  }

  await sendTelegramMessage(
    env,
    chatId,
    "Supported commands: /status, /kill <id>, /pause <id> <date>, /add <domain> | <project> | <done_state>, /reentry, /cancel",
  );
}

async function handleGeneralConversation(env: Env, chatId: string, text: string): Promise<void> {
  const today = isoDateInTimeZone(new Date());
  const context = await buildFourteenDayContext(env.DB, chatId, today);
  const pending = await getPendingCommitmentsForDate(env.DB, chatId, today);
  const pendingList =
    pending.length > 0
      ? `Pending commitments today:\n${pending.map((item) => `- ${item.commitment_text}`).join("\n")}`
      : "No pending commitments logged for today. If that is because you did not log them, fix that.";

  const reply = await generateCoachReply(
    env,
    systemPrompt,
    [
      `Today is ${formatDateHuman(today)}.`,
      "",
      context,
      "",
      `User message:\n${text}`,
      "",
      "Rules for this reply:",
      "- Stay in character.",
      "- If the user asks something unrelated, answer briefly and pull the conversation back to accountability.",
      "- End with a concrete accountability nudge if there are pending commitments.",
      "",
      pendingList,
    ].join("\n"),
  );

  const accountabilityClose =
    pending.length > 0
      ? `\n\nPending today: ${pending[0].commitment_text}. When exactly are you doing it?`
      : "";

  await sendTelegramMessage(env, chatId, `${reply}${accountabilityClose}`);
}

async function handleMorningCron(env: Env, chatId: string, today: string): Promise<void> {
  const daysSinceLastCheckin = await getDaysSinceLastCheckin(env.DB, chatId, today);
  if (daysSinceLastCheckin !== null && daysSinceLastCheckin >= 4) {
    await sendTelegramMessage(env, chatId, await buildReentryMessage(env, chatId));
    return;
  }

  const activeProjects = await getActiveProjects(env.DB, chatId);
  const streaks = await getStreaks(env.DB, chatId);
  const yesterday = shiftIsoDate(today, -1);
  const yesterdayCommitments = await getCommitmentsForDate(env.DB, chatId, yesterday);

  const prompt = [
    `It is morning check-in for ${formatDateHuman(today)}.`,
    `Days since last checkin: ${daysSinceLastCheckin ?? "none yet"}.`,
    "",
    `Yesterday's commitments (${formatDateHuman(yesterday)}):`,
    yesterdayCommitments.length > 0
      ? yesterdayCommitments
          .map(
            (item) =>
              `- ${item.commitment_text} | ${item.status} | ${item.project_name ?? item.domain_name ?? "Unscoped"}`,
          )
          .join("\n")
      : "- none",
    "",
    "Active projects:",
    activeProjects.length > 0
      ? activeProjects
          .map(
            (project) =>
              `- [${project.id}] ${project.name} (${project.domain_name}) | done_state: ${project.done_state ?? "n/a"} | next_action: ${project.next_action ?? "n/a"}`,
          )
          .join("\n")
      : "- none",
    "",
    "Streaks:",
    streaks.length > 0
      ? streaks.map((streak) => `- ${streak.domain_name}: ${streak.current_streak} current`).join("\n")
      : "- none",
    "",
    "Write the morning message and ask for today's focus. Keep it sharp.",
  ].join("\n");

  const message = await generateCoachReply(env, systemPrompt, prompt);
  await sendTelegramMessage(env, chatId, message);
  await upsertConversationState(env.DB, chatId, "morning_commit", { date: today });
}

async function handleEveningCron(env: Env, chatId: string, today: string): Promise<void> {
  const daysSinceLastCheckin = await getDaysSinceLastCheckin(env.DB, chatId, today);
  if (daysSinceLastCheckin !== null && daysSinceLastCheckin >= 4) {
    await sendTelegramMessage(env, chatId, await buildReentryMessage(env, chatId));
    return;
  }

  const pending = await getPendingCommitmentsForDate(env.DB, chatId, today);
  if (pending.length === 0) {
    await sendTelegramMessage(
      env,
      chatId,
      "No pending commitments to close out tonight. Either you did the work and failed to log it, or you never set the target.",
    );
    return;
  }

  await sendTelegramMessage(env, chatId, `Evening close-out for ${formatDateHuman(today)}. Mark each item honestly.`);
  for (const commitment of pending) {
    await sendTelegramMessage(env, chatId, buildCommitmentPrompt(commitment), {
      replyMarkup: {
        inline_keyboard: [
          [
            { text: "✅ Done", callback_data: `commitment:${commitment.id}:done` },
            { text: "🔶 Partial", callback_data: `commitment:${commitment.id}:partial` },
            { text: "❌ Skipped", callback_data: `commitment:${commitment.id}:skipped` },
          ],
        ],
      },
    });
  }
}

async function handleWeeklyCron(env: Env, chatId: string, today: string): Promise<void> {
  const daysSinceLastCheckin = await getDaysSinceLastCheckin(env.DB, chatId, today);
  if (daysSinceLastCheckin !== null && daysSinceLastCheckin >= 4) {
    await sendTelegramMessage(env, chatId, await buildReentryMessage(env, chatId));
    return;
  }

  const weekStart = shiftIsoDate(today, -6);
  const context = await buildWeeklyContext(env.DB, chatId, weekStart, today);
  const intro = await generateCoachReply(
    env,
    `${systemPrompt}\n\nYou are beginning the weekly review. Keep it under 120 words, summarize the week's pattern from the context, and then ask question 1 exactly as provided.`,
    `${context}\n\nQuestion 1:\n${WEEKLY_QUESTIONS[0]}`,
  );

  await sendTelegramMessage(env, chatId, intro);
  await upsertConversationState(env.DB, chatId, "weekly_review", {
    week_start: weekStart,
    week_end: today,
    step_index: 0,
    intro_sent: true,
    answers: [],
  });
}

async function handleCallbackQuery(env: Env, callbackQuery: TelegramCallbackQuery): Promise<void> {
  const chatId = String(callbackQuery.message?.chat.id ?? "");
  if (!callbackQuery.message || chatId !== env.ALLOWED_CHAT_ID) {
    return;
  }

  const flowState = await getConversationState(env.DB, chatId);
  if (flowState.activeFlow === "skip_reason" || flowState.activeFlow === "kill_reason") {
    await answerCallbackQuery(env, callbackQuery.id, "Finish the current text reply first");
    return;
  }

  const data = callbackQuery.data ?? "";
  const match = /^commitment:(\d+):(done|partial|skipped)$/.exec(data);
  if (!match) {
    await answerCallbackQuery(env, callbackQuery.id, "Unknown action");
    return;
  }

  const commitmentId = Number(match[1]);
  const status = match[2] as "done" | "partial" | "skipped";
  const commitment = await getCommitmentById(env.DB, chatId, commitmentId);
  if (!commitment) {
    await answerCallbackQuery(env, callbackQuery.id, "Commitment not found");
    return;
  }

  if (status === "skipped") {
    await upsertConversationState(env.DB, chatId, "skip_reason", { commitment_id: commitmentId });
    await answerCallbackQuery(env, callbackQuery.id, "Reason required");
    if (callbackQuery.message) {
      await editTelegramMessage(
        env,
        chatId,
        callbackQuery.message.message_id,
        `${buildCommitmentPrompt(commitment)}\n\nStatus: skipped. Now send one sentence on why.`,
      );
    }
    await sendTelegramMessage(env, chatId, "Why was this skipped? One sentence. \"Busy\" will not survive contact with scrutiny.");
    return;
  }

  await updateCommitmentStatus(env.DB, chatId, commitmentId, status);
  await insertCheckin(env.DB, chatId, {
    type: "evening",
    domainId: commitment.domain_id,
    projectId: commitment.project_id,
    status,
    note: commitment.commitment_text,
  });
  if (commitment.domain_id) {
    await updateDomainStreakIfComplete(env.DB, chatId, commitment.domain_id, commitment.date);
  }

  await answerCallbackQuery(env, callbackQuery.id, `Marked ${status}`);
  if (callbackQuery.message) {
    await editTelegramMessage(
      env,
      chatId,
      callbackQuery.message.message_id,
      `${buildCommitmentPrompt(commitment)}\n\nStatus: ${status}.`,
    );
  }
}

async function buildStatusMessage(env: Env, chatId: string): Promise<string> {
  const today = isoDateInTimeZone(new Date());
  const projects = await getActiveProjects(env.DB, chatId);
  const commitments = await getCommitmentsForDate(env.DB, chatId, today);
  const streaks = await getStreaks(env.DB, chatId);
  const pending = commitments.filter((commitment) => commitment.status === "pending");

  return [
    `Status for ${formatDateHuman(today)}`,
    "",
    "Active projects:",
    projects.length > 0
      ? projects.map((project) => `[${project.id}] ${project.name} (${project.domain_name}) - ${project.status}`).join("\n")
      : "No active projects.",
    "",
    "Today's commitments:",
    commitments.length > 0
      ? commitments
          .map(
            (commitment) =>
              `- ${commitment.status.toUpperCase()}: ${commitment.commitment_text} (${commitment.project_name ?? commitment.domain_name ?? "Unscoped"})`,
          )
          .join("\n")
      : "No commitments logged today.",
    "",
    "Streaks:",
    streaks.length > 0
      ? streaks.map((streak) => `- ${streak.domain_name}: ${streak.current_streak} current / ${streak.longest_streak} best`).join("\n")
      : "No streaks yet.",
    "",
    pending.length > 0
      ? `Accountability nudge: the first open loop is "${pending[0].commitment_text}". What time are you closing it?`
      : "Accountability nudge: if nothing is logged, your memory is lying to you. Set the target explicitly.",
  ].join("\n");
}

async function buildReentryMessage(env: Env, chatId: string): Promise<string> {
  const activeProjects = await getActiveProjects(env.DB, chatId);
  if (activeProjects.length === 0) {
    return "You have drifted long enough to trigger re-entry, except there is no active project left standing. Start with /status, then decide what deserves to live.";
  }

  const project = pickReentryProject(activeProjects);
  return [
    "You have been gone long enough. Normal flow is suspended.",
    `Re-entry target: [${project.id}] ${project.name}.`,
    `Smallest next action: ${project.next_action ?? `Open the project and define one trivial next action toward "${project.done_state ?? "the real outcome"}".`}`,
    "Do that first. Then report back in one sentence.",
  ].join("\n");
}

function pickReentryProject(projects: ProjectRow[]): ProjectRow {
  return [...projects].sort((left, right) => {
    const leftAction = left.next_action?.length ?? Number.MAX_SAFE_INTEGER;
    const rightAction = right.next_action?.length ?? Number.MAX_SAFE_INTEGER;
    return leftAction - rightAction || left.id - right.id;
  })[0];
}

function buildCommitmentPrompt(commitment: CommitmentRow): string {
  return `${commitment.commitment_text}\nProject: ${commitment.project_name ?? commitment.domain_name ?? "Unscoped"}`;
}

function buildFlowReminder(activeFlow: ActiveFlow): string {
  if (activeFlow === "morning_commit") {
    return "You still owe the morning commitments. Finish that before the bot starts a new thread you can hide inside.";
  }

  if (activeFlow === "weekly_review") {
    return "The weekly review is still open. Finish the answers before pretending a fresh prompt will solve the old avoidance.";
  }

  if (activeFlow === "skip_reason") {
    return "You still owe the skip reason. Name it plainly before moving on.";
  }

  return "You are already in an active flow. Finish it or cancel it before starting something else.";
}

function normalizeCommitmentDomains(
  commitments: ParsedCommitment[],
  activeProjects: ProjectRow[],
): ParsedCommitment[] {
  return commitments.map((commitment) => {
    if (commitment.project_id && commitment.domain_id == null) {
      const project = activeProjects.find((item) => item.id === commitment.project_id);
      if (project) {
        return {
          ...commitment,
          domain_id: project.domain_id,
        };
      }
    }
    return commitment;
  });
}
