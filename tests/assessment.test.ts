import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  modelFixture,
  rawAssessment,
  studentMessage,
  evidence,
  inputFor,
} from "./model-helpers.js";

test("选段正确不等于端点已掌握，端点补充后累计达标；教师自定义标准仍优先", async () => {
  const lesson = JSON.parse(
    readFileSync("server/content/lessons.json", "utf8"),
  )[1];
  const select = studentMessage("select", "x=2满足x≥0，所以用x²");
  const endpoint = studentMessage(
    "endpoint",
    "x=0满足x≥0，不满足x<0，所以用x²",
  );
  const f = await modelFixture((_r, n) =>
    rawAssessment({
      checks: [
        {
          id: "function-representation-c2",
          parts: [
            {
              id: n === 1 ? "interval" : n === 2 ? "endpoint" : "criterion-1",
              status: "met",
              evidence: [
                evidence(
                  n === 1 ? select.id : endpoint.id,
                  n === 1 ? select.body : endpoint.body,
                ),
              ],
            },
          ],
        },
      ],
    }),
  );
  try {
    const first = await f.evaluate(inputFor([select], { lesson }));
    assert.equal(first.checks[1].met, false);
    assert.equal(
      first.checks[1].parts?.find((p) => p.id === "interval")?.status,
      "met",
    );
    assert.equal(
      first.checks[1].parts?.find((p) => p.id === "endpoint")?.status,
      "missing",
    );
    const second = await f.evaluate(
      inputFor([select, endpoint], { lesson, previousChecks: first.checks }),
    );
    assert.equal(second.checks[1].met, true);
    const edited = structuredClone(lesson);
    edited.checklist[1].criterion = "只解释本题端点选段";
    const custom = await f.evaluate(inputFor([endpoint], { lesson: edited }));
    assert.equal(custom.checks[1].parts?.length, 1);
    assert.equal(custom.checks[1].parts?.[0].label, "只解释本题端点选段");
    assert.equal(custom.checks[1].met, true);
  } finally {
    await f.close();
  }
});

test("纯表态不能充作本题理由，但简短确认不抹去此前有效理由", async () => {
  let quoted: Array<{ messageId: string; quote: string; kind: string }> = [];
  const f = await modelFixture(() =>
    rawAssessment({
      reasoningAccepted: true,
      corrected: true,
      reasoningEvidence: quoted,
      correctionEvidence: quoted,
      feedback: "我明白了，这题已经完成！",
    }),
  );
  try {
    for (const body of [
      "你做的对",
      "你做得对！",
      "我觉得是对的",
      "没错",
      "满足",
      "你还有别的问题吗",
    ]) {
      const m = studentMessage("agreement", body, "judge");
      quoted = [evidence(m.id, m.body)];
      const r = await f.evaluate(inputFor([m]));
      assert.equal(r.reasoningAccepted, false, body);
      assert.equal(r.corrected, false, body);
      assert.equal(r.reviewRequired, false, body);
      assert.match(r.feedback, /依据|为什么|理由/, body);
    }
    const reason = studentMessage(
      "reason",
      "两个函数的定义域不同，所以不是同一个函数",
      "judge",
    );
    const short = studentMessage("short", "没错", "judge");
    quoted = [evidence(reason.id, reason.body), evidence(short.id, short.body)];
    const accepted = await f.evaluate(inputFor([reason, short]));
    assert.equal(accepted.reasoningAccepted, true);
    assert.equal(accepted.corrected, true);
    assert.deepEqual(
      accepted.reasoningEvidence?.map((e) => e.messageId),
      ["reason"],
    );
  } finally {
    await f.close();
  }
});

test("错误原因已经说明但修正只有表态时，反馈仍要求补充修正", async () => {
  const reason = studentMessage(
    "reason",
    "这两个函数的定义域不同，所以不能只看式子相同",
    "judge",
  );
  const short = studentMessage("short", "没错", "judge");
  const f = await modelFixture(() =>
    rawAssessment({
      reasoningAccepted: true,
      corrected: true,
      reasoningEvidence: [evidence(reason.id, reason.body)],
      correctionEvidence: [evidence(short.id, short.body)],
      feedback: "你把修正方法教给我了，这题已完成，等老师切换。",
    }),
  );
  try {
    const r = await f.evaluate(inputFor([reason, short]));
    assert.equal(r.reasoningAccepted, true);
    assert.equal(r.corrected, false);
    assert.doesNotMatch(r.feedback, /已完成|等老师切换/);
    assert.match(r.feedback, /修正/);
    assert.equal(r.reviewRequired, false);
  } finally {
    await f.close();
  }
});

test("助手解题和其他例题的学生回答不能成为本题通过证据，说明与最终字段保持一致", async () => {
  const f = await modelFixture(() =>
    rawAssessment({
      checks: [
        {
          id: "function-concept-c3",
          parts: [
            {
              id: "simultaneous",
              status: "met",
              evidence: [evidence("ai", "交集为空")],
            },
          ],
        },
      ],
      reasoningAccepted: true,
      corrected: true,
      reasoningEvidence: [evidence("ai", "交集为空")],
      correctionEvidence: [evidence("old-task", "不是同一个函数")],
      note: "学生已能判断交集为空，定义域限制达标",
    }),
  );
  try {
    const current = studentMessage("current", "我觉得是对的", "judge", 1);
    const result = await f.evaluate(
      inputFor([
        studentMessage("old-task", "不是同一个函数", "judge", 0),
        {
          ...studentMessage("ai", "交集为空", "attempt", 1),
          role: "assistant",
        },
        current,
      ]),
    );
    assert.equal(result.reasoningAccepted, false);
    assert.equal(result.corrected, false);
    assert.equal(result.checks[2].met, false);
    assert.equal(result.reviewRequired, true);
    assert.doesNotMatch(result.note, /学生已能判断交集为空|定义域限制达标/);
    assert.match(result.note, /待复核/);
  } finally {
    await f.close();
  }
});

test("知识点按子项累计；没重复不会撤销，明确的新错误只撤销对应子项", async () => {
  const first = studentMessage("first", "同一个 x 不能有两个不同的 y");
  const second = studentMessage("second", "定义域不能是空集");
  const wrong = studentMessage("wrong", "同一个 x 也可以有两个不同的 y");
  const responses = [
    { id: "unique", status: "met", evidence: [evidence(first.id, first.body)] },
    {
      id: "nonempty",
      status: "met",
      evidence: [evidence(second.id, second.body)],
    },
    {
      id: "unique",
      status: "incorrect",
      evidence: [evidence(wrong.id, wrong.body)],
    },
  ];
  const f = await modelFixture((_request, n) =>
    rawAssessment({
      checks: [{ id: "function-concept-c1", parts: [responses[n - 1]] }],
    }),
  );
  try {
    const a = await f.evaluate(inputFor([first]));
    assert.equal(a.checks[0].met, false);
    assert.equal(
      a.checks[0].parts?.find((p) => p.id === "unique")?.status,
      "met",
    );
    const b = await f.evaluate(
      inputFor([first, second], { previousChecks: a.checks }),
    );
    assert.equal(
      b.checks[0].parts?.find((p) => p.id === "unique")?.status,
      "met",
    );
    assert.equal(
      b.checks[0].parts?.find((p) => p.id === "nonempty")?.status,
      "met",
    );
    const c = await f.evaluate(
      inputFor([first, second, wrong], { previousChecks: b.checks }),
    );
    assert.equal(
      c.checks[0].parts?.find((p) => p.id === "unique")?.status,
      "incorrect",
    );
    assert.equal(
      c.checks[0].parts?.find((p) => p.id === "nonempty")?.status,
      "met",
    );
  } finally {
    await f.close();
  }
});

test("格式失败自动重试一次；连续失败明确说明是系统未能评价", async () => {
  const f = await modelFixture((_request, n) =>
    n === 1 ? "not JSON" : rawAssessment(),
  );
  try {
    const r = await f.evaluate(inputFor([studentMessage("a", "我来讲定义域")]));
    assert.equal(r.modelAttempts, 2);
    assert.equal(f.requests.length, 2);
  } finally {
    await f.close();
  }
  const envelope = await modelFixture((_request, n) =>
    n === 1 ? new Response("invalid outer JSON") : rawAssessment(),
  );
  try {
    const r = await envelope.evaluate(
      inputFor([studentMessage("a", "我来讲定义域")]),
    );
    assert.equal(r.modelAttempts, 2);
  } finally {
    await envelope.close();
  }
  const broken = await modelFixture(() => "not JSON");
  try {
    await assert.rejects(
      () => broken.evaluate(inputFor([studentMessage("a", "我来讲定义域")])),
      /系统未能评价.*不表示回答错误/,
    );
    assert.equal(broken.requests.length, 2);
  } finally {
    await broken.close();
  }
});

test("本题有效理由与修正可以通过，不要求其他整课知识点同时达标", async () => {
  const m = studentMessage(
    "answer",
    "这两个函数的定义域不同，所以值域不同，所以不是同一个函数",
    "judge",
    0,
  );
  const f = await modelFixture(() =>
    rawAssessment({
      reasoningAccepted: true,
      corrected: true,
      reasoningEvidence: [evidence(m.id, m.body)],
      correctionEvidence: [evidence(m.id, m.body)],
    }),
  );
  try {
    const r = await f.evaluate(inputFor([m]));
    assert.equal(r.reasoningAccepted, true);
    assert.equal(r.corrected, true);
    assert.ok(r.checks.every((c) => !c.met));
    assert.equal(r.reviewRequired, false);
  } finally {
    await f.close();
  }
});

test("追问指向已经满足的子项时重新评价，不把过时问题直接发给学生", async () => {
  const m = studentMessage("answer", "同一个输入只有一个输出");
  const f = await modelFixture(() =>
    rawAssessment({
      checks: [
        {
          id: "function-concept-c1",
          parts: [
            { id: "unique", status: "met", evidence: [evidence(m.id, m.body)] },
          ],
        },
      ],
      issue: {
        key: "function-concept-c1",
        partId: "unique",
        kind: "missing",
        question: "同一个输入能有几个输出？",
        correction: "只能有一个输出。",
      },
    }),
  );
  try {
    const r = await f.evaluate(inputFor([m]));
    assert.equal(r.reviewRequired, true);
    assert.equal(f.requests.length, 2);
    assert.equal(r.issue, null);
  } finally {
    await f.close();
  }
});

test("尚未纠正的旧错误可继续引用，不能借较早的正确原话抹去新错误", async () => {
  const right = studentMessage("right", "同一个输入只有一个输出");
  const wrong = studentMessage("wrong", "同一个输入可以有两个输出");
  const extra = studentMessage("extra", "定义域不能是空集");
  const f = await modelFixture((_request, n) =>
    rawAssessment({
      checks: [
        {
          id: "function-concept-c1",
          parts: [
            {
              id: "unique",
              status: n < 3 ? "incorrect" : "met",
              evidence: [
                evidence(
                  n < 3 ? wrong.id : right.id,
                  n < 3 ? wrong.body : right.body,
                ),
              ],
            },
          ],
        },
      ],
    }),
  );
  try {
    const first = await f.evaluate(inputFor([right, wrong]));
    const second = await f.evaluate(
      inputFor([right, wrong, extra], { previousChecks: first.checks }),
    );
    assert.equal(second.reviewRequired, false);
    assert.equal(
      second.checks[0].parts?.find((p) => p.id === "unique")?.status,
      "incorrect",
    );
    const third = await f.evaluate(
      inputFor([right, wrong, extra], { previousChecks: second.checks }),
    );
    assert.equal(third.reviewRequired, true);
    assert.equal(
      third.checks[0].parts?.find((p) => p.id === "unique")?.status,
      "incorrect",
    );
  } finally {
    await f.close();
  }
});

test("非奇非偶的口语结论可以补全修正，但不能单独充当理由", async () => {
  const conclusion = studentMessage("conclusion", "什么都不是呀", "judge");
  const reason = studentMessage(
    "reason",
    "1属于定义域，它的相反数不在里面",
    "judge",
  );
  let includeReason = false;
  const f = await modelFixture(() =>
    rawAssessment({
      reasoningAccepted: true,
      corrected: true,
      reasoningEvidence: [
        includeReason
          ? evidence(reason.id, reason.body)
          : evidence(conclusion.id, conclusion.body),
      ],
      correctionEvidence: [evidence(conclusion.id, conclusion.body)],
    }),
  );
  try {
    const alone = await f.evaluate(inputFor([conclusion]));
    assert.equal(alone.reasoningAccepted, false);
    includeReason = true;
    const together = await f.evaluate(inputFor([reason, conclusion]));
    assert.equal(together.reasoningAccepted, true);
    assert.equal(together.corrected, true);
    const offTopic = await f.evaluate(
      inputFor([
        reason,
        conclusion,
        studentMessage("new", "今天午餐几点", "judge"),
      ]),
    );
    assert.equal(offTopic.reasoningAccepted, false);
  } finally {
    await f.close();
  }
});
