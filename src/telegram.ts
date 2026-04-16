import type { Env, TelegramApiResponse, TelegramMessage } from "./types";
import { requireEnv, sanitizeTelegramHtml } from "./utils";

interface SendMessageOptions {
  replyMarkup?: Record<string, unknown>;
}

export async function sendTelegramMessage(
  env: Env,
  chatId: string,
  text: string,
  options: SendMessageOptions = {},
): Promise<void> {
  await callTelegramApi(env, "sendMessage", {
    chat_id: chatId,
    text: sanitizeTelegramHtml(text),
    parse_mode: "HTML",
    reply_markup: options.replyMarkup,
    disable_web_page_preview: true,
  });
}

export async function answerCallbackQuery(env: Env, callbackQueryId: string, text?: string): Promise<void> {
  await callTelegramApi(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

export async function editTelegramMessage(
  env: Env,
  chatId: string,
  messageId: number,
  text: string,
): Promise<void> {
  await callTelegramApi(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: sanitizeTelegramHtml(text),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

export async function getTelegramFileUrl(env: Env, fileId: string): Promise<string> {
  const response = await callTelegramApi<{ file_path: string }>(env, "getFile", {
    file_id: fileId,
  });
  return `https://api.telegram.org/file/bot${requireEnv(env.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN")}/${response.file_path}`;
}

export async function downloadTelegramFile(env: Env, fileId: string): Promise<Blob> {
  const fileUrl = await getTelegramFileUrl(env, fileId);
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Telegram file download failed with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const buffer = await response.arrayBuffer();
  return new Blob([buffer], { type: contentType });
}

export function isAllowedChat(env: Env, message?: TelegramMessage): boolean {
  if (!message) {
    return false;
  }
  return String(message.chat.id) === requireEnv(env.ALLOWED_CHAT_ID, "ALLOWED_CHAT_ID");
}

export function verifyWebhookSecret(env: Env, request: Request): boolean {
  const configured = env.TELEGRAM_WEBHOOK_SECRET;
  if (!configured) {
    return true;
  }
  return request.headers.get("X-Telegram-Bot-Api-Secret-Token") === configured;
}

async function callTelegramApi<T = true>(
  env: Env,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const token = requireEnv(env.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Telegram API ${method} failed with status ${response.status}`);
  }

  const json = (await response.json()) as TelegramApiResponse<T>;
  if (!json.ok) {
    throw new Error(json.description ?? `Telegram API ${method} returned ok=false`);
  }

  return json.result;
}
