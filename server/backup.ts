import { DatabaseSync } from "node:sqlite";
import { mkdir, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { configFromEnv } from "./config.js";
const config = configFromEnv();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.join(config.dataDir, "backups", stamp);
await mkdir(target, { recursive: true });
const db = new DatabaseSync(path.join(config.dataDir, "classroom.sqlite"));
try {
  db.exec(
    `VACUUM INTO '${path.join(target, "classroom.sqlite").replace(/'/g, "''")}'`,
  );
} finally {
  db.close();
}
await cp(path.join(config.dataDir, "uploads"), path.join(target, "uploads"), {
  recursive: true,
});
await writeFile(
  path.join(target, "manifest.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      format: 1,
      contents: ["classroom.sqlite", "uploads"],
    },
    null,
    2,
  ),
);
console.log(`Backup created: ${target}`);
