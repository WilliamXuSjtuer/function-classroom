import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export class Store {
  db: DatabaseSync;
  constructor(public dir: string) {
    mkdirSync(path.join(dir, "uploads"), { recursive: true });
    this.db = new DatabaseSync(path.join(dir, "classroom.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,password TEXT NOT NULL,class_id TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY,name TEXT NOT NULL,teacher_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS lessons(id TEXT PRIMARY KEY,content TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),lesson_id TEXT NOT NULL REFERENCES lessons(id),snapshot TEXT NOT NULL,stage TEXT NOT NULL,mode TEXT NOT NULL,parent_id TEXT REFERENCES sessions(id),exercise_index INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,ended_at TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS one_open_session ON sessions(class_id) WHERE ended_at IS NULL;
      CREATE TABLE IF NOT EXISTS participants(session_id TEXT NOT NULL REFERENCES sessions(id),user_id TEXT NOT NULL REFERENCES users(id),explain_status TEXT NOT NULL DEFAULT 'not_started',checks TEXT NOT NULL DEFAULT '[]',judgments TEXT NOT NULL DEFAULT '{}',focus TEXT NOT NULL DEFAULT '{}',pending INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(session_id,user_id));
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,body TEXT NOT NULL,stage TEXT NOT NULL,exercise_index INTEGER NOT NULL DEFAULT 0,judgment INTEGER,created_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'done',error TEXT,reply_to TEXT REFERENCES messages(id),evaluation TEXT,client_id TEXT,UNIQUE(session_id,user_id,client_id));
      CREATE INDEX IF NOT EXISTS message_history ON messages(session_id,user_id,created_at);
      CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),session_id TEXT NOT NULL REFERENCES sessions(id),message_id TEXT REFERENCES messages(id),name TEXT NOT NULL,path TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),actor_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset_at INTEGER NOT NULL);
      `);
    // Nullable metadata keeps pre-v2.1 classroom records explicitly unclassified.
    if (
      !this.all<{ name: string }>("PRAGMA table_info(messages)").some(
        (c) => c.name === "submission",
      )
    )
      this.db.exec("ALTER TABLE messages ADD COLUMN submission TEXT");
    this.db.exec("PRAGMA user_version=2");
  }
  get<T = any>(sql: string, ...args: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...args) as T | undefined;
  }
  all<T = any>(sql: string, ...args: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...args) as T[];
  }
  run(sql: string, ...args: SQLInputValue[]) {
    return this.db.prepare(sql).run(...args);
  }
  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
