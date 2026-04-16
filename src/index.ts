import { handleScheduledCron, handleTelegramWebhook } from "./coach";
import { verifyWebhookSecret } from "./telegram";
import type { Env, TelegramUpdate } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/") {
        return Response.json({
          ok: true,
          service: "ai-accountability-coach",
        });
      }

      if (request.method === "POST" && url.pathname === "/telegram/webhook") {
        if (!verifyWebhookSecret(env, request)) {
          return new Response("Forbidden", { status: 403 });
        }

        const update = (await request.json()) as TelegramUpdate;
        await handleTelegramWebhook(env, update);
        return Response.json({ ok: true });
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error("Fetch handler failed", error);
      return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
    }
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    try {
      await handleScheduledCron(env, controller.cron, controller.scheduledTime);
    } catch (error) {
      console.error("Scheduled handler failed", {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
        error,
      });
      throw error;
    }
  },
};
