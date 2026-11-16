import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import unzipper from "unzipper";
import sharp from "sharp";
import { fixture, goodEvaluation } from "./helpers.js";
const png = await sharp({
  create: { width: 20, height: 20, channels: 3, background: "#ffffff" },
})
  .png()
  .toBuffer();
test("旧失败消息不能覆盖后续已达标的判断；发布时校验审核版本", async () => {
  let judgments = 0;
  const f = await fixture(async (input) => {
    if (input.stage === "judge" && ++judgments === 1) throw Error("暂时失败");
    return goodEvaluation(input);
  });
  try {
    const c = await f.classroom(1);
    const s = await f.open(c.id);
    const boot = await f.request("GET", "/bootstrap", undefined, f.teacher);
    const lesson = boot.lessons[0];
    await f.request(
      "PUT",
      `/lessons/${lesson.id}`,
      {
        lesson: { ...lesson, subtitle: "新版课时说明" },
        revision: lesson.revision,
      },
      f.teacher,
    );
    await f.request(
      "POST",
      `/lessons/${lesson.id}/publish`,
      { revision: lesson.revision },
      f.teacher,
      409,
    );
    await f.control(s.id);
    await f.control(s.id);
    const d = await f.control(s.id);
    const old = await f.request(
      "POST",
      `/sessions/${s.id}/messages`,
      {
        body: "旧判断理由。",
        judgment: !s.lesson.exercises[0].isCorrect,
        revision: d.session.revision,
        clientId: randomUUID(),
      },
      c.cookies[0],
      202,
    );
    await f.waitFor(s.id, c.cookies[0], (x) =>
      x.messages.some((m: any) => m.id === old.id && m.status === "failed"),
    );
    await f.request(
      "POST",
      `/sessions/${s.id}/messages`,
      {
        body: "我补充正确依据并修正错误。",
        judgment: s.lesson.exercises[0].isCorrect,
        revision: d.session.revision,
        clientId: randomUUID(),
      },
      c.cookies[0],
      202,
    );
    await f.waitFor(
      s.id,
      c.cookies[0],
      (x) =>
        x.participant.judgments[s.lesson.exercises[0].id]?.status ===
        "achieved",
    );
    await f.request("POST", `/messages/${old.id}/retry`, {}, c.cookies[0], 409);
    const final = await f.request(
      "GET",
      `/sessions/${s.id}`,
      undefined,
      c.cookies[0],
    );
    assert.equal(
      final.participant.judgments[s.lesson.exercises[0].id].status,
      "achieved",
    );
    assert.equal(final.lesson.subtitle, s.lesson.subtitle);
  } finally {
    await f.close();
  }
});
test("全部任务完成的学生不会被错误标记为待补", async () => {
  const f = await fixture();
  try {
    const c = await f.classroom(1);
    const s = await f.open(c.id);
    let d = await f.control(s.id);
    await f.request(
      "POST",
      `/sessions/${s.id}/messages`,
      {
        body: "定义域说明完整。",
        revision: d.session.revision,
        clientId: randomUUID(),
      },
      c.cookies[0],
      202,
    );
    await f.waitFor(
      s.id,
      f.teacher,
      (x) => x.participant.explainStatus === "achieved",
    );
    d = await f.control(s.id);
    for (let i = 0; i < s.lesson.exercises.length; i++) {
      d = await f.control(s.id);
      assert.equal(d.session.stage, "judge");
      assert.equal(d.participant.pending, false);
      await f.request(
        "POST",
        `/sessions/${s.id}/messages`,
        {
          body: "根据定义域条件判断，并写出完整修正。",
          judgment: s.lesson.exercises[i].isCorrect,
          revision: d.session.revision,
          clientId: randomUUID(),
        },
        c.cookies[0],
        202,
      );
      await f.waitFor(
        s.id,
        f.teacher,
        (x) =>
          x.participant.judgments[s.lesson.exercises[i].id]?.status ===
          "achieved",
      );
      if (i + 1 < s.lesson.exercises.length)
        d = await f.control(s.id, "next-exercise");
    }
    d = await f.control(s.id, "end");
    assert.equal(d.participant.pending, false);
    assert.equal(d.participant.explainStatus, "achieved");
    await f.request(
      "POST",
      `/classes/${c.id}/sessions`,
      { lessonId: s.lesson.id, mode: "makeup", parentId: s.id },
      f.teacher,
      400,
    );
    const bootstrap = await f.request(
      "GET",
      "/bootstrap",
      undefined,
      c.cookies[0],
    );
    assert.equal(bootstrap.sessions[0].pending, false);
  } finally {
    await f.close();
  }
});
test("班级登录、草稿发布、阶段授权与答案隔离", async () => {
  const f = await fixture();
  try {
    const c = await f.classroom();
    const boot = await f.request("GET", "/bootstrap", undefined, f.teacher);
    const lesson = boot.lessons[0];
    await f.request(
      "POST",
      `/classes/${c.id}/sessions`,
      { lessonId: lesson.id, mode: "classroom" },
      f.teacher,
      400,
    );
    const s = await f.open(c.id);
    const d = await f.request(
      "GET",
      `/sessions/${s.id}`,
      undefined,
      c.cookies[0],
    );
    assert.equal(d.session.stage, "reading");
    assert.equal(d.lesson.exercises[0].attempt, undefined);
    for (const field of [
      "correctAnswer",
      "isCorrect",
      "errorExplanation",
      "criterion",
    ])
      assert.equal(JSON.stringify(d).includes(`"${field}"`), false, field);
    await f.request(
      "POST",
      `/sessions/${s.id}/messages`,
      { body: "定义域", revision: d.session.revision, clientId: randomUUID() },
      c.cookies[0],
      409,
    );
    await f.request(
      "POST",
      `/sessions/${s.id}/control`,
      { action: "advance", revision: 1 },
      c.cookies[0],
      403,
    );
    const explained = await f.control(s.id);
    assert.equal(explained.session.stage, "explain");
    await f.request(
      "POST",
      `/sessions/${s.id}/control`,
      { action: "advance", revision: 1 },
      f.teacher,
      409,
    );
    await f.request(
      "POST",
      `/classes/${c.id}/students`,
      { students: [{ username: c.students[0].username, name: "重复学号" }] },
      f.teacher,
      409,
    );
    const roster = await f.request(
      "GET",
      `/classes/${c.id}/students`,
      undefined,
      f.teacher,
    );
    assert.equal(roster.length, 2);
    assert.equal(roster[0].username, "00010001");
  } finally {
    await f.close();
  }
});
test("幂等提交、跨学生图片隔离和真实导出附件", async () => {
  const f = await fixture();
  try {
    const c = await f.classroom();
    const s = await f.open(c.id);
    await f.control(s.id);
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "手写.png");
    const attachment = await f.request(
      "POST",
      `/sessions/${s.id}/attachments`,
      form,
      c.cookies[0],
      201,
    );
    const denied = await fetch(f.base + attachment.url, {
      headers: { Cookie: c.cookies[1] },
    });
    assert.equal(denied.status, 404);
    const body = {
      body: "定义域必须关于原点对称。",
      attachments: [attachment.id],
      revision: 2,
      clientId: randomUUID(),
    };
    await f.request(
      "POST",
      `/sessions/${s.id}/messages`,
      body,
      c.cookies[0],
      202,
    );
    await f.request("POST", `/sessions/${s.id}/messages`, body, c.cookies[0]);
    const done = await f.waitFor(s.id, c.cookies[0], (d) =>
      d.messages.some((m: any) => m.role === "assistant"),
    );
    assert.equal(
      done.messages.filter((m: any) => m.role === "student").length,
      1,
    );
    assert.equal(done.messages[0].evaluation, undefined);
    assert.equal(done.messages[0].attachments.length, 1);
    await f.request(
      "POST",
      `/sessions/${s.id}/messages`,
      { ...body, clientId: randomUUID() },
      c.cookies[1],
      400,
    );
    const response = await fetch(`${f.base}/api/classes/${c.id}/export`, {
      headers: { Cookie: f.teacher },
    });
    assert.equal(response.status, 200);
    const zip = await unzipper.Open.buffer(
      Buffer.from(await response.arrayBuffer()),
    );
    const workbookEntry = zip.files.find(
      (x) => x.path === "课堂过程记录.xlsx",
    )!;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await workbookEntry.buffer());
    assert.deepEqual(
      workbook.worksheets.map((s) => s.name),
      ["原始对话", "任务表现", "评价依据", "课堂事件", "细项证据"],
    );
    assert.equal(
      workbook.getWorksheet("原始对话")!.getCell("A2").value,
      "00010001",
    );
    assert.ok(
      zip.files.some(
        (x) => x.path.startsWith("images/") && x.path.endsWith(".webp"),
      ),
    );
    assert.equal(
      workbook.getWorksheet("原始对话")!.getCell("O2").value,
      body.body,
    );
    const studentExport = await fetch(`${f.base}/api/classes/${c.id}/export`, {
      headers: { Cookie: c.cookies[0] },
    });
    assert.equal(studentExport.status, 403);
  } finally {
    await f.close();
  }
});
test("阶段切换保留待补，迟到的模型评价不覆盖新阶段", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const f = await fixture(async (input) => {
    await gate;
    return goodEvaluation(input);
  });
  try {
    const c = await f.classroom(1);
    const s = await f.open(c.id);
    await f.control(s.id);
    await f.request(
      "POST",
      `/sessions/${s.id}/messages`,
      { body: "定义域", revision: 2, clientId: randomUUID() },
      c.cookies[0],
      202,
    );
    await f.control(s.id);
    release();
    const d = await f.waitFor(s.id, f.teacher, (x) =>
      x.messages.some((m: any) => m.evaluation),
    );
    assert.equal(d.session.stage, "attempt");
    assert.equal(d.participant.explainStatus, "pending");
    assert.equal(d.participant.pending, true);
    assert.equal(
      d.messages.find((m: any) => m.evaluation).evaluation.phaseStale,
      true,
    );
    await f.control(s.id, "end");
    const ended = await f.request(
      "GET",
      `/sessions/${s.id}`,
      undefined,
      c.cookies[0],
    );
    assert.equal(ended.session.stage, "ended");
    await f.request(
      "POST",
      `/sessions/${s.id}/messages`,
      {
        body: "继续",
        revision: ended.session.revision,
        clientId: randomUUID(),
      },
      c.cookies[0],
      409,
    );
    const makeup = await f.request(
      "POST",
      `/classes/${c.id}/sessions`,
      { lessonId: s.lesson.id, mode: "makeup", parentId: s.id },
      f.teacher,
      201,
    );
    const md = await f.request(
      "GET",
      `/sessions/${makeup.id}`,
      undefined,
      c.cookies[0],
    );
    assert.equal(md.session.parentId, s.id);
    assert.equal(md.session.mode, "makeup");
    await f.request(
      "POST",
      `/classes/${c.id}/students`,
      { students: [{ username: "00020002", name: "新加入学生" }] },
      f.teacher,
      201,
    );
    const newcomer = await f.login("00020002", "0002");
    await f.request("GET", `/sessions/${makeup.id}`, undefined, newcomer, 404);
  } finally {
    release();
    await f.close();
  }
});
test("同一问题先追问两轮，之后明确纠错，判断必须有理由且首次判断不可覆盖", async () => {
  const f = await fixture(async (input) => ({
    ...(await goodEvaluation(input)),
    checks: input.lesson.checklist.map((c) => ({
      id: c.id,
      met: false,
      evidenceMessageId: null,
      quote: "",
    })),
    issue: {
      key: input.lesson.checklist[0].id,
      question: "定义域需要满足什么条件呀？",
      correction: "定义域需要关于原点对称。",
    },
    reasoningAccepted: false,
    corrected: false,
  }));
  try {
    const c = await f.classroom(1);
    const s = await f.open(c.id);
    await f.control(s.id);
    for (let i = 0; i < 3; i++) {
      await f.request(
        "POST",
        `/sessions/${s.id}/messages`,
        { body: "定义域我还不明白", revision: 2, clientId: randomUUID() },
        c.cookies[0],
        202,
      );
      const d = await f.waitFor(
        s.id,
        c.cookies[0],
        (d) =>
          d.messages.filter((m: any) => m.role === "assistant").length ===
          i + 1,
      );
      const answer = d.messages.at(-1).body;
      if (i < 2) assert.equal(answer, "定义域需要满足什么条件呀？");
      else assert.match(answer, /定义域需要关于原点对称/);
    }
    await f.control(s.id);
    const judge = await f.control(s.id);
    assert.equal(judge.session.stage, "judge");
    await f.request(
      "POST",
      `/sessions/${s.id}/messages`,
      { body: "", judgment: false, revision: 4, clientId: randomUUID() },
      c.cookies[0],
      400,
    );
    await f.request(
      "POST",
      `/sessions/${s.id}/messages`,
      {
        body: "我认为有错误，但还没解释。",
        judgment: false,
        revision: 4,
        clientId: randomUUID(),
      },
      c.cookies[0],
      202,
    );
    await f.waitFor(
      s.id,
      c.cookies[0],
      (d) =>
        d.messages.filter(
          (m: any) => m.stage === "judge" && m.role === "assistant",
        ).length === 1,
    );
    await f.request(
      "POST",
      `/sessions/${s.id}/messages`,
      {
        body: "我改变判断，认为正确。",
        judgment: true,
        revision: 4,
        clientId: randomUUID(),
      },
      c.cookies[0],
      202,
    );
    const result = await f.waitFor(
      s.id,
      f.teacher,
      (d) =>
        d.messages.filter(
          (m: any) => m.stage === "judge" && m.role === "assistant",
        ).length === 2,
    );
    const record = result.participant.judgments[s.lesson.exercises[0].id];
    assert.equal(record.firstJudgment, false);
    assert.equal(record.attempts, 2);
    assert.notEqual(record.status, "achieved");
  } finally {
    await f.close();
  }
});
test("模型失败保留原文且重试不增加作答次数；密码重置使旧登录失效", async () => {
  let failed = true;
  const f = await fixture(async (input) => {
    if (failed) throw Error("模型不可用");
    return goodEvaluation(input);
  });
  try {
    const c = await f.classroom(1);
    const s = await f.open(c.id);
    await f.control(s.id);
    const result = await f.request(
      "POST",
      `/sessions/${s.id}/messages`,
      { body: "定义域应检查。", revision: 2, clientId: randomUUID() },
      c.cookies[0],
      202,
    );
    const d = await f.waitFor(
      s.id,
      c.cookies[0],
      (d) => d.messages[0]?.status === "failed",
    );
    assert.equal(d.messages[0].body, "定义域应检查。");
    failed = false;
    await f.request(
      "POST",
      `/messages/${result.id}/retry`,
      {},
      c.cookies[0],
      202,
    );
    const retried = await f.waitFor(
      s.id,
      c.cookies[0],
      (d) => d.messages[0]?.status === "done",
    );
    assert.equal(
      retried.messages.filter((m: any) => m.role === "student").length,
      1,
    );
    const students = await f.request(
      "GET",
      `/classes/${c.id}/students`,
      undefined,
      f.teacher,
    );
    await f.request(
      "POST",
      `/students/${students[0].id}/reset-password`,
      {},
      f.teacher,
    );
    await f.request("GET", "/me", undefined, c.cookies[0], 401);
    await f.login(c.students[0].username, c.students[0].username.slice(-4));
  } finally {
    await f.close();
  }
});
