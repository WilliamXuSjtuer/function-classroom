import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { makeEvaluator, type AIInput } from "../server/ai.js";
import type { Message } from "../shared/types.js";

export const conceptLesson = JSON.parse(
  readFileSync("server/content/lessons.json", "utf8"),
)[0];
export function studentMessage(
  id: string,
  body: string,
  stage: Message["stage"] = "explain",
  exerciseIndex = 0,
): Message {
  return {
    id,
    body,
    stage,
    exerciseIndex,
    userId: "test-student",
    role: "student",
    judgment: stage === "judge" ? false : null,
    createdAt: "2026-11-16T00:00:00Z",
    status: "done",
    error: null,
    attachments: [],
  };
}
export const evidence = (messageId: string, quote: string) => ({
  messageId,
  quote,
  kind: "text",
});
export function rawAssessment(overrides: Record<string, unknown> = {}) {
  return {
    feedback: "我明白这一点了，还想听你解释其他条件。",
    checks: [],
    issue: null,
    reasoningAccepted: false,
    corrected: false,
    reasoningEvidence: [],
    correctionEvidence: [],
    ...overrides,
  };
}
export async function modelFixture(
  respond: (request: any, count: number) => unknown,
) {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    const value = respond(request, requests.length);
    if (value instanceof Response) {
      res.statusCode = value.status;
      res.end(await value.text());
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                typeof value === "string" ? value : JSON.stringify(value),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const evaluate = makeEvaluator({
    dataDir: "/private/tmp",
    port: 0,
    host: "127.0.0.1",
    origin: "http://localhost",
    secure: false,
    demo: false,
    apiKey: "fixture-only",
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    model: "deepseek-flash",
    concurrency: 2,
    timeout: 3000,
  });
  return {
    evaluate,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
export const inputFor = (
  messages: Message[],
  extra: Partial<AIInput> = {},
): AIInput => ({
  lesson: conceptLesson,
  messages,
  stage: messages.at(-1)!.stage,
  exerciseIndex: messages.at(-1)!.exerciseIndex,
  imageFiles: [],
  previousChecks: [],
  ...extra,
});
