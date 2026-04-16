import type { Env, ParsedCommitment, ProjectRow, WeeklyAnswer } from "./types";
import { formatDateHuman, requireEnv, truncate } from "./utils";

interface OpenAIResponse {
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

export async function transcribeAudio(env: Env, file: Blob, filename: string): Promise<string> {
  const apiKey = requireEnv(env.OPENAI_API_KEY, "OPENAI_API_KEY");
  const form = new FormData();
  form.append("model", env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1");
  form.append("response_format", "text");
  form.append("file", file, filename);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI transcription failed with status ${response.status}: ${body}`);
  }

  return (await response.text()).trim();
}

export async function generateCoachReply(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const response = await callOpenAI(env, {
    model: env.OPENAI_MODEL || "gpt-4o",
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: userPrompt }],
      },
    ],
  });

  const text = extractOutputText(response).trim();
  if (!text) {
    throw new Error("OpenAI returned an empty text response");
  }
  return text;
}

export async function parseMorningCommitments(
  env: Env,
  systemPrompt: string,
  userInput: string,
  activeProjects: ProjectRow[],
): Promise<ParsedCommitment[]> {
  const response = await callOpenAI(env, {
    model: env.OPENAI_MODEL || "gpt-4o",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: `${systemPrompt}\n\nExtract today's commitments into JSON. Use project_id when the text clearly maps to one of the active projects listed. Leave project_id or domain_id as null when unclear. Do not invent projects.`,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Active projects:\n${activeProjects
              .map((project) => `- [${project.id}] ${project.name} (domain_id=${project.domain_id}, domain=${project.domain_name ?? "Unknown"})`)
              .join("\n")}\n\nUser reply:\n${userInput}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "morning_commitments",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["commitments"],
          properties: {
            commitments: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["commitment_text", "project_id", "domain_id"],
                properties: {
                  commitment_text: { type: "string" },
                  project_id: { type: ["integer", "null"] },
                  domain_id: { type: ["integer", "null"] },
                },
              },
            },
          },
        },
      },
    },
  });

  const parsed = JSON.parse(extractOutputText(response)) as { commitments: ParsedCommitment[] };
  return parsed.commitments
    .map((item) => ({
      commitment_text: truncate(item.commitment_text.trim(), 280),
      project_id: item.project_id,
      domain_id: item.domain_id,
    }))
    .filter((item) => item.commitment_text.length > 0);
}

export async function draftWeeklySummary(
  env: Env,
  systemPrompt: string,
  weekStart: string,
  weekEnd: string,
  weeklyContext: string,
  answers: WeeklyAnswer[],
): Promise<string> {
  return generateCoachReply(
    env,
    `${systemPrompt}\n\nThis is the weekly review. You may exceed 150 words when helpful, but stay concise and specific.`,
    [
      `Week window: ${formatDateHuman(weekStart)} to ${formatDateHuman(weekEnd)}.`,
      "",
      "Weekly context:",
      weeklyContext,
      "",
      "User answers:",
      ...answers.map((answer, index) => `${index + 1}. ${answer.question}\nAnswer: ${answer.answer}`),
      "",
      "Write a sharp weekly review summary. Include what was shipped, misses, whether misses look like blockers or avoidance, whether active projects still align to the PM transition, and the top 3 commitments for next week if they were provided. End with the single most important corrective action.",
    ].join("\n"),
  );
}

async function callOpenAI(env: Env, payload: Record<string, unknown>): Promise<OpenAIResponse> {
  const apiKey = requireEnv(env.OPENAI_API_KEY, "OPENAI_API_KEY");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI response failed with status ${response.status}: ${body}`);
  }

  return (await response.json()) as OpenAIResponse;
}

function extractOutputText(response: OpenAIResponse): string {
  const parts =
    response.output?.flatMap((item) =>
      (item.content ?? [])
        .filter((content) => content.type === "output_text" && typeof content.text === "string")
        .map((content) => content.text ?? ""),
    ) ?? [];

  return parts.join("").trim();
}
