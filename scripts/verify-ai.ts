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
const lessons: Lesson[] = JSON.parse(
  await readFile("server/content/lessons.json", "utf8"),
);
const lesson = lessons[0];
const representation = lessons[1];
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
const representationInput = (messages: Message[]): AIInput => ({
  ...input(messages),
  lesson: representation,
  messages: messages.map((m) =>
    m.role === "student" && m.stage === "judge"
      ? { ...m, judgment: representation.exercises[m.exerciseIndex].isCorrect }
      : m,
  ),
});
const representationAttempt = (i: number) =>
  message(
    `representation-attempt-${i}`,
    `${representation.exercises[i].prompt}\n${representation.exercises[i].attempt}`,
    "attempt",
    i,
    "assistant",
  );
cases.push(
  {
    name: "表示方法：只说你做的对不能通过正确题",
    input: representationInput([
      representationAttempt(0),
      message("agreement", "你做的对", "judge"),
    ]),
    accepts: (r) => !r.reasoningAccepted,
  },
  {
    name: "表示方法：解释复合求值的内外层选段后通过",
    input: representationInput([
      representationAttempt(0),
      message(
        "reason",
        "-1≤1，所以f(-1)=-1+3=2。1也满足x≤1，所以f(1)=4。外层输入变成4，它满足x≥2，所以f(f(1))=f(4)=2×4-1=7。你每次都是按输入所在区间选段，所以做对了。",
        "judge",
      ),
    ]),
    accepts: (r) => r.reasoningAccepted,
  },
  {
    name: "表示方法：跨轮指出区间错误并补上正确答案",
    input: representationInput([
      representationAttempt(1),
      message(
        "reason",
        "a=±2的时候不满足1<x<2分段函数的定义域，所以做错了",
        "judge",
        1,
      ),
      message("question", "那正确的a应该是哪些数呢？", "judge", 1, "assistant"),
      message("correction", "a=1或a=2.5", "judge", 1),
    ]),
    accepts: (r) => r.reasoningAccepted && r.corrected,
  },
  {
    name: "表示方法：非端点选段正确不能代替端点证据",
    input: representationInput([
      message(
        "question",
        "当x<0时f(x)=x+1，当x≥0时f(x)=x²。输入x=2，你怎么选段？",
        "explain",
        0,
        "assistant",
      ),
      message(
        "select",
        "先看输入所在区间，x=2满足x≥0，所以代入f(x)=x²",
        "explain",
      ),
    ]),
    accepts: (r) =>
      part(r, 1, "interval") === "met" && part(r, 1, "endpoint") !== "met",
  },
  {
    name: "表示方法：澄清分段函数时先补足问题条件",
    input: representationInput([
      message(
        "question",
        "遇到分段函数，输入x=2时你怎么选段？",
        "explain",
        0,
        "assistant",
      ),
      message("clarify", "什么分段函数", "explain"),
    ]),
    accepts: (r) =>
      /分段|区间/.test(r.feedback) &&
      part(r, 1, "endpoint") !== "met" &&
      !/我都讲清楚/.test(r.feedback),
  },
  {
    name: "二分法：端点异号不能替代连续性条件",
    input: {
      ...input([
        message("sign", "f(a)与f(b)符号相反，也就是f(a)f(b)<0", "explain"),
      ]),
      lesson: lessons.find((l) => l.id === "bisection")!,
    },
    accepts: (r) =>
      part(r, 0, "opposite_signs") === "met" &&
      part(r, 0, "continuous") !== "met",
  },
);
const parity = lessons.find((l) => l.id === "parity-definition")!;
function parityTask(
  i: number,
  turns: Array<[string, string, "student" | "assistant"]>,
): AIInput {
  const ex = parity.exercises[i];
  return {
    ...input([
      message(
        "problem",
        ex.prompt + "\n" + ex.attempt,
        "attempt",
        i,
        "assistant",
      ),
      ...turns.map(([id, body, role]) => message(id, body, "judge", i, role)),
    ]),
    lesson: parity,
  };
}
cases.push(
  {
    name: "奇偶性：未定义的函数值不能用于不等比较",
    input: parityTask(0, [
      ["mistake", "f(-1)和f(1)不相等，所以不对。", "student"],
    ]),
    accepts: (r) =>
      !r.reasoningAccepted &&
      !r.corrected &&
      /无定义|没有定义|未定义|不能取|取不到|没有函数值|不存在|不在/.test(
        r.feedback,
      ),
  },
  ...["都不是", "什么都不是呀"].map((conclusion) => ({
    name: "奇偶性：识别跨轮非奇非偶结论 " + conclusion,
    input: parityTask(0, [
      ["endpoints", "右端的1属于定义域，它的相反数却被排除了。", "student"],
      ["ask", "那么奇函数和偶函数里面，它是哪一种？", "assistant"],
      ["conclusion", conclusion, "student"],
    ]),
    accepts: (r: AIResult) =>
      r.reasoningAccepted &&
      r.corrected &&
      !!r.reasoningEvidence?.some((e) => e.messageId === "endpoints") &&
      !!r.correctionEvidence?.some((e) => e.messageId === "conclusion"),
  })),
  {
    name: "奇偶性：改题目端点不能算作修正原解",
    input: parityTask(0, [
      ["change", "我把定义域换成闭区间[-1,1]，这样就成偶函数了。", "student"],
    ]),
    accepts: (r) => !r.corrected,
  },
  {
    name: "奇偶性：追问属于符号的矛盾",
    input: parityTask(1, [
      ["compare", "对任意实数t都有f(t)=f(-t)。", "student"],
      ["ask", "定义域为什么对称？", "assistant"],
      ["symbol", "因为对任意x∉R，都有-x∈R。", "student"],
    ]),
    accepts: (r) =>
      !r.reasoningAccepted && /∉|不属于|不在实数|符号/.test(r.feedback),
  },
);
cases.push({
  name: "给过参考答案后具体说明困惑",
  input: {
    ...parityTask(0, [
      ["ref", "原题左右端点不成对，因此既非奇也非偶。", "assistant"],
      ["confusion", "你到底哪一步没懂？", "student"],
    ]),
    support: { explainFocus: {}, judgeHints: 3, referenceShown: true },
  },
  accepts: (r) =>
    !r.reasoningAccepted &&
    !r.corrected &&
    /端点|区间|相反数|[−-]1|定义域/.test(r.feedback) &&
    !/再用自己的话|重新表述/.test(r.feedback),
});
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
  `artifacts/ai-review-${PROMPT_VERSION}.json`,
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
