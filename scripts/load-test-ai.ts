// Opt-in: 100 synthetic submissions through the real HTTP app and DeepSeek.
// Uses a temporary database. Never opens the production classroom database.
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fixture } from "../tests/helpers.js";
import { makeEvaluator, PROMPT_VERSION, type Evaluator } from "../server/ai.js";
import { configFromEnv } from "../server/config.js";

const config = configFromEnv();
if (!config.apiKey || config.demo)
  throw Error("真实并发测试需要配置 DeepSeek 密钥并关闭演示模式。");
if (
  !Number.isInteger(config.concurrency) ||
  config.concurrency < 1 ||
  !Number.isFinite(config.timeout) ||
  config.timeout <= 0
)
  throw Error("AI并发数和超时时间配置无效。");

const students = 50;
const startedAt = new Date().toISOString();
const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
const originalFetch = globalThis.fetch;
type Call = {
  messageId: string;
  started: number;
  durationMs: number;
  status: number;
  model?: string;
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  cachedPromptTokens?: number;
  error?: string;
};
type Timing = { entered: number; finished?: number; error?: string };
const calls: Call[] = [];
const timings = new Map<string, Timing>();
const activeEvaluations = new Set<Promise<unknown>>();
let activeCalls = 0;
let peakCalls = 0;

// Observe only model requests in this dedicated test process. Keep the actual
// evaluator, queue, request parameters, abort signal and response unchanged.
globalThis.fetch = async (input, init) => {
  if (String(input) !== endpoint) return originalFetch(input, init);
  const payload = JSON.parse(String(init?.body));
  const lastUser = payload.messages
    .filter((m: any) => m.role === "user")
    .at(-1);
  const content =
    lastUser?.content?.find((c: any) => c.type === "text")?.text || "";
  const messageId = /^\[messageId=([^,]+),/.exec(content)?.[1] || "unmatched";
  const call: Call = {
    messageId,
    started: performance.now(),
    durationMs: 0,
    status: 0,
  };
  calls.push(call);
  peakCalls = Math.max(peakCalls, ++activeCalls);
  try {
    const response = await originalFetch(input, init);
    call.status = response.status;
    const data = (await response
      .clone()
      .json()
      .catch(() => null)) as any;
    call.model = data?.model;
    call.finishReason = data?.choices?.[0]?.finish_reason;
    call.promptTokens = data?.usage?.prompt_tokens;
    call.completionTokens = data?.usage?.completion_tokens;
    call.cachedPromptTokens = data?.usage?.prompt_cache_hit_tokens;
    return response;
  } catch (error) {
    call.error =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
    throw error;
  } finally {
    call.durationMs = performance.now() - call.started;
    activeCalls--;
  }
};

let evaluate: Evaluator;
const f = await fixture((input) => {
  const id = input.messages.filter((m) => m.role === "student").at(-1)!.id;
  const timing: Timing = { entered: performance.now() };
  timings.set(id, timing);
  const task = (async () => {
    try {
      return await evaluate(input);
    } catch (error) {
      timing.error = (error as Error).message;
      throw error;
    } finally {
      timing.finished = performance.now();
    }
  })();
  activeEvaluations.add(task);
  void task.finally(() => activeEvaluations.delete(task)).catch(() => {});
  return task;
});
// Images, if added in a future workload, must also stay in the temporary folder.
evaluate = makeEvaluator({ ...config, dataDir: f.config.dataDir });
f.config.model = config.model;
f.config.concurrency = config.concurrency;
f.config.timeout = config.timeout;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted.length
      ? Math.round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)])
      : null;
  return {
    count: sorted.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: percentile(1),
  };
}
const explain = [
  "函数把非空数集D中的每个x，按确定规则f对应到唯一的实数y。不同的x可以有相同的y。D是定义域，实际得到的所有y是值域，f是规则，f(a)是输入a对应的函数值，不是f乘a。定义域的所有限制要同时满足，化简不能扩大定义域。同一函数要定义域相同且对应规则相同。",
  "定义域是允许输入的x构成的非空数集。每个x都必须有输出，且只能对应一个y；不同的x可以得到同一个y。",
  "同一个x可以对应两个不同的y，这也算函数。",
  "求定义域时，分母不能为0，偶次根式被开方数不能小于0，这些条件要同时满足。化简后也要保留原来定义域的限制。",
  "判断是不是同一个函数，需要看定义域和对应规则是否都相同。表达式看起来相同但定义域不同，也不是同一个函数。",
];
const judge = [
  {
    body: "不是同一个函数。f的定义域是全体实数，g的定义域是[-1,1]，定义域不同。虽然对应规则相同，仍然不是同一个函数。原解答遗漏了定义域。",
    judgment: false,
    expectedPass: true,
  },
  {
    body: "这两个函数的定义域不同，所以值域不同，所以不是同一个函数。",
    judgment: false,
    expectedPass: true,
  },
  {
    body: "不是同一个函数。比如输入x=2，f有函数值2，g在这个输入上没有定义，允许的输入集合不同，所以原判断错误。",
    judgment: false,
    expectedPass: true,
  },
  { body: "我判断错误。", judgment: false, expectedPass: false },
  {
    body: "它们是同一个函数，因为解析式都是y=x。",
    judgment: true,
    expectedPass: false,
  },
];

const rounds: any[] = [];
const phaseChecks: any[] = [];
let fatalError: string | undefined;
let c: Awaited<ReturnType<typeof f.classroom>>;
let sessionId = "";

async function readView(cookie: string) {
  const response = await fetch(`${f.base}/api/sessions/${sessionId}`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error(`课堂读取 HTTP ${response.status}`);
  return response.json();
}

async function runRound(stage: "explain" | "judge", revision: number) {
  const start = performance.now();
  const submissions: Array<{
    index: number;
    id?: string;
    acceptedMs: number;
    error?: string;
  }> = [];
  const viewTimes: number[] = [];
  const viewErrors: string[] = [];
  let polling = false;
  let pendingPoll = Promise.resolve();
  // Poll all students every 2.5s, with an additional teacher overview request.
  const poll = () => {
    if (polling) return;
    polling = true;
    pendingPoll = Promise.all(
      [f.teacher, ...c.cookies].map(async (cookie) => {
        const before = performance.now();
        try {
          const view = await readView(cookie);
          if (view.session.stage !== stage)
            throw Error("轮询得到错误的课堂阶段");
          viewTimes.push(performance.now() - before);
        } catch (e) {
          viewErrors.push((e as Error).message);
        }
      }),
    ).then(() => {
      polling = false;
    });
  };
  const timer = setInterval(poll, 2500);
  const terminalAt = new Map<string, number>();
  let rows: any[] = [];
  try {
    await Promise.all(
      c.cookies.map(async (cookie, index) => {
        const before = performance.now();
        try {
          const profile = judge[index % judge.length];
          const result = await f.request(
            "POST",
            `/sessions/${sessionId}/messages`,
            {
              body:
                stage === "explain"
                  ? explain[index % explain.length]
                  : profile.body,
              ...(stage === "judge" ? { judgment: profile.judgment } : {}),
              revision,
              clientId: randomUUID(),
            },
            cookie,
            202,
          );
          submissions.push({
            index,
            id: result.id,
            acceptedMs: performance.now() - before,
          });
        } catch (e) {
          submissions.push({
            index,
            acceptedMs: performance.now() - before,
            error: (e as Error).message,
          });
        }
      }),
    );
    poll();
    const deadline =
      start + Math.ceil(students / config.concurrency) * config.timeout + 30000;
    let lastProgress = 0;
    while (true) {
      rows = f.store.all(
        "SELECT * FROM messages WHERE session_id=? AND role='student' AND stage=?",
        sessionId,
        stage,
      );
      for (const row of rows)
        if (row.status !== "pending" && !terminalAt.has(row.id))
          terminalAt.set(row.id, performance.now());
      const pending = rows.filter((r) => r.status === "pending").length;
      if (performance.now() - lastProgress >= 5000 || pending === 0) {
        console.log(
          JSON.stringify({
            stage,
            accepted: submissions.filter((s) => s.id).length,
            done: rows.filter((r) => r.status === "done").length,
            failed: rows.filter((r) => r.status === "failed").length,
            pending,
            elapsedSeconds: Math.round((performance.now() - start) / 1000),
            activeModelRequests: activeCalls,
          }),
        );
        lastProgress = performance.now();
      }
      if (!pending) break;
      if (performance.now() > deadline)
        throw Error(`${stage}: 并发测试超过总等待上限`);
      await sleep(100);
    }
  } finally {
    clearInterval(timer);
    await pendingPoll;
  }
  const elapsedMs = Math.round(performance.now() - start);
  const views = await Promise.all(c.cookies.map(readView));
  const overview = await readView(f.teacher);
  const records = submissions
    .sort((a, b) => a.index - b.index)
    .map((submission) => {
      const row = rows.find((r) => r.id === submission.id);
      const evaluation = row?.evaluation ? JSON.parse(row.evaluation) : null;
      const timing = submission.id ? timings.get(submission.id) : undefined;
      const requests = calls.filter((call) => call.messageId === submission.id);
      const replies = views[submission.index].messages.filter(
        (m: any) => m.replyTo === submission.id,
      );
      const expectedPass =
        stage === "judge"
          ? judge[submission.index % judge.length].expectedPass
          : undefined;
      return {
        student: submission.index + 1,
        profile: (submission.index % 5) + 1,
        status: row?.status || "not_accepted",
        error: row?.error || submission.error,
        acceptedMs: Math.round(submission.acceptedMs),
        feedbackMs:
          submission.id && terminalAt.has(submission.id)
            ? Math.round(terminalAt.get(submission.id)! - start)
            : null,
        queueWaitMs:
          timing && requests[0]
            ? Math.round(requests[0].started - timing.entered)
            : null,
        providerRequests: requests.length,
        replyCount: replies.length,
        feedback: replies.map((r: any) => r.body).join("\n"),
        reviewRequired: Boolean(evaluation?.reviewRequired),
        validationWarnings: evaluation?.validationWarnings || [],
        taskPassed: evaluation?.taskPassed,
        expectedPass,
        qualityCheckPassed:
          expectedPass === undefined
            ? undefined
            : evaluation?.taskPassed === expectedPass,
        evaluation,
      };
    });
  const studentMessagesVisible = views.every((view, index) => {
    const own = submissions.find((s) => s.index === index);
    return (
      view.messages.filter(
        (m: any) => m.role === "student" && m.stage === stage,
      ).length === 1 &&
      view.messages.some((m: any) => m.id === own?.id && m.status !== "pending")
    );
  });
  const round = {
    stage,
    students,
    accepted: submissions.filter((s) => s.id).length,
    done: records.filter((r) => r.status === "done").length,
    failed: records.filter((r) => r.status === "failed").length,
    reviewRequired: records.filter((r) => r.reviewRequired).length,
    replies: records.reduce((n, r) => n + r.replyCount, 0),
    allFeedbackMs: elapsedMs,
    submissionLatency: distribution(records.map((r) => r.acceptedMs)),
    feedbackLatency: distribution(
      records.flatMap((r) => (r.feedbackMs === null ? [] : [r.feedbackMs])),
    ),
    queueWait: distribution(
      records.flatMap((r) => (r.queueWaitMs === null ? [] : [r.queueWaitMs])),
    ),
    classroomReadLatency: distribution(viewTimes),
    readErrors: viewErrors,
    savedStudentMessages: rows.length,
    studentMessagesVisible,
    teacherParticipantCount: overview.students.length,
    teacherWaitingForFeedback: overview.students.filter(
      (p: any) =>
        (stage === "explain"
          ? p.explainEvaluationStatus
          : p.judgments[overview.lesson.exercises[0].id]?.evaluationStatus) ===
        "processing",
    ).length,
    qualityChecks:
      stage === "judge"
        ? {
            checked: records.length,
            passed: records.filter((r) => r.qualityCheckPassed).length,
          }
        : undefined,
    records,
  };
  rounds.push(round);
  console.log(
    JSON.stringify({ roundComplete: stage, ...round, records: undefined }),
  );
}

try {
  c = await f.classroom(students);
  const session = await f.open(c.id);
  sessionId = session.id;
  const explaining = await f.control(sessionId);
  console.log(
    JSON.stringify({
      environment: "local HTTP + temporary SQLite + real DeepSeek",
      students,
      model: config.model,
      concurrency: config.concurrency,
      timeoutMs: config.timeout,
      rounds: 2,
    }),
  );
  await runRound("explain", explaining.session.revision);
  const before = performance.now();
  await f.control(sessionId);
  const views = await Promise.all(c.cookies.map(readView));
  phaseChecks.push({
    stage: "attempt",
    durationMs: Math.round(performance.now() - before),
    observedByAllStudents: views.every((v) => v.session.stage === "attempt"),
  });
  const judging = await f.control(sessionId);
  await runRound("judge", judging.session.revision);
} catch (error) {
  fatalError = (error as Error).message;
  console.error(fatalError);
} finally {
  // Do not remove the temporary database while background evaluations use it.
  await Promise.allSettled([...activeEvaluations]);
  globalThis.fetch = originalFetch;
  const successful =
    !fatalError &&
    rounds.length === 2 &&
    rounds.every(
      (r) =>
        r.accepted === students &&
        r.done === students &&
        !r.reviewRequired &&
        r.replies === students &&
        r.savedStudentMessages === students &&
        r.studentMessagesVisible &&
        !r.readErrors.length &&
        r.teacherParticipantCount === students &&
        !r.teacherWaitingForFeedback,
    ) &&
    phaseChecks.every((p) => p.observedByAllStudents);
  const result = {
    startedAt,
    finishedAt: new Date().toISOString(),
    environment:
      "Local macOS/Node HTTP server, temporary SQLite, synthetic text students, real DeepSeek API; not an Alibaba Cloud or browser/device load test",
    node: process.version,
    model: config.model,
    endpointHost: new URL(config.baseUrl).hostname,
    promptVersion: PROMPT_VERSION,
    students,
    concurrency: config.concurrency,
    timeoutMs: config.timeout,
    successful,
    fatalError,
    phaseChecks,
    rounds,
    provider: {
      requests: calls.length,
      peakConcurrentRequests: peakCalls,
      httpErrors: calls.filter((c) => c.status !== 200).length,
      rateLimited: calls.filter((c) => c.status === 429).length,
      errors: calls.filter((c) => c.error).map((c) => c.error),
      latency: distribution(calls.map((c) => c.durationMs)),
      modelsReturned: [...new Set(calls.map((c) => c.model).filter(Boolean))],
      promptTokens: calls.reduce((n, c) => n + (c.promptTokens || 0), 0),
      completionTokens: calls.reduce(
        (n, c) => n + (c.completionTokens || 0),
        0,
      ),
      cachedPromptTokens: calls.reduce(
        (n, c) => n + (c.cachedPromptTokens || 0),
        0,
      ),
      calls: calls.map((call) => ({
        ...call,
        durationMs: Math.round(call.durationMs),
        started: undefined,
      })),
    },
  };
  await mkdir("artifacts", { recursive: true });
  const json = JSON.stringify(result, null, 2);
  await writeFile("artifacts/ai-load-test.json", json);
  await writeFile(
    `artifacts/ai-load-test-${startedAt.replace(/[:.]/g, "-")}.json`,
    json,
  );
  console.log(
    JSON.stringify({
      successful,
      modelRequests: calls.length,
      peakConcurrentRequests: peakCalls,
      report: "artifacts/ai-load-test.json",
      fatalError,
    }),
  );
  await f.close();
  if (
    !successful ||
    rounds.some(
      (r) =>
        r.qualityChecks && r.qualityChecks.passed !== r.qualityChecks.checked,
    )
  )
    process.exitCode = 1;
}
