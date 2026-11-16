import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { configFromEnv } from "./config.js";
import { Store, id, now } from "./db.js";
import { hashPassword } from "./auth.js";
let muted = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) process.stdout.write(chunk);
    callback();
  },
});
const terminal = createInterface({
  input: process.stdin,
  output,
  terminal: Boolean(process.stdin.isTTY),
});
const store = new Store(configFromEnv().dataDir);
try {
  const username =
    process.env.TEACHER_USERNAME || (await terminal.question("教师账号："));
  const name =
    process.env.TEACHER_NAME || (await terminal.question("教师显示姓名："));
  let password = process.env.TEACHER_PASSWORD || "";
  if (!password) {
    process.stdout.write("教师密码（至少12位，输入隐藏）：");
    muted = true;
    password = await terminal.question("");
    muted = false;
    process.stdout.write("\n");
  }
  if (
    !/^[A-Za-z0-9_-]{3,40}$/.test(username) ||
    !name.trim() ||
    password.length < 12
  )
    throw Error("请使用有效账号、姓名和至少12位密码。");
  if (store.get("SELECT 1 FROM users WHERE username=?", username))
    throw Error("该账号已存在，未覆盖已有账号。");
  store.run(
    "INSERT INTO users VALUES(?,?,?,?,?,?,?)",
    id(),
    username,
    name.trim(),
    "teacher",
    await hashPassword(password),
    null,
    now(),
  );
  console.log("教师账号已创建。请登录后创建班级、导入名册和审核课时。");
} finally {
  terminal.close();
  store.close();
}
