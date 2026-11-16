import { fixture, goodEvaluation } from "../tests/helpers.js";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const f = await fixture(async (input) => {
  await new Promise((r) => setTimeout(r, 250));
  return goodEvaluation(input);
});
try {
  const c = await f.classroom(50);
  const s = await f.open(c.id);
  await f.control(s.id);
  const start = performance.now();
  const latencies = await Promise.all(
    c.cookies.map(async (cookie) => {
      const before = performance.now();
      await f.request(
        "POST",
        `/sessions/${s.id}/messages`,
        {
          body: "函数的定义域由有意义的输入构成。",
          revision: 2,
          clientId: randomUUID(),
        },
        cookie,
        202,
      );
      return performance.now() - before;
    }),
  );
  const finished = await f.waitFor(
    s.id,
    f.teacher,
    (d) =>
      d.students.length === 50 &&
      d.students.every((p: any) => p.explainStatus === "achieved"),
  );
  const completedMs = performance.now() - start;
  assert.equal(
    finished.students.reduce((n: number, p: any) => n + p.messageCount, 0),
    50,
  );
  const phaseStart = performance.now();
  await f.control(s.id);
  const phaseMs = performance.now() - phaseStart;
  const views = await Promise.all(
    c.cookies.map((cookie) =>
      f.request("GET", `/sessions/${s.id}`, undefined, cookie),
    ),
  );
  assert.ok(views.every((d) => d.session.stage === "attempt"));
  const sorted = latencies.sort((a, b) => a - b);
  const result = {
    date: new Date().toISOString(),
    environment:
      "Local HTTP server + temporary SQLite; simulated evaluator delayed 250ms; no real DeepSeek requests",
    students: 50,
    accepted: 50,
    graded: 50,
    duplicateStudentMessages: 0,
    submissionP50Ms: Math.round(sorted[24]),
    submissionP95Ms: Math.round(sorted[47]),
    allSimulatedFeedbackMs: Math.round(completedMs),
    teacherPhaseSwitchMs: Math.round(phaseMs),
    allStudentsObservedPhase: true,
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/load-test.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await f.close();
}
