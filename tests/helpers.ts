import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/auth.js";
import { id, now } from "../server/db.js";
import type { Evaluator } from "../server/ai.js";
import type { Config } from "../server/config.js";
export const goodEvaluation: Evaluator = async (input) => ({
  feedback: "我明白了，谢谢你把条件讲清楚。",
  checks: input.lesson.checklist.map((c) => ({
    id: c.id,
    met: true,
    evidenceMessageId: input.messages
      .filter((m) => m.role === "student")
      .at(-1)!.id,
    quote: "定义域",
    evidenceKind: "text",
  })),
  issue: null,
  reasoningAccepted: true,
  corrected: true,
  note: "根据学生对定义域的说明评价。",
});
export async function fixture(evaluator: Evaluator = goodEvaluation) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "classroom-test-"));
  const config: Config = {
    dataDir,
    port: 0,
    host: "127.0.0.1",
    origin: "http://localhost:5173",
    secure: false,
    demo: false,
    apiKey: "test-not-a-real-key",
    baseUrl: "http://127.0.0.1:1",
    model: "deepseek-flash",
    concurrency: 12,
    timeout: 1000,
  };
  const { app, store } = await createApp(config, evaluator);
  store.run(
    "INSERT INTO users VALUES(?,?,?,?,?,?,?)",
    id(),
    "teacher",
    "测试教师",
    "teacher",
    await hashPassword("test-teacher-password"),
    null,
    now(),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(
    method: string,
    url: string,
    body?: any,
    cookie = "",
    status = 200,
  ) {
    const response = await fetch(base + "/api" + url, {
      method,
      headers: {
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        Cookie: cookie,
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(
      response.status,
      status,
      `${method} ${url}: ${JSON.stringify(result)}`,
    );
    return result;
  }
  async function login(username: string, password: string) {
    const response = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.headers.get("set-cookie")!.split(";")[0];
  }
  const teacher = await login("teacher", "test-teacher-password");
  async function classroom(count = 2) {
    const c = await request(
      "POST",
      "/classes",
      { name: "高一（测试）班" },
      teacher,
      201,
    );
    const students = Array.from({ length: count }, (_, i) => ({
      username: `0001${String(i + 1).padStart(4, "0")}`,
      name: `学生${i + 1}`,
    }));
    await request(
      "POST",
      `/classes/${c.id}/students`,
      { students },
      teacher,
      201,
    );
    const cookies = await Promise.all(
      students.map((s) => login(s.username, s.username.slice(-4))),
    );
    return { id: c.id, students, cookies };
  }
  async function open(classId: string) {
    const { lessons } = await request("GET", "/bootstrap", undefined, teacher);
    const lesson = lessons[0];
    if (lesson.status !== "published")
      await request(
        "POST",
        `/lessons/${lesson.id}/publish`,
        { revision: lesson.revision },
        teacher,
      );
    const session = await request(
      "POST",
      `/classes/${classId}/sessions`,
      { lessonId: lesson.id, mode: "classroom" },
      teacher,
      201,
    );
    return { id: session.id, lesson };
  }
  async function control(sessionId: string, action = "advance") {
    const d = await request(
      "GET",
      `/sessions/${sessionId}`,
      undefined,
      teacher,
    );
    await request(
      "POST",
      `/sessions/${sessionId}/control`,
      { action, revision: d.session.revision },
      teacher,
    );
    return request("GET", `/sessions/${sessionId}`, undefined, teacher);
  }
  async function waitFor(
    sessionId: string,
    cookie: string,
    predicate: (d: any) => boolean,
  ) {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const d = await request(
        "GET",
        `/sessions/${sessionId}`,
        undefined,
        cookie,
      );
      if (predicate(d)) return d;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw Error("等待课堂状态超时");
  }
  async function close() {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
  return {
    request,
    login,
    teacher,
    classroom,
    open,
    control,
    waitFor,
    close,
    base,
    store,
    config,
  };
}
