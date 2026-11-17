import { test } from "node:test";
import assert from "node:assert/strict";
import type { Participant, SessionDetail } from "../shared/types.js";
import {
  classroomProgress,
  latestExchange,
  matchesProgress,
} from "../src/progress.js";
import { fixture } from "./helpers.js";
import { randomUUID } from "node:crypto";
import { studentMessage } from "./model-helpers.js";

const student = (
  username: string,
  overrides: Partial<Participant> = {},
): Participant => ({
  userId: username,
  username,
  name: `同学${username}`,
  explainStatus: "not_started",
  explainEvaluationStatus: "not_submitted",
  checks: [],
  judgments: {},
  pending: false,
  messageCount: 0,
  explainHints: 0,
  explainCorrections: 0,
  lastActivity: null,
  ...overrides,
});

test("切换例题后只统计本题，旧题失败与旧讲解达标不影响当前总览", () => {
  const students = [
    student("01", {
      explainStatus: "achieved",
      explainEvaluationStatus: "failed",
      evaluationFailures: 2,
      judgments: {
        one: {
          firstJudgment: false,
          firstCorrect: true,
          status: "achieved",
          attempts: 2,
          hints: 0,
          evaluationStatus: "failed",
        },
      },
    }),
    student("02", {
      judgments: {
        two: {
          firstJudgment: true,
          firstCorrect: true,
          status: "in_progress",
          attempts: 1,
          hints: 0,
          evaluationStatus: "processing",
        },
      },
    }),
  ];
  const current = classroomProgress({ ...context("judge", 1), students });
  assert.deepEqual(current.counts, {
    achieved: 0,
    in_progress: 1,
    not_submitted: 1,
    needs_help: 0,
  });
  assert.deepEqual(current.evaluations, {
    processing: 1,
    failed: 0,
    review: 0,
  });
  assert.deepEqual(
    current.students
      .filter((s) => matchesProgress(s, "not_submitted"))
      .map((s) => s.participant.username),
    ["01"],
  );
  for (const stage of ["reading", "attempt", "ended"]) {
    const view = classroomProgress({ ...context(stage), students });
    assert.equal(view.assessed, false);
    assert.ok(
      view.students.every((s) => s.state === null && s.evaluation === null),
    );
    assert.equal(
      Object.values(view.counts).reduce((a, b) => a + b),
      0,
    );
  }
});

test("最近问答按当前阶段和回复关系定位，不串用前一题或上一轮的回复", () => {
  const current = studentMessage("current", "为什么要检验区间", "judge", 1);
  const messages = [
    studentMessage("old", "第一题的回答", "judge", 0),
    studentMessage("previous", "上次作答", "judge", 1),
    current,
    {
      ...studentMessage("late", "上次的迟到回复", "judge", 1),
      role: "assistant" as const,
      replyTo: "previous",
    },
    {
      ...studentMessage("reply", "表达式只在相应区间适用", "judge", 1),
      role: "assistant" as const,
      replyTo: "current",
    },
  ];
  const view = { ...context("judge", 1), messages } as SessionDetail;
  assert.deepEqual(
    latestExchange(view).map((m) => m.id),
    ["current", "reply"],
  );
  assert.deepEqual(latestExchange({ ...view, ...context("explain") }), []);
});

test("真实课堂接口的进度随阶段切换，分母使用课堂参与名单", async () => {
  const f = await fixture();
  try {
    const c = await f.classroom(2),
      s = await f.open(c.id);
    await f.request(
      "POST",
      `/classes/${c.id}/students`,
      { students: [{ username: "00999999", name: "后加入同学" }] },
      f.teacher,
      201,
    );
    const d = await f.control(s.id);
    const sent = await f.request(
      "POST",
      `/sessions/${s.id}/messages`,
      {
        body: "每个输入只有一个输出",
        revision: d.session.revision,
        clientId: randomUUID(),
      },
      c.cookies[0],
      202,
    );
    const explained = await f.waitFor(s.id, f.teacher, (x) =>
      x.messages.some((m: any) => m.replyTo === sent.id),
    );
    // The existing roster API enrolls newcomers in an active regular class.
    assert.equal(classroomProgress(explained).total, 3);
    assert.equal(classroomProgress(explained).counts.achieved, 1);
    assert.equal(classroomProgress(explained).counts.not_submitted, 2);
    const attempt = await f.control(s.id);
    assert.equal(classroomProgress(attempt).assessed, false);
    const judge = await f.control(s.id);
    assert.equal(classroomProgress(judge).counts.achieved, 0);
    assert.equal(classroomProgress(judge).counts.not_submitted, 3);
    const answer = async (detail: SessionDetail, judgment: boolean) => {
      const m = await f.request(
        "POST",
        `/sessions/${s.id}/messages`,
        {
          body: "已说明本题的条件和结论",
          judgment,
          revision: detail.session.revision,
          clientId: randomUUID(),
        },
        c.cookies[0],
        202,
      );
      await f.waitFor(s.id, f.teacher, (x) =>
        x.messages.some((item: any) => item.replyTo === m.id),
      );
    };
    await answer(judge, false);
    await f.control(s.id, "next-exercise");
    await answer(await f.control(s.id), true);
    await f.control(s.id, "end");
    const makeup = await f.request(
      "POST",
      `/classes/${c.id}/sessions`,
      { lessonId: s.lesson.id, mode: "makeup", parentId: s.id },
      f.teacher,
      201,
    );
    const makeupDetail = await f.control(makeup.id);
    assert.equal(classroomProgress(makeupDetail).total, 2);
    assert.equal(classroomProgress(makeupDetail).counts.not_submitted, 2);
  } finally {
    await f.close();
  }
});
const context = (stage = "explain", exerciseIndex = 0) =>
  ({
    session: { id: "class", stage, exerciseIndex },
    lesson: {
      checklist: [
        { id: "a", label: "选段" },
        { id: "b", label: "端点" },
      ],
      exercises: [
        { id: "one", title: "第一题" },
        { id: "two", title: "第二题" },
      ],
    },
  }) as Pick<SessionDetail, "session" | "lesson">;

test("全班学习状态互斥统计，处理中和失败不会抹去已核验的进度", () => {
  const progress = classroomProgress({
    ...context(),
    students: [
      student("0006", {
        explainStatus: "achieved",
        explainEvaluationStatus: "review",
      }),
      student("0002", { explainEvaluationStatus: "processing" }),
      student("0003", {
        explainStatus: "needs_help",
        explainEvaluationStatus: "evaluated",
      }),
      student("0001"),
      student("0004", {
        explainStatus: "achieved",
        explainEvaluationStatus: "failed",
      }),
      student("0005", {
        explainStatus: "in_progress",
        explainEvaluationStatus: "evaluated",
        checks: [
          { id: "a", met: true, evidenceMessageId: "m", quote: "根据区间选段" },
          { id: "old", met: true, evidenceMessageId: "m", quote: "旧标准" },
        ],
      }),
    ],
  });
  assert.deepEqual(progress.counts, {
    achieved: 2,
    in_progress: 2,
    not_submitted: 1,
    needs_help: 1,
  });
  assert.deepEqual(progress.evaluations, {
    processing: 1,
    failed: 1,
    review: 1,
  });
  assert.equal(progress.total, 6);
  assert.deepEqual(
    progress.students.map((s) => s.participant.username),
    ["0001", "0002", "0003", "0004", "0005", "0006"],
  );
  assert.equal(progress.students[4].caption, "讲解完成 1/2 项");
});
