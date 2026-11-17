import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { Bootstrap } from "../src/App";
import { Teacher } from "../src/teacher";
import { useDetail } from "../src/use-session-detail";

const newClass: Bootstrap = {
  classes: [{ id: "new-class", name: "高一新班", studentCount: 0 }],
  sessions: [],
  lessons: [],
  demo: false,
  aiReady: true,
};

function renderTeacher(page: string) {
  return renderToString(
    createElement(Teacher, {
      boot: newClass,
      page,
      refresh: async () => {},
      setPage: () => {},
      notify: () => {},
    }),
  );
}

test("a newly created class renders the classroom launch screen without a session", () => {
  const html = renderTeacher("classroom");
  assert.match(html, /高一新班/);
  assert.match(html, /下一节课，从这里开始。/);
  assert.match(html, /先导入学生名册/);
});

test("a new class renders an empty learning history without a session", () => {
  const html = renderTeacher("history");
  assert.match(html, /还没有课堂记录/);
  assert.match(html, /导出本班数据/);
});

test("an existing session has no detail or refresh timestamp before its first response", () => {
  for (const keepOverview of [true, false]) {
    function PendingDetail() {
      const state = useDetail("existing-session", "", () => {}, keepOverview);
      assert.equal(state.detail, null);
      assert.equal(state.updatedAt, null);
      assert.equal(state.error, "");
      return null;
    }
    renderToString(createElement(PendingDetail));
  }
});
