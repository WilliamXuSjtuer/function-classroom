// Opt-in live model checks. Uses the configured DeepSeek key; never writes classroom data.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import {
  makeEvaluator,
  PROMPT_VERSION,
  type AIInput,
  type AIResult,
} from "../server/ai.js";
import { configFromEnv } from "../server/config.js";
import type { Lesson, Message } from "../shared/types.js";

const config = configFromEnv();
if (!config.apiKey || config.demo)
  throw Error("真实模型检查需要配置 DeepSeek 密钥并关闭演示模式。");
const lesson: Lesson = JSON.parse(
  await readFile("server/content/lessons.json", "utf8"),
)[0];
const evaluate = makeEvaluator({
  ...config,
  timeout: Math.min(config.timeout, 60000),
});
const message = (
  id: string,
  body: string,
  stage: Message["stage"],
  exerciseIndex = 0,
  role: Message["role"] = "student",
): Message => ({
  id,
  body,
  stage,
  exerciseIndex,
  role,
  userId: "anonymous-fixture",
  judgment: stage === "judge" ? exerciseIndex === 1 : null,
  createdAt: new Date().toISOString(),
  status: "done",
  error: null,
  attachments: [],
});
const attempt = (i: number) =>
  message(
    `attempt-${i}`,
    `${lesson.exercises[i].prompt}\n${lesson.exercises[i].attempt}`,
    "attempt",
    i,
    "assistant",
  );
const input = (messages: Message[]): AIInput => ({
  lesson,
  messages,
  stage: messages.at(-1)!.stage,
  exerciseIndex: messages.at(-1)!.exerciseIndex,
  imageFiles: [],
  previousChecks: [],
});
const part = (r: AIResult, check: number, id: string) =>
  r.checks[check].parts?.find((p) => p.id === id)?.status;
const cases: Array<{
  name: string;
  input: AIInput;
  accepts: (r: AIResult) => boolean;
}> = [
  {
    name: "定义域不同的充分理由及修正",
    input: input([
      attempt(0),
      message(
        "answer",
        "这两个函数的定义域不同，所以值域不同，所以不是同一个函数",
        "judge",
      ),
    ]),
    accepts: (r) => r.reasoningAccepted && r.corrected,
  },
  {
    name: "只说判断正确不算解释了题解",
    input: input([attempt(1), message("answer", "我觉得是对的", "judge", 1)]),
    accepts: (r) =>
      !r.reasoningAccepted && part(r, 2, "simultaneous") !== "met",
  },
  {
    name: "已回答同时满足后继续问具体条件",
    input: input([
      attempt(1),
      message("first", "我觉得是对的", "judge", 1),
      message(
        "question",
        "两个根式的限制是同时满足，还是任选其一？",
        "judge",
        1,
        "assistant",
      ),
      message("answer", "需要同时满足", "judge", 1),
    ]),
    accepts: (r) =>
      !r.reasoningAccepted &&
      part(r, 2, "simultaneous") === "met" &&
      !/同时满足，还是任选其一/.test(r.feedback),
  },
  {
    name: "接纳口误修正并累计分轮解释",
    input: input([
      message(
        "definition",
        "函数就是自变量 x，按照确定的对应规则 f，对应到唯一的实数 y",
        "explain",
      ),
      message(
        "typo",
        "定义域如果是非空数集没有意义，f不是一个数，是对应关系",
        "explain",
      ),
      message("fixed", "定义域如果是空数集没有意义，前面我打错了", "explain"),
      message(
        "unique",
        "多个不同的 x 可以对应同一个 y，但是同一个 x 不能对应不同的 y",
        "explain",
      ),
    ]),
    accepts: (r) =>
      part(r, 0, "nonempty") === "met" &&
      part(r, 0, "unique") === "met" &&
      part(r, 0, "many_to_one") === "met" &&
      !/需要改一下|讲错/.test(r.issue?.question || r.feedback),
  },
  {
    name: "完整解释根式条件后本题通过",
    input: input([
      attempt(1),
      message(
        "answer",
        "第一个根式要x≥2，第二个要x≤1，必须同时满足，但没有这样的实数x，所以定义域为空，不能定义本课说的实函数。",
        "judge",
        1,
      ),
    ]),
    accepts: (r) => r.reasoningAccepted,
  },
  {
    name: "明确数学错误仍应识别",
    input: input([
      message("wrong", "同一个x可以对应两个不同的y，这也算函数。", "explain"),
    ]),
    accepts: (r) =>
      part(r, 0, "unique") === "incorrect" && r.issue?.kind === "incorrect",
  },
];
const results = [];
for (const c of cases) {
  const start = Date.now();
  try {
    const result = await evaluate(c.input);
    const passed = !result.reviewRequired && c.accepts(result);
    results.push({
      name: c.name,
      passed,
      durationMs: Date.now() - start,
      result,
    });
    console.log(
      JSON.stringify({
        name: c.name,
        passed,
        attempts: result.modelAttempts,
        feedback:
          c.input.stage === "explain"
            ? result.issue?.question || result.feedback
            : result.feedback,
        warnings: result.validationWarnings,
      }),
    );
  } catch (error) {
    results.push({
      name: c.name,
      passed: false,
      durationMs: Date.now() - start,
      error: (error as Error).message,
    });
    console.log(
      JSON.stringify({
        name: c.name,
        passed: false,
        error: (error as Error).message,
      }),
    );
  }
}
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/ai-review-v2.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      model: config.model,
      promptVersion: PROMPT_VERSION,
      results,
    },
    null,
    2,
  ),
);
console.log(
  `${results.filter((r) => r.passed).length}/${results.length} live scenarios passed`,
);
if (results.some((r) => !r.passed)) process.exitCode = 1;
