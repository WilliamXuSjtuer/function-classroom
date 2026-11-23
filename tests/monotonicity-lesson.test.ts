import assert from "node:assert/strict";
import { test } from "node:test";
import type { Lesson } from "../shared/types.js";
import { createApp } from "../server/app.js";
import { fixture } from "./helpers.js";

test("例9更新已有课时，保留其他备课内容、历史课堂和之后的教师修订", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const classroom = await f.classroom(1);
  const lessons = async (): Promise<Lesson[]> =>
    (await f.request("GET", "/bootstrap", undefined, f.teacher)).lessons;
  const initial = await lessons();
  const index = initial.findIndex((l) => l.id === "monotonicity-definition");
  const lesson = initial[index];
  const example = lesson.exercises[1];
  assert.equal(example.isCorrect, false);
  assert.match(example.attempt, /整个.*严格递减/);
  assert.doesNotMatch(example.attempt, /任取|任意/);
  assert.match(example.attempt, /\[-2,1\]\$ 是严格增区间/);
  assert.match(example.attempt, /\[1,2\]\$ 是严格减区间/);

  const old = structuredClone(lesson);
  old.material = "本班阅读安排";
  old.exercises[0].hint = "本班第一题的追问";
  old.exercises[1] = {
    ...example,
    title: "把区间条件用进证明",
    isCorrect: true,
    attempt: "旧课堂的解答",
    source: "改编自导学案第32页例1（1）",
  };
  const save = (value: Lesson) =>
    f.request(
      "PUT",
      `/lessons/${lesson.id}`,
      { lesson: value, revision: value.revision },
      f.teacher,
    );
  const restart = async () => (await createApp(f.config)).store.close();
  await save(old);
  const previous = await f.open(classroom.id, index);
  const before = (await lessons())[index];
  await restart();
  const updated = (await lessons())[index];
  assert.equal(updated.status, "draft");
  assert.equal(updated.revision, before.revision! + 1);
  assert.equal(updated.material, old.material);
  assert.deepEqual(updated.exercises, [old.exercises[0], example]);

  const studentView = (id: string) =>
    f.request("GET", `/sessions/${id}`, undefined, classroom.cookies[0]);
  assert.equal(
    (await studentView(previous.id)).lesson.exercises[1].title,
    old.exercises[1].title,
  );
  await f.control(previous.id, "end");
  const current = await f.open(classroom.id, index);
  await f.control(current.id);
  await f.control(current.id);
  await f.control(current.id);
  await f.control(current.id, "next-exercise");
  const view = await studentView(current.id);
  assert.equal(view.exercise.attempt, example.attempt);
  assert.equal(view.exercise.correctAnswer, undefined);
  assert.equal(view.exercise.isCorrect, undefined);
  assert.ok(
    view.messages.some((m: { body: string }) =>
      m.body.includes(example.attempt),
    ),
  );

  const edited = (await lessons())[index];
  edited.exercises[1].hint = "教师新写的例9提示";
  await save(edited);
  const saved = (await lessons())[index];
  await restart();
  assert.deepEqual((await lessons())[index], saved);
});
