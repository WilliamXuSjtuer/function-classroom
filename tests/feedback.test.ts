import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, goodEvaluation } from "./helpers.js";
import ExcelJS from "exceljs";
import unzipper from "unzipper";

test("例题通过后明确收尾，保留全部提交并单列有效作答和达标后交流", async () => {
  let calls = 0;
  const f = await fixture(async (input) => {
    calls++;
    const body = input.messages
      .filter((m) => m.role === "student")
      .at(-1)!.body;
    if (body === "没错" || body === "你还有别的问题吗")
      throw Error("收尾无需重新评价");
    return {
      ...(await goodEvaluation(input)),
      reasoningAccepted: calls > 1,
      corrected: calls > 1,
      feedback:
        calls > 1
          ? "那 a=1 和 a=5/2 分别满足各自的区间吗？"
          : "那正确的 a 是哪些数？",
    };
  });
  try {
    const c = await f.classroom(1);
    const s = await f.open(c.id, 1);
    await f.control(s.id);
    await f.control(s.id);
    await f.control(s.id);
    await f.control(s.id, "next-exercise");
    const d = await f.control(s.id);
    const send = async (body: string, judgment?: boolean) => {
      const sent = await f.request(
        "POST",
        `/sessions/${s.id}/messages`,
        {
          body,
          judgment,
          revision: d.session.revision,
          clientId: randomUUID(),
        },
        c.cookies[0],
        202,
      );
      const after = await f.waitFor(s.id, f.teacher, (x) =>
        x.messages.some((m: any) => m.replyTo === sent.id),
      );
      return { sent, after };
    };
    await send("a=±2不属于1<x<2，应该舍去", false);
    const { sent, after } = await send("a=1或a=2.5", false);
    const first = after.participant.judgments["representation-02"];
    assert.equal(first.status, "achieved");
    const reply = after.messages.find((m: any) => m.replyTo === sent.id).body;
    assert.match(reply, /教给我|明白/);
    assert.doesNotMatch(reply, /[？?]|分别满足/);
    assert.equal(first.firstAchievedMessageId, sent.id);
    assert.ok(first.firstAchievedAt);
    await send("没错");
    const { after: closed } = await send("你还有别的问题吗");
    const record = closed.participant.judgments["representation-02"];
    assert.equal(record.status, "achieved");
    assert.equal(record.attempts, 4);
    assert.equal(record.answerAttempts, 2);
    assert.equal(record.postAchievementMessages, 2);
    assert.equal(record.firstAchievedAt, first.firstAchievedAt);
    assert.equal(record.hints, 1);
    assert.equal(calls, 2);
    assert.equal(record.evaluationStatus, "evaluated");
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
    const sheet = workbook.getWorksheet("任务表现")!;
    const values = sheet.getRow(1).values as string[];
    const row = sheet.getRow(3);
    assert.equal(
      row.getCell(values.indexOf("有效作答次数（首次达标前）")).value,
      2,
    );
    assert.equal(
      row.getCell(values.indexOf("首次达标消息编号")).value,
      sent.id,
    );
    assert.equal(row.getCell(values.indexOf("首次达标后提交次数")).value, 2);
  } finally {
    await f.close();
  }
});

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

test("请求澄清不消耗追问次数，新端点问题不继承选段计数", async () => {
  let turn = 0;
  const f = await fixture(async (input) => {
    turn++;
    const base = await goodEvaluation(input);
    return {
      ...base,
      checks: [],
      feedback:
        "我说的是x<0时f(x)=x+1，x≥0时f(x)=x²这个分段函数；x=2要用哪一段？",
      issue: {
        key: "function-representation-c2",
        partId: turn < 4 ? "interval" : "endpoint",
        kind: "missing",
        question:
          turn < 4 ? "x=2时，先看什么来选段？" : "那x=0应该选哪一段，为什么？",
        correction: "x=0属于带等号的那一段。",
      },
    };
  });
  try {
    const c = await f.classroom(1),
      s = await f.open(c.id, 1);
    const d = await f.control(s.id);
    const bodies = [
      "我先讲列表法",
      "什么分段函数",
      "能解释一下吗",
      "x=2满足x≥0所以用x²",
    ];
    for (const [i, body] of bodies.entries()) {
      const sent = await f.request(
        "POST",
        `/sessions/${s.id}/messages`,
        { body, revision: d.session.revision, clientId: randomUUID() },
        c.cookies[0],
        202,
      );
      const after = await f.waitFor(s.id, f.teacher, (x) =>
        x.messages.some((m: any) => m.replyTo === sent.id),
      );
      assert.equal(after.participant.explainHints, i === 3 ? 2 : 1);
      assert.equal(after.participant.explainSupplements, 0);
      if (i === 1 || i === 2) {
        assert.match(
          after.messages.find((m: any) => m.replyTo === sent.id).body,
          /x<0时/,
        );
        assert.equal(
          after.messages.find((m: any) => m.id === sent.id).evaluation
            .interaction.kind,
          "clarification",
        );
      }
      if (i === 3)
        assert.match(
          after.messages.find((m: any) => m.replyTo === sent.id).body,
          /x=0应该选哪一段/,
        );
    }
  } finally {
    await f.close();
  }
});

test("达标后的反对意见仍需评价，不能当作收尾而忽略新的错误判断", async () => {
  let calls = 0;
  const f = await fixture(async (input) => {
    calls++;
    return goodEvaluation(input);
  });
  try {
    const c = await f.classroom(1),
      s = await f.open(c.id, 1);
    await f.control(s.id);
    await f.control(s.id);
    const d = await f.control(s.id);
    for (const [body, judgment] of [
      ["每次先确定输入区间再代入，内层算出4，外层算得7", true],
      ["你做的不对", false],
    ] as const) {
      const sent = await f.request(
        "POST",
        `/sessions/${s.id}/messages`,
        {
          body,
          judgment,
          revision: d.session.revision,
          clientId: randomUUID(),
        },
        c.cookies[0],
        202,
      );
      const after = await f.waitFor(s.id, f.teacher, (x) =>
        x.messages.some((m: any) => m.replyTo === sent.id),
      );
      const j = after.participant.judgments["representation-01"];
      if (judgment) assert.equal(j.status, "achieved");
      else {
        assert.notEqual(j.status, "achieved");
        assert.ok(j.firstAchievedAt, "仍保留首次达标历史");
        assert.equal(j.answerAttempts, 1);
        assert.equal(j.postAchievementMessages, 1);
      }
    }
    assert.equal(calls, 2);
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

test("已达标后补充回答遇到系统失败或待复核，不撤销此前达标状态", async () => {
  const f = await fixture(async (input) => {
    const body = input.messages
      .filter((m) => m.role === "student")
      .at(-1)!.body;
    if (body === "补充系统失败") throw Error("系统未能评价");
    return {
      ...(await goodEvaluation(input)),
      reviewRequired: body === "补充等待复核",
    };
  });
  try {
    const c = await f.classroom(1);
    const s = await f.open(c.id);
    let d = await f.control(s.id);
    for (let stageIndex = 0; stageIndex < 3; stageIndex++) {
      if (stageIndex === 1) {
        await f.control(s.id);
        d = await f.control(s.id);
      }
      if (stageIndex === 2) {
        await f.control(s.id, "next-exercise");
        d = await f.control(s.id);
      }
      for (const body of ["正确且完整的解释", "补充等待复核", "补充系统失败"]) {
        const sent = await f.request(
          "POST",
          `/sessions/${s.id}/messages`,
          {
            body,
            revision: d.session.revision,
            clientId: randomUUID(),
            ...(stageIndex
              ? { judgment: s.lesson.exercises[stageIndex - 1].isCorrect }
              : {}),
          },
          c.cookies[0],
          202,
        );
        const after = await f.waitFor(s.id, f.teacher, (x) =>
          x.messages.some(
            (m: any) => m.id === sent.id && m.status !== "pending",
          ),
        );
        const state = stageIndex
          ? after.participant.judgments[s.lesson.exercises[stageIndex - 1].id]
              .status
          : after.participant.explainStatus;
        assert.equal(state, "achieved", `${d.session.stage}: ${body}`);
      }
    }
    const end = await f.control(s.id, "end");
    assert.equal(end.participant.pending, false);
    assert.equal(end.participant.evaluationFailures, 3);
  } finally {
    await f.close();
  }
});

test("教师保存超过20条的单项细分标准时获得明确提示", async () => {
  const f = await fixture();
  try {
    const boot = await f.request("GET", "/bootstrap", undefined, f.teacher);
    const lesson = boot.lessons[0];
    const rejected = await f.request(
      "PUT",
      `/lessons/${lesson.id}`,
      {
        revision: lesson.revision,
        lesson: {
          ...lesson,
          checklist: lesson.checklist.map((c: any, i: number) =>
            i
              ? c
              : {
                  ...c,
                  criterion: Array.from(
                    { length: 21 },
                    (_, i) => `条件${i + 1}`,
                  ).join("\n"),
                },
          ),
        },
      },
      f.teacher,
      400,
    );
    assert.match(JSON.stringify(rejected), /20/);
  } finally {
    await f.close();
  }
});
