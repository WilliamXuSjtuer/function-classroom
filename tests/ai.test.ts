import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeEvaluator, type AIInput } from "../server/ai.js";
import type { Config } from "../server/config.js";
import type { Message } from "../shared/types.js";
test("DeepSeek 请求保留早期证据、传入图片并剔除无依据评价；不向讲解阶段提供例题答案", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "classroom-ai-"));
  await mkdir(path.join(dir, "uploads"));
  await writeFile(
    path.join(dir, "uploads", "fixture.webp"),
    Buffer.from("image-contract-fixture"),
  );
  let captured: any;
  const lesson = JSON.parse(
    readFileSync("server/content/lessons.json", "utf8"),
  )[0];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    captured = JSON.parse(body);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                feedback: "请继续解释。",
                checks: lesson.checklist.map((c: any, i: number) => ({
                  id: c.id,
                  met: true,
                  evidenceMessageId: i === 0 ? "early" : "invented",
                  quote: "定义域",
                })),
                issue: null,
                reasoningAccepted: true,
                corrected: false,
                note: "检查引用",
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const config: Config = {
    dataDir: dir,
    port: 0,
    host: "127.0.0.1",
    origin: "http://localhost",
    secure: false,
    demo: false,
    apiKey: "unit-test-only",
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    model: "deepseek-flash",
    concurrency: 2,
    timeout: 2000,
  };
  const message = (id: string, body: string): Message => ({
    id,
    userId: "student",
    role: "student",
    body,
    stage: "explain",
    exerciseIndex: 0,
    judgment: null,
    createdAt: "2026-11-16T00:00:00Z",
    status: "done",
    error: null,
    attachments: [],
  });
  const messages = [
    message("early", "定义域是有意义的输入集合。"),
    ...Array.from({ length: 45 }, (_, i) => message(`m${i}`, "补充说明")),
  ];
  messages.at(-1)!.attachments = [
    {
      id: "asset",
      name: "手写",
      url: "/api/attachments/asset",
      mime: "image/webp",
      size: 22,
    },
  ];
  const input: AIInput = {
    lesson,
    messages,
    stage: "explain",
    exerciseIndex: 0,
    imageFiles: [
      { messageId: "m44", path: "fixture.webp", mime: "image/webp", size: 22 },
    ],
    previousChecks: [
      {
        id: lesson.checklist[0].id,
        met: true,
        evidenceMessageId: "early",
        quote: "定义域",
      },
    ],
  };
  try {
    const result = await makeEvaluator(config)(input);
    assert.ok(
      captured.messages.some(
        (m: any) =>
          Array.isArray(m.content) &&
          m.content[0].text.includes("messageId=early"),
      ),
    );
    assert.ok(
      captured.messages.some(
        (m: any) =>
          Array.isArray(m.content) &&
          m.content.some(
            (c: any) =>
              c.type === "image_url" &&
              c.image_url.url.startsWith("data:image/webp;base64,"),
          ),
      ),
    );
    assert.equal(result.checks[0].met, true);
    assert.ok(result.checks.slice(1).every((c) => !c.met));
    assert.equal(captured.response_format.type, "json_object");
    assert.equal(captured.model, "deepseek-flash");
    assert.ok(captured.messages[0].content.includes('"exercises":[]'));
    await assert.rejects(
      () =>
        makeEvaluator(config)({
          ...input,
          imageFiles: [{ ...input.imageFiles[0], size: 13 * 1024 * 1024 }],
        }),
      /图片总量较大/,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
