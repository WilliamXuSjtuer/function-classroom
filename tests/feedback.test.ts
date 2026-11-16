import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, goodEvaluation } from "./helpers.js";
import ExcelJS from "exceljs";
import unzipper from "unzipper";

test("学生补充理由后收到针对新回答的追问，第三轮才给明确说明", async () => {
  const replies = [
    "我想知道两个根式的限制要怎样一起考虑。",
    "我明白要同时满足了！那分别有什么限制，有共同的 x 吗？",
    "我还有一点困惑。",
  ];
  let turn = 0;
  const f = await fixture(async (input) => ({
    ...(await goodEvaluation(input)),
    feedback: replies[turn++],
    reasoningAccepted: false,
    corrected: false,
  }));
  try {
    const c = await f.classroom(1);
    const s = await f.open(c.id);
    await f.control(s.id);
    await f.control(s.id);
    await f.control(s.id);
    await f.control(s.id, "next-exercise");
    const d = await f.control(s.id);
    for (const [i, body] of [
      "我觉得是对的",
      "需要同时满足",
      "我还不懂",
    ].entries()) {
      const sent = await f.request(
        "POST",
        `/sessions/${s.id}/messages`,
        {
          body,
          judgment: true,
          revision: d.session.revision,
          clientId: randomUUID(),
        },
        c.cookies[0],
        202,
      );
      const after = await f.waitFor(s.id, c.cookies[0], (x) =>
        x.messages.some((m: any) => m.replyTo === sent.id),
      );
      const reply = after.messages.find((m: any) => m.replyTo === sent.id).body;
      if (i < 2) assert.equal(reply, replies[i]);
      else assert.match(reply, /不存在这样的/);
      assert.notEqual(
        after.participant.judgments["concept-02"].status,
        "achieved",
      );
    }
  } finally {
    await f.close();
  }
});

test("教师可核对多条细项证据并导出，学生接口不暴露细项审核标准", async () => {
  const f = await fixture(async (input) => {
    const base = await goodEvaluation(input);
    const m = input.messages.filter((m) => m.role === "student").at(-1)!;
    return {
      ...base,
      checks: [
        {
          ...base.checks[0],
          parts: [
            {
              id: "unique",
              label: "教师审核标准：同一个输入只有一个输出",
              status: "met",
              evidence: [{ messageId: m.id, quote: m.body, kind: "text" }],
            },
          ],
        },
      ],
      modelAttempts: 1,
    };
  });
  try {
    const c = await f.classroom(1);
    const s = await f.open(c.id);
    const d = await f.control(s.id);
    const sent = await f.request(
      "POST",
      `/sessions/${s.id}/messages`,
      {
        body: "同一个输入只有一个输出",
        revision: d.session.revision,
        clientId: randomUUID(),
      },
      c.cookies[0],
      202,
    );
    const teacher = await f.waitFor(s.id, f.teacher, (x) =>
      x.messages.some((m: any) => m.replyTo === sent.id),
    );
    assert.equal(
      teacher.participant.checks[0].parts[0].evidence[0].messageId,
      sent.id,
    );
    const student = await f.request(
      "GET",
      `/sessions/${s.id}`,
      undefined,
      c.cookies[0],
    );
    assert.equal(student.participant.checks[0].parts, undefined);
    assert.ok(!JSON.stringify(student).includes("教师审核标准"));
    const response = await fetch(`${f.base}/api/classes/${c.id}/export`, {
      headers: { Cookie: f.teacher },
    });
    const zip = await unzipper.Open.buffer(
      Buffer.from(await response.arrayBuffer()),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      await zip.files.find((x) => x.path === "课堂过程记录.xlsx")!.buffer(),
    );
    const row = workbook.getWorksheet("细项证据")!.getRow(2);
    assert.equal(row.getCell(4).value, sent.id);
    assert.equal(row.getCell(9).value, sent.id);
    assert.equal(row.getCell(11).value, "同一个输入只有一个输出");
    const performance = workbook.getWorksheet("任务表现")!;
    assert.equal(performance.getCell("S1").value, "讲解评价状态");
    assert.equal(performance.getCell("S2").value, "evaluated");
  } finally {
    await f.close();
  }
});

test("系统失败和证据待复核与学习状态分开，未核验反馈不增加追问或通过任务", async () => {
  let fail = true;
  const f = await fixture(async (input) => {
    if (fail) throw Error("系统未能评价：格式错误");
    return {
      ...(await goodEvaluation(input)),
      reviewRequired: true,
      validationWarnings: ["证据来源无法核验"],
    };
  });
  try {
    const c = await f.classroom(1);
    const s = await f.open(c.id);
    const d = await f.control(s.id);
    const sent = await f.request(
      "POST",
      `/sessions/${s.id}/messages`,
      {
        body: "同一个输入只有一个输出",
        revision: d.session.revision,
        clientId: randomUUID(),
      },
      c.cookies[0],
      202,
    );
    const failed = await f.waitFor(s.id, c.cookies[0], (x) =>
      x.messages.some((m: any) => m.id === sent.id && m.status === "failed"),
    );
    assert.equal(failed.participant.explainEvaluationStatus, "failed");
    assert.equal(failed.participant.evaluationFailures, 1);
    fail = false;
    await f.request(
      "POST",
      `/messages/${sent.id}/retry`,
      {},
      c.cookies[0],
      202,
    );
    const reviewed = await f.waitFor(s.id, f.teacher, (x) =>
      x.messages.some((m: any) => m.replyTo === sent.id),
    );
    assert.equal(reviewed.participant.explainEvaluationStatus, "review");
    assert.equal(reviewed.participant.evaluationFailures, 0);
    assert.notEqual(reviewed.participant.explainStatus, "achieved");
    assert.equal(reviewed.participant.explainHints, 0);
    assert.equal(reviewed.participant.explainCorrections, 0);
    assert.match(reviewed.messages.at(-1).body, /老师/);
    await f.control(s.id, "end");
    const ended = await f.request(
      "GET",
      `/sessions/${s.id}`,
      undefined,
      f.teacher,
    );
    assert.equal(ended.participant.explainEvaluationStatus, "review");
  } finally {
    await f.close();
  }
});

test("正确但不完整的讲解补充条件，不计为明确纠错；不同子项分别追问", async () => {
  let turn = 0;
  const f = await fixture(async (input) => ({
    ...(await goodEvaluation(input)),
    feedback: "你讲的唯一性我懂了，还想了解剩下的条件。",
    checks: [],
    issue: {
      key: input.lesson.checklist[0].id,
      partId: ++turn <= 3 ? "total" : "nonempty",
      kind: "missing",
      question:
        turn <= 3 ? "可不可以有一个 x 没有输出？" : "定义域能不能没有元素？",
      correction: "定义域中的每一个输入都要有输出。",
    },
  }));
  try {
    const c = await f.classroom(1);
    const s = await f.open(c.id);
    const d = await f.control(s.id);
    for (let i = 0; i < 4; i++) {
      const sent = await f.request(
        "POST",
        `/sessions/${s.id}/messages`,
        {
          body: "多个不同的 x 可以对应同一个 y，但是同一个 x 不能对应不同的 y",
          revision: d.session.revision,
          clientId: randomUUID(),
        },
        c.cookies[0],
        202,
      );
      const after = await f.waitFor(s.id, f.teacher, (x) =>
        x.messages.some((m: any) => m.replyTo === sent.id),
      );
      const reply = after.messages.find((m: any) => m.replyTo === sent.id).body;
      assert.doesNotMatch(reply, /需要改一下|讲错|有误/);
      assert.equal(after.participant.explainCorrections, 0);
      if (i === 2) assert.equal(after.participant.explainSupplements, 1);
      if (i === 3) assert.match(reply, /能不能没有元素/);
    }
  } finally {
    await f.close();
  }
});
