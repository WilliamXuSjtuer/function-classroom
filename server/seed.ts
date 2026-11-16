import { Store, id, now } from "./db.js";
import { hashPassword } from "./auth.js";
export async function seedDemo(store: Store) {
  if (store.get("SELECT 1 FROM users LIMIT 1")) return;
  const teacherId = id(),
    classId = id();
  store.run(
    "INSERT INTO users VALUES(?,?,?,?,?,?,?)",
    teacherId,
    "teacher",
    "林老师",
    "teacher",
    await hashPassword("demo-teacher-2026"),
    null,
    now(),
  );
  store.run(
    "INSERT INTO classes VALUES(?,?,?,?)",
    classId,
    "高一（3）班",
    teacherId,
    now(),
  );
  const names = [
    "林予安",
    "陈知夏",
    "许星禾",
    "周慕白",
    "沈嘉宁",
    "江以南",
    "宋书言",
    "陆明远",
  ];
  for (const [i, name] of names.entries()) {
    const username = `202601${String(i + 1).padStart(2, "0")}`;
    store.run(
      "INSERT INTO users VALUES(?,?,?,?,?,?,?)",
      id(),
      username,
      name,
      "student",
      await hashPassword(username.slice(-4)),
      classId,
      now(),
    );
  }
}
