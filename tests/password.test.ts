import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./helpers.js";

test("学生改密后保留当前课堂登录，教师重置可立即用带前导零的初始密码登录", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const c = await f.classroom();
  const { username } = c.students[0];
  const current = c.cookies[0];
  const second = await f.login(username, "0001");
  const me = await f.request("GET", "/me", undefined, current);
  const change = (
    currentPassword: string,
    newPassword: string,
    cookie = current,
    status = 200,
  ) =>
    f.request(
      "POST",
      "/me/password",
      { currentPassword, newPassword },
      cookie,
      status,
    );
  const newPassword = "新的课堂密码0001";
  await change("0001", newPassword, "", 401);
  await change("0001", newPassword, f.teacher, 403);
  await change("wrong", newPassword, current, 400);
  await change("0001", "short", current, 400);
  await change("0001", "a".repeat(129), current, 400);
  await f.request("GET", "/me", undefined, second);
  await change("0001", newPassword);
  await change(newPassword, newPassword, current, 400);
  await f.request("GET", "/me", undefined, current);
  await f.request("GET", "/me", undefined, second, 401);
  await f.request("POST", "/login", { username, password: "0001" }, "", 401);
  const newLogin = await f.login(username, newPassword);

  const reset = `/students/${me.user.id}/reset-password`;
  await f.request("POST", reset, {}, c.cookies[1], 403);
  f.store.run(
    "INSERT INTO users SELECT 'other-teacher','another','另一位教师',role,password,NULL,created_at FROM users WHERE username='teacher'",
  );
  const otherTeacher = await f.login("another", "test-teacher-password");
  await f.request("POST", reset, {}, otherTeacher, 404);
  await f.request("GET", "/me", undefined, newLogin);

  for (let i = 0; i < 12; i++)
    await f.request("POST", "/login", { username, password: "wrong" }, "", 401);
  await f.request(
    "POST",
    "/login",
    { username, password: newPassword },
    "",
    429,
  );
  await f.request("POST", reset, {}, f.teacher);
  await f.request("GET", "/me", undefined, current, 401);
  await f.request("GET", "/me", undefined, newLogin, 401);
  await f.request(
    "POST",
    "/login",
    { username, password: newPassword },
    "",
    401,
  );
  const recovered = await f.login(username, "0001");
  await change("0001", newPassword, recovered);
  await f.request("GET", "/me", undefined, c.cookies[1]);
});

test("教师重置与学生改密同时提交时，过期操作不能覆盖初始密码", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const c = await f.classroom(1);
  const cookie = c.cookies[0];
  const { user } = await f.request("GET", "/me", undefined, cookie);
  const [change] = await Promise.all([
    fetch(f.base + "/api/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        currentPassword: "0001",
        newPassword: "student-new-password",
      }),
    }),
    f.request("POST", `/students/${user.id}/reset-password`, {}, f.teacher),
  ]);
  assert.ok([200, 401].includes(change.status), String(change.status));
  await f.request("GET", "/me", undefined, cookie, 401);
  await f.login(user.username, "0001");
});
