export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  ALLOWED_CHAT_ID: string;
  OPENAI_API_KEY: string;
  ACCOUNTABILITY_PARTNER_CHAT_ID: string;
  OPENAI_MODEL?: string;
  OPENAI_TRANSCRIPTION_MODEL?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}

export type CommitmentStatus = "pending" | "done" | "partial" | "skipped";
export type ProjectStatus = "active" | "paused" | "killed";
export type CheckinType = "morning" | "evening" | "weekly";
export type CheckinStatus = "done" | "partial" | "skipped";

export type ActiveFlow =
  | "kill_reason"
  | "skip_reason"
  | "weekly_review"
  | "morning_commit";

export interface DomainRow {
  id: number;
  name: string;
  active: number;
  unlock_date: string | null;
  created_at: string;
}

export interface ProjectRow {
  id: number;
  domain_id: number;
  domain_name?: string;
  name: string;
  status: ProjectStatus;
  done_state: string | null;
  next_action: string | null;
  weekly_commitment_hours: number | null;
  restart_date: string | null;
  killed_reason: string | null;
  killed_lessons: string | null;
  created_at: string;
  status_changed_at: string | null;
}

export interface CommitmentRow {
  id: number;
  date: string;
  domain_id: number | null;
  domain_name?: string | null;
  project_id: number | null;
  project_name?: string | null;
  commitment_text: string;
  status: CommitmentStatus;
  reflection_note: string | null;
  created_at: string;
}

export interface StreakRow {
  id: number;
  domain_id: number;
  domain_name?: string;
  current_streak: number;
  longest_streak: number;
  last_checkin_date: string | null;
}

export interface ConversationStateRow {
  chat_id: string;
  active_flow: ActiveFlow | null;
  flow_data: string | null;
  updated_at: string;
}

export interface ParsedCommitment {
  commitment_text: string;
  project_id: number | null;
  domain_id: number | null;
}

export interface WeeklyAnswer {
  question: string;
  answer: string;
}

export interface WeeklyReviewFlowData {
  week_start: string;
  week_end: string;
  step_index: number;
  intro_sent: boolean;
  answers: WeeklyAnswer[];
}

export interface MorningCommitFlowData {
  date: string;
}

export interface KillReasonFlowData {
  project_id: number;
}

export interface SkipReasonFlowData {
  commitment_id: number;
}

export type FlowData =
  | WeeklyReviewFlowData
  | MorningCommitFlowData
  | KillReasonFlowData
  | SkipReasonFlowData
  | Record<string, unknown>;

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_name?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  voice?: TelegramVoice;
  audio?: TelegramAudio;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}
