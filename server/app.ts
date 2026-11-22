import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { parse, serialize } from "cookie";
import multer from "multer";
import sharp from "sharp";
import { readFileSync, existsSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Store, id, now } from "./db.js";
import { publicUser, hashPassword, verifyPassword, tokenHash } from "./auth.js";
import { ApiError, ClassroomService, ensure } from "./classroom.js";
import { lessonSchema, rosterSchema, messageSchema } from "./validation.js";
import { makeEvaluator, type Evaluator } from "./ai.js";
import { exportClass } from "./export.js";
import type { Config } from "./config.js";
import type { User, Lesson } from "../shared/types.js";
import { stages } from "../shared/types.js";
import {
  initialStudentPassword,
  passwordMaxLength,
  studentPasswordMinLength,
} from "../shared/password.js";
type AuthRequest = Request & { user: User; sessionHash: string };
export async function createApp(config: Config, evaluator?: Evaluator) {
  const store = new Store(config.dataDir);
  const service = new ClassroomService(
    store,
    config,
    evaluator || makeEvaluator(config),
  );
  const source = path.resolve("server/content/lessons.json");
  if (existsSync(source))
    for (const lesson of JSON.parse(readFileSync(source, "utf8"))) {
      const valid = lessonSchema.parse(lesson);
      store.run(
        "INSERT OR IGNORE INTO lessons VALUES(?,?,1,?)",
        valid.id,
        JSON.stringify(valid),
        now(),
      );
    }
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, res, next) => {
    const origin = req.headers.origin;
    const allowed = config.origin.split(",").map((x) => x.trim());
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      origin &&
      !allowed.includes(origin)
    )
      return res.status(403).json({ error: "请求来源不匹配。" });
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/config", (_req, res) =>
    res.json({
      demo: config.demo,
      aiReady: Boolean(config.apiKey || config.demo),
    }),
  );
  function countAttempt(key: string, limit: number, message: string) {
    const timestamp = Date.now();
    store.run("DELETE FROM login_limits WHERE reset_at<=?", timestamp);
    const entry = store.get(
      "SELECT attempts FROM login_limits WHERE key=?",
      key,
    );
    ensure(!entry || entry.attempts < limit, 429, message);
    store.run(
      "INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1",
      key,
      timestamp + 15 * 60 * 1000,
    );
  }
  app.post("/api/login", async (req, res) => {
    const { username, password } = z
      .object({
        username: z.string().trim().min(1).max(64),
        password: z.string().min(1).max(passwordMaxLength),
      })
      .parse(req.body);
    const limitMessage = "登录尝试较多，请15分钟后重试。";
    countAttempt(`ip:${req.ip}`, 250, limitMessage);
    countAttempt(`user:${username}`, 12, limitMessage);
    const row = store.get("SELECT * FROM users WHERE username=?", username);
    ensure(
      row && (await verifyPassword(password, row.password)),
      401,
      "账号或密码不正确。",
    );
    const token = randomBytes(32).toString("hex");
    store.run("DELETE FROM auth_sessions WHERE expires<?", Date.now());
    const session = store.run(
      "INSERT INTO auth_sessions SELECT ?,id,? FROM users WHERE id=? AND password=?",
      tokenHash(token),
      Date.now() + 7 * 86400000,
      row.id,
      row.password,
    );
    ensure(session.changes, 401, "密码已更新，请使用最新密码登录。");
    store.run("DELETE FROM login_limits WHERE key=?", `user:${username}`);
    res.setHeader(
      "Set-Cookie",
      serialize("classroom_session", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: config.secure,
        path: "/",
        maxAge: 7 * 86400,
      }),
    );
    res.json({ user: publicUser(row) });
  });
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const token = parse(req.headers.cookie || "").classroom_session;
    const sessionHash = token ? tokenHash(token) : "";
    const row = sessionHash
      ? store.get(
          "SELECT u.* FROM auth_sessions a JOIN users u ON u.id=a.user_id WHERE a.token=? AND a.expires>?",
          sessionHash,
          Date.now(),
        )
      : null;
    if (!row) return res.status(401).json({ error: "请先登录。" });
    (req as AuthRequest).user = publicUser(row);
    (req as AuthRequest).sessionHash = sessionHash;
    next();
  });
  const user = (req: Request) => (req as AuthRequest).user;
  const teacher = (req: Request) => {
    const u = user(req);
    ensure(u.role === "teacher", 403, "该操作仅限教师。");
    return u;
  };
  app.get("/api/me", (req, res) => res.json({ user: user(req) }));
  app.post("/api/me/password", async (req, res) => {
    const u = user(req);
    ensure(u.role === "student", 403, "请使用学生账号修改密码。");
    const { currentPassword, newPassword } = z
      .object({
        currentPassword: z
          .string()
          .min(1, "请输入当前密码。")
          .max(passwordMaxLength),
        newPassword: z
          .string()
          .min(
            studentPasswordMinLength,
            `新密码至少需要 ${studentPasswordMinLength} 个字符。`,
          )
          .max(
            passwordMaxLength,
            `新密码最多可用 ${passwordMaxLength} 个字符。`,
          ),
      })
      .parse(req.body);
    ensure(newPassword !== currentPassword, 400, "新密码需要与当前密码不同。");
    const attemptKey = `change:${u.id}`;
    countAttempt(attemptKey, 12, "密码验证尝试较多，请15分钟后重试。");
    const previous = store.get(
      "SELECT password FROM users WHERE id=?",
      u.id,
    )!.password;
    ensure(
      await verifyPassword(currentPassword, previous),
      400,
      "当前密码不正确。",
    );
    const password = await hashPassword(newPassword);
    const { sessionHash } = req as AuthRequest;
    store.tx(() => {
      ensure(
        store.get(
          "SELECT 1 FROM auth_sessions WHERE token=? AND user_id=? AND expires>?",
          sessionHash,
          u.id,
          Date.now(),
        ),
        401,
        "登录已失效，请重新登录。",
      );
      const updated = store.run(
        "UPDATE users SET password=? WHERE id=? AND password=?",
        password,
        u.id,
        previous,
      );
      ensure(updated.changes, 409, "密码已更新，请使用最新密码重试。");
      store.run(
        "DELETE FROM auth_sessions WHERE user_id=? AND token<>?",
        u.id,
        sessionHash,
      );
      store.run(
        "DELETE FROM login_limits WHERE key IN (?,?)",
        attemptKey,
        `user:${u.username}`,
      );
    });
    res.json({ ok: true });
  });
  app.post("/api/logout", (req, res) => {
    store.run(
      "DELETE FROM auth_sessions WHERE token=?",
      (req as AuthRequest).sessionHash,
    );
    res.setHeader(
      "Set-Cookie",
      serialize("classroom_session", "", {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: config.secure,
        maxAge: 0,
      }),
    );
    res.json({ ok: true });
  });
  app.get("/api/bootstrap", (req, res) => {
    const u = user(req);
    const classes = store.all(
      `SELECT c.*,(SELECT count(*) FROM users u WHERE u.class_id=c.id AND u.role='student') AS student_count,(SELECT id FROM sessions s WHERE s.class_id=c.id AND ended_at IS NULL) AS current_session_id FROM classes c WHERE ${u.role === "teacher" ? "teacher_id=?" : "id=?"} ORDER BY created_at`,
      u.role === "teacher" ? u.id : u.classId || "",
    );
    const sessions = store.all(
      `SELECT s.*,c.name AS class_name FROM sessions s JOIN classes c ON c.id=s.class_id WHERE ${u.role === "teacher" ? "c.teacher_id=?" : "s.id IN (SELECT session_id FROM participants WHERE user_id=?)"} ORDER BY s.created_at DESC`,
      u.id,
    );
    res.json({
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        studentCount: c.student_count,
        currentSessionId: c.current_session_id,
      })),
      sessions: sessions.map((s) => {
        const p =
          u.role === "student"
            ? store.get(
                "SELECT pending,explain_status FROM participants WHERE session_id=? AND user_id=?",
                s.id,
                u.id,
              )
            : null;
        return {
          ...service.sessionView(s),
          ...(p
            ? { pending: Boolean(p.pending), explainStatus: p.explain_status }
            : {}),
        };
      }),
      lessons:
        u.role === "teacher"
          ? store
              .all(
                "SELECT * FROM lessons ORDER BY json_extract(content,'$.order')",
              )
              .map((l) => ({ ...JSON.parse(l.content), revision: l.revision }))
          : [],
      demo: config.demo,
      aiReady: Boolean(config.apiKey || config.demo),
    });
  });
  app.post("/api/classes", (req, res) => {
    const u = teacher(req);
    const name = z.string().trim().min(1).max(80).parse(req.body.name);
    const classId = id();
    store.run(
      "INSERT INTO classes VALUES(?,?,?,?)",
      classId,
      name,
      u.id,
      now(),
    );
    res.status(201).json({ id: classId, name });
  });
  app.get("/api/classes/:id/students", (req, res) => {
    const u = teacher(req);
    service.ownClass(u, String(req.params.id));
    res.json(
      store.all(
        "SELECT id,username,name FROM users WHERE class_id=? ORDER BY username",
        String(req.params.id),
      ),
    );
  });
  app.post("/api/classes/:id/students", async (req, res) => {
    const u = teacher(req);
    const classId = String(req.params.id);
    service.ownClass(u, classId);
    const rows = rosterSchema.parse(req.body.students);
    ensure(
      new Set(rows.map((r) => r.username)).size === rows.length,
      400,
      "名册存在重复学号。",
    );
    for (const r of rows)
      ensure(
        !store.get("SELECT 1 FROM users WHERE username=?", r.username),
        409,
        `学号 ${r.username} 已存在，请核对名册。`,
      );
    const prepared: Array<{
      username: string;
      name: string;
      password: string;
      id: string;
    }> = [];
    for (const row of rows)
      prepared.push({
        ...row,
        password: await hashPassword(initialStudentPassword(row.username)),
        id: id(),
      });
    store.tx(() => {
      for (const row of prepared)
        store.run(
          "INSERT INTO users VALUES(?,?,?,?,?,?,?)",
          row.id,
          row.username,
          row.name,
          "student",
          row.password,
          classId,
          now(),
        );
      const active = store.get(
        "SELECT id FROM sessions WHERE class_id=? AND ended_at IS NULL AND mode='classroom'",
        classId,
      );
      if (active)
        for (const row of prepared)
          store.run(
            "INSERT INTO participants(session_id,user_id) VALUES(?,?)",
            active.id,
            row.id,
          );
    });
    res.status(201).json({ count: rows.length });
  });
  app.post("/api/students/:id/reset-password", async (req, res) => {
    const u = teacher(req);
    const s = store.get(
      "SELECT * FROM users WHERE id=? AND role='student'",
      String(req.params.id),
    );
    ensure(s, 404, "未找到学生。");
    service.ownClass(u, s.class_id);
    const password = await hashPassword(initialStudentPassword(s.username));
    store.tx(() => {
      store.run("UPDATE users SET password=? WHERE id=?", password, s.id);
      store.run("DELETE FROM auth_sessions WHERE user_id=?", s.id);
      store.run(
        "DELETE FROM login_limits WHERE key IN (?,?)",
        `user:${s.username}`,
        `change:${s.id}`,
      );
    });
    res.json({ ok: true });
  });
  app.put("/api/lessons/:id", (req, res) => {
    teacher(req);
    const lesson = lessonSchema.parse(req.body.lesson);
    ensure(lesson.id === req.params.id, 400, "课时编号不匹配。");
    const revision = z.number().int().parse(req.body.revision);
    const updated = store.run(
      "UPDATE lessons SET content=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
      JSON.stringify({ ...lesson, status: "draft" }),
      now(),
      lesson.id,
      revision,
    );
    ensure(updated.changes, 409, "课时已被更新，请刷新后编辑。");
    res.json({ ok: true });
  });
  app.post("/api/lessons/:id/publish", (req, res) => {
    teacher(req);
    const row = store.get(
      "SELECT * FROM lessons WHERE id=?",
      String(req.params.id),
    );
    ensure(row, 404, "未找到课时。");
    const revision = z.number().int().parse(req.body.revision);
    ensure(revision === row.revision, 409, "课时已更新，请重新审核。");
    const lesson = lessonSchema.parse(JSON.parse(row.content));
    store.run(
      "UPDATE lessons SET content=?,revision=revision+1,updated_at=? WHERE id=?",
      JSON.stringify({ ...lesson, status: "published" }),
      now(),
      lesson.id,
    );
    res.json({ ok: true });
  });
  app.post("/api/classes/:id/sessions", (req, res) => {
    const u = teacher(req);
    const classId = String(req.params.id);
    service.ownClass(u, classId);
    const body = z
      .object({
        lessonId: z.string(),
        mode: z.enum(["classroom", "makeup"]),
        parentId: z.string().nullable().optional(),
      })
      .parse(req.body);
    ensure(
      !store.get(
        "SELECT 1 FROM sessions WHERE class_id=? AND ended_at IS NULL",
        classId,
      ),
      409,
      "请先结束当前课堂。",
    );
    const row = store.get("SELECT * FROM lessons WHERE id=?", body.lessonId);
    ensure(row, 404, "未找到课时。");
    let lesson = JSON.parse(row.content) as Lesson;
    let members = store.all(
      "SELECT id FROM users WHERE class_id=? AND role='student'",
      classId,
    );
    if (body.mode === "makeup") {
      ensure(body.parentId, 400, "补做需要关联原课堂。");
      const parent = service.session(u, body.parentId);
      ensure(
        parent.class_id === classId &&
          parent.lesson_id === body.lessonId &&
          parent.ended_at,
        400,
        "补做必须对应本班已结束的同一课时。",
      );
      lesson = JSON.parse(parent.snapshot);
      members = store.all(
        "SELECT user_id AS id FROM participants WHERE session_id=? AND pending=1",
        parent.id,
      );
    } else {
      ensure(!body.parentId, 400, "正式课堂不应指定补做来源。");
      ensure(lesson.status === "published", 400, "请先审核并发布课时。");
    }
    ensure(
      members.length,
      400,
      body.mode === "makeup" ? "本课堂没有待补学生。" : "请先导入学生名册。",
    );
    const sessionId = id();
    store.tx(() => {
      store.run(
        "INSERT INTO sessions(id,class_id,lesson_id,snapshot,stage,mode,parent_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
        sessionId,
        classId,
        lesson.id,
        JSON.stringify(lesson),
        "reading",
        body.mode,
        body.parentId || null,
        now(),
      );
      for (const member of members)
        store.run(
          "INSERT INTO participants(session_id,user_id) VALUES(?,?)",
          sessionId,
          member.id,
        );
      service.event(sessionId, u.id, "opened", {
        mode: body.mode,
        parentId: body.parentId || null,
        lessonRevision: row.revision,
      });
    });
    res.status(201).json({ id: sessionId });
  });
  app.get("/api/sessions/:id", (req, res) => {
    const result = service.detail(
      user(req),
      String(req.params.id),
      typeof req.query.student === "string" ? req.query.student : undefined,
    );
    if (user(req).role === "student") {
      result.messages = result.messages.map(({ evaluation, ...m }) => m);
      // Atomic criteria are teacher-only, just like the original rubric.
      if (result.participant)
        result.participant.checks = result.participant.checks.map(
          ({ parts, ...c }) => c,
        );
    }
    res.json(result);
  });
  app.post("/api/sessions/:id/control", (req, res) => {
    const u = teacher(req);
    const s = service.session(u, String(req.params.id));
    const { action, revision } = z
      .object({
        action: z.enum(["advance", "next-exercise", "end"]),
        revision: z.number().int(),
      })
      .parse(req.body);
    ensure(
      s.revision === revision && !s.ended_at,
      409,
      "课堂状态已变化，请刷新后操作。",
    );
    const lesson = JSON.parse(s.snapshot) as Lesson;
    store.tx(() => {
      service.markIncomplete(s);
      let stage = s.stage;
      let index = s.exercise_index;
      if (action === "end") stage = "ended";
      else if (action === "advance")
        stage = stages[stages.indexOf(s.stage) + 1];
      else {
        ensure(
          s.stage === "judge" && index + 1 < lesson.exercises.length,
          400,
          "当前无法开始下一道例题。",
        );
        stage = "attempt";
        index++;
      }
      ensure(stage, 400, "无效课堂阶段。");
      if (stage === "attempt") {
        const ex = lesson.exercises[index];
        for (const p of service.participants(s.id))
          store.run(
            "INSERT INTO messages(id,session_id,user_id,role,body,stage,exercise_index,created_at) VALUES(?,?,?,?,?,?,?,?)",
            id(),
            s.id,
            p.userId,
            "assistant",
            `我来试着做这道题，请你帮我检查一下。\n\n**题目**\n\n${ex.prompt}\n\n**我的解答**\n\n${ex.attempt}`,
            "attempt",
            index,
            now(),
          );
      }
      if (stage === "ended")
        for (const p of service.participants(s.id)) {
          const incomplete =
            p.explainStatus !== "achieved" ||
            lesson.exercises.some(
              (ex) => p.judgments[ex.id]?.status !== "achieved",
            );
          for (const exercise of lesson.exercises) {
            if (p.judgments[exercise.id]?.status !== "achieved")
              p.judgments[exercise.id] = {
                ...p.judgments[exercise.id],
                status: "pending",
              };
          }
          store.run(
            "UPDATE participants SET pending=?,explain_status=?,judgments=? WHERE session_id=? AND user_id=?",
            Number(incomplete),
            p.explainStatus === "achieved" ? "achieved" : "pending",
            JSON.stringify(p.judgments),
            s.id,
            p.userId,
          );
        }
      store.run(
        "UPDATE sessions SET stage=?,exercise_index=?,revision=revision+1,ended_at=? WHERE id=?",
        stage,
        index,
        stage === "ended" ? now() : null,
        s.id,
      );
      service.event(s.id, u.id, action, {
        from: s.stage,
        to: stage,
        exerciseIndex: index,
        revision: revision + 1,
      });
    });
    res.json({ ok: true });
  });
  app.post("/api/sessions/:id/messages", (req, res) => {
    const u = user(req);
    ensure(u.role === "student", 403, "请使用学生账号参与课堂。");
    const s = service.session(u, String(req.params.id));
    const input = messageSchema.parse(req.body);
    const existing = store.get(
      "SELECT id FROM messages WHERE session_id=? AND user_id=? AND client_id=?",
      s.id,
      u.id,
      input.clientId,
    );
    if (existing) return res.status(200).json({ id: existing.id });
    ensure(
      s.revision === input.revision &&
        !s.ended_at &&
        ["explain", "judge"].includes(s.stage),
      409,
      "教师已切换阶段，当前不可发送。你的输入可以保留后继续使用。",
    );
    ensure(
      !store.get(
        "SELECT id FROM messages WHERE session_id=? AND user_id=? AND status='pending'",
        s.id,
        u.id,
      ),
      409,
      "小知正在回应上一条消息，请稍候。",
    );
    const participant = store.get(
      "SELECT * FROM participants WHERE session_id=? AND user_id=?",
      s.id,
      u.id,
    )!;
    const exercise = JSON.parse(s.snapshot).exercises[s.exercise_index];
    const currentRecord = JSON.parse(participant.judgments)[exercise?.id] || {};
    const submission = {
      kind: submissionKind(input.body, input.attachments.length > 0),
      afterAchievement:
        s.stage === "judge"
          ? Boolean(
              currentRecord.firstAchievedAt ||
              currentRecord.firstAchievementUnknown ||
              currentRecord.status === "achieved",
            )
          : undefined,
    };
    if (s.stage === "judge")
      ensure(
        input.judgment !== undefined || currentRecord.status === "achieved",
        400,
        "请选择正确或错误，并说明理由。",
      );
    else ensure(input.judgment === undefined, 400, "当前是讲解阶段。");
    ensure(
      new Set(input.attachments).size === input.attachments.length,
      400,
      "请勿重复添加同一张图片。",
    );
    for (const fileId of input.attachments)
      ensure(
        store.get(
          "SELECT 1 FROM attachments WHERE id=? AND user_id=? AND session_id=? AND message_id IS NULL",
          fileId,
          u.id,
          s.id,
        ),
        400,
        "图片不属于当前作答或已使用。",
      );
    const messageId = id();
    store.tx(() => {
      store.run(
        "INSERT INTO messages(id,session_id,user_id,role,body,stage,exercise_index,judgment,created_at,status,client_id,submission) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        messageId,
        s.id,
        u.id,
        "student",
        input.body,
        s.stage,
        s.exercise_index,
        input.judgment === undefined ? null : Number(input.judgment),
        now(),
        "pending",
        input.clientId,
        JSON.stringify(submission),
      );
      for (const fileId of input.attachments)
        store.run(
          "UPDATE attachments SET message_id=? WHERE id=?",
          messageId,
          fileId,
        );
      // Receiving an answer changes processing state, not the last verified
      // learning outcome. Failed or unverified evaluations must not erase it.
      if (s.stage === "judge") {
        const p = store.get(
          "SELECT judgments FROM participants WHERE session_id=? AND user_id=?",
          s.id,
          u.id,
        )!;
        const judgments = JSON.parse(p.judgments);
        const ex = JSON.parse(s.snapshot).exercises[s.exercise_index];
        const record = judgments[ex.id] || {};
        judgments[ex.id] = {
          ...record,
          firstJudgment: record.firstJudgment ?? input.judgment,
          firstCorrect:
            record.firstCorrect ??
            (input.judgment === undefined
              ? undefined
              : input.judgment === ex.isCorrect),
          attempts: (record.attempts || 0) + 1,
          status: record.status || "not_started",
          hints: record.hints || 0,
          answerAttempts:
            (record.answerAttempts || 0) +
            (submission.kind === "answer" && !submission.afterAchievement
              ? 1
              : 0),
          clarificationMessages:
            (record.clarificationMessages || 0) +
            (submission.kind === "clarification" ? 1 : 0),
          socialMessages:
            (record.socialMessages || 0) +
            (submission.kind === "social" ? 1 : 0),
          postAchievementMessages:
            (record.postAchievementMessages || 0) +
            (submission.afterAchievement ? 1 : 0),
          statisticsStartedAt: record.statisticsStartedAt || now(),
          legacyAttempts: record.legacyAttempts ?? record.attempts ?? 0,
          firstAchievementUnknown:
            record.firstAchievementUnknown ||
            (record.status === "achieved" && !record.firstAchievedAt),
        };
        store.run(
          "UPDATE participants SET judgments=? WHERE session_id=? AND user_id=?",
          JSON.stringify(judgments),
          s.id,
          u.id,
        );
      }
    });
    service.startProcessing(messageId, s.revision);
    res.status(202).json({ id: messageId });
  });
  app.post("/api/messages/:id/retry", (req, res) => {
    const u = user(req);
    const m = store.get(
      "SELECT * FROM messages WHERE id=? AND user_id=? AND role='student'",
      String(req.params.id),
      u.id,
    );
    ensure(m && m.status === "failed", 400, "该消息无需重试。");
    const s = service.session(u, m.session_id);
    ensure(
      !s.ended_at &&
        s.stage === m.stage &&
        s.exercise_index === m.exercise_index,
      409,
      "课堂已切换，原消息已保留，无法在新阶段重试。",
    );
    ensure(
      !store.get(
        "SELECT 1 FROM messages WHERE session_id=? AND user_id=? AND status='pending'",
        s.id,
        u.id,
      ),
      409,
      "请等待当前回复。",
    );
    ensure(
      !store.get(
        "SELECT 1 FROM messages WHERE session_id=? AND user_id=? AND role='student' AND rowid>(SELECT rowid FROM messages WHERE id=?)",
        s.id,
        u.id,
        m.id,
      ),
      409,
      "已有后续作答，旧消息保留为历史记录，无需重试。",
    );
    store.run(
      "UPDATE messages SET status='pending',error=NULL WHERE id=?",
      m.id,
    );
    service.startProcessing(m.id, s.revision);
    res.status(202).json({ ok: true });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });
  app.post(
    "/api/sessions/:id/attachments",
    upload.single("image"),
    async (req, res) => {
      const u = user(req);
      ensure(u.role === "student", 403, "请使用学生账号上传。");
      const s = service.session(u, String(req.params.id));
      ensure(
        !s.ended_at && ["explain", "judge"].includes(s.stage),
        409,
        "当前阶段未开放上传。",
      );
      ensure(req.file, 400, "请选择图片。");
      const count = store.get(
        "SELECT count(*) AS n FROM attachments WHERE session_id=? AND user_id=?",
        s.id,
        u.id,
      )!;
      ensure(count.n < 80, 400, "本节课已达到80张图片上限。");
      let buffer: Buffer;
      try {
        buffer = await sharp(req.file.buffer, { limitInputPixels: 40_000_000 })
          .rotate()
          .resize({
            width: 2000,
            height: 2000,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 88 })
          .toBuffer();
      } catch {
        throw new ApiError(
          400,
          "请上传有效的 JPEG、PNG 或 WebP 图片（不超过8MB）。",
        );
      }
      const current = service.session(u, s.id);
      ensure(
        current.revision === s.revision,
        409,
        "教师已切换阶段，请在允许作答时重新上传。",
      );
      const fileId = id(),
        filename = `${fileId}.webp`;
      await writeFile(path.join(store.dir, "uploads", filename), buffer, {
        flag: "wx",
      });
      try {
        const latest = service.session(u, s.id);
        ensure(latest.revision === s.revision, 409, "课堂阶段已切换。");
        store.run(
          "INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)",
          fileId,
          u.id,
          s.id,
          null,
          req.file.originalname.slice(0, 180),
          filename,
          "image/webp",
          buffer.length,
          now(),
        );
      } catch (error) {
        await unlink(path.join(store.dir, "uploads", filename));
        throw error;
      }
      res.status(201).json({
        id: fileId,
        name: req.file.originalname,
        mime: "image/webp",
        size: buffer.length,
        url: `/api/attachments/${fileId}`,
      });
    },
  );
  app.get("/api/attachments/:id", (req, res) => {
    const u = user(req);
    const a = store.get(
      "SELECT * FROM attachments WHERE id=?",
      String(req.params.id),
    );
    ensure(a, 404, "未找到图片。");
    service.session(u, a.session_id);
    ensure(u.role === "teacher" || a.user_id === u.id, 404, "未找到图片。");
    res.type(a.mime).sendFile(path.join(store.dir, "uploads", a.path));
  });
  app.get("/api/materials/guide", (req, res) => {
    teacher(req);
    res.type("pdf").sendFile(path.resolve("导学案.pdf"));
  });
  app.get("/api/classes/:id/export", async (req, res) => {
    await exportClass(store, service, teacher(req), String(req.params.id), res);
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "接口不存在。" }),
  );
  const dist = path.resolve("dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(path.join(dist, "index.html")),
    );
  }
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return res.end();
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: error.issues[0]?.message || "请检查输入。" });
    if (error instanceof multer.MulterError)
      return res.status(400).json({ error: "图片应不超过8MB，每次上传一张。" });
    const status = error instanceof ApiError ? error.status : 500;
    if (status === 500) console.error(error);
    res.status(status).json({
      error: status === 500 ? "服务暂不可用，请稍后重试。" : error.message,
    });
  });
  return { app, store, service };
}
import { submissionKind } from "./dialogue.js";
