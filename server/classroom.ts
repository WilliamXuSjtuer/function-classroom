import type {
  User,
  Lesson,
  ClassSession,
  Message,
  Participant,
} from "../shared/types.js";
import { Store, id, now } from "./db.js";
import type { Config } from "./config.js";
import { PROMPT_VERSION, type Evaluator } from "./ai.js";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function ensure(
  value: unknown,
  status: number,
  message: string,
): asserts value {
  if (!value) throw new ApiError(status, message);
}
export class ClassroomService {
  constructor(
    public store: Store,
    public config: Config,
    private evaluate: Evaluator,
  ) {}
  ownClass(user: User, classId: string) {
    const c = this.store.get("SELECT * FROM classes WHERE id=?", classId);
    ensure(
      c &&
        (user.role === "teacher"
          ? c.teacher_id === user.id
          : user.classId === classId),
      404,
      "未找到班级。",
    );
    return c;
  }
  session(user: User, sessionId: string) {
    const s = this.store.get(
      "SELECT s.*,c.name AS class_name FROM sessions s JOIN classes c ON c.id=s.class_id WHERE s.id=?",
      sessionId,
    );
    ensure(s, 404, "未找到课堂。");
    this.ownClass(user, s.class_id);
    if (user.role === "student")
      ensure(
        this.store.get(
          "SELECT 1 FROM participants WHERE session_id=? AND user_id=?",
          sessionId,
          user.id,
        ),
        404,
        "你未参与这节课堂。",
      );
    return s;
  }
  sessionView(s: any): ClassSession {
    return {
      id: s.id,
      classId: s.class_id,
      className: s.class_name,
      lessonId: s.lesson_id,
      lessonTitle: JSON.parse(s.snapshot).title,
      stage: s.stage,
      mode: s.mode,
      parentId: s.parent_id,
      exerciseIndex: s.exercise_index,
      revision: s.revision,
      createdAt: s.created_at,
      endedAt: s.ended_at,
    };
  }
  messages(sessionId: string, userId: string): Message[] {
    const assets = this.store.all(
      "SELECT * FROM attachments WHERE session_id=? AND user_id=? AND message_id IS NOT NULL",
      sessionId,
      userId,
    );
    return this.store
      .all(
        "SELECT * FROM messages WHERE session_id=? AND user_id=? ORDER BY created_at,rowid",
        sessionId,
        userId,
      )
      .map((m) => ({
        id: m.id,
        userId: m.user_id,
        role: m.role,
        body: m.body,
        stage: m.stage,
        exerciseIndex: m.exercise_index,
        judgment: m.judgment === null ? null : Boolean(m.judgment),
        createdAt: m.created_at,
        status: m.status,
        error: m.error,
        replyTo: m.reply_to,
        evaluation: m.evaluation ? JSON.parse(m.evaluation) : null,
        attachments: assets
          .filter((a) => a.message_id === m.id)
          .map((a) => ({
            id: a.id,
            name: a.name,
            mime: a.mime,
            size: a.size,
            url: `/api/attachments/${a.id}`,
          })),
      }));
  }
  participants(sessionId: string): Participant[] {
    return this.store
      .all(
        `SELECT p.*,u.username,u.name,(SELECT count(*) FROM messages m WHERE m.session_id=p.session_id AND m.user_id=p.user_id AND m.role='student') AS message_count,(SELECT max(created_at) FROM messages m WHERE m.session_id=p.session_id AND m.user_id=p.user_id) AS last_activity FROM participants p JOIN users u ON u.id=p.user_id WHERE p.session_id=? ORDER BY u.username`,
        sessionId,
      )
      .map((p) => ({
        userId: p.user_id,
        username: p.username,
        name: p.name,
        explainStatus: p.explain_status,
        checks: JSON.parse(p.checks),
        judgments: JSON.parse(p.judgments),
        pending: Boolean(p.pending),
        messageCount: p.message_count,
        explainHints: (Object.values(JSON.parse(p.focus)) as number[]).reduce(
          (sum, n) => sum + Math.min(n, 2),
          0,
        ),
        explainCorrections: (
          Object.values(JSON.parse(p.focus)) as number[]
        ).reduce((sum, n) => sum + Math.max(n - 2, 0), 0),
        lastActivity: p.last_activity,
      }));
  }
  detail(user: User, sessionId: string, target?: string) {
    const s = this.session(user, sessionId);
    const lesson = JSON.parse(s.snapshot) as Lesson;
    const students = this.participants(sessionId);
    const userId =
      user.role === "student" ? user.id : target || students[0]?.userId;
    const participant = students.find((p) => p.userId === userId);
    ensure(participant || user.role === "teacher", 404, "未找到学生。");
    const visible = ["attempt", "judge", "ended"].includes(s.stage);
    const ex = lesson.exercises[s.exercise_index];
    return {
      session: this.sessionView(s),
      lesson: {
        id: lesson.id,
        order: lesson.order,
        title: lesson.title,
        subtitle: lesson.subtitle,
        chapter: lesson.chapter,
        duration: lesson.duration,
        sourcePages: lesson.sourcePages,
        material: lesson.material,
        objectives: lesson.objectives,
        checklist: lesson.checklist.map((c) => ({ id: c.id, label: c.label })),
        status: lesson.status,
        exercises: lesson.exercises.map((x, i) => ({
          id: x.id,
          title: x.title,
          ...(visible && i <= s.exercise_index
            ? { prompt: x.prompt, attempt: x.attempt }
            : {}),
        })),
      },
      exercise:
        visible && ex
          ? {
              id: ex.id,
              title: ex.title,
              prompt: ex.prompt,
              attempt: ex.attempt,
            }
          : undefined,
      messages: userId ? this.messages(sessionId, userId) : [],
      participant: participant || null,
      students: user.role === "teacher" ? students : undefined,
      aiReady: Boolean(this.config.apiKey || this.config.demo),
      demo: this.config.demo,
    };
  }
  event(sessionId: string, actorId: string, kind: string, details: unknown) {
    this.store.run(
      "INSERT INTO events VALUES(?,?,?,?,?,?)",
      id(),
      sessionId,
      actorId,
      kind,
      JSON.stringify(details),
      now(),
    );
  }
  markIncomplete(s: any) {
    if (s.stage === "explain")
      this.store.run(
        "UPDATE participants SET pending=1,explain_status='pending' WHERE session_id=? AND explain_status!='achieved'",
        s.id,
      );
    if (s.stage === "judge")
      for (const p of this.store.all(
        "SELECT * FROM participants WHERE session_id=?",
        s.id,
      )) {
        const judgments = JSON.parse(p.judgments);
        const ex = JSON.parse(s.snapshot).exercises[s.exercise_index];
        if (judgments[ex.id]?.status !== "achieved") {
          judgments[ex.id] = { ...judgments[ex.id], status: "pending" };
          this.store.run(
            "UPDATE participants SET pending=1,judgments=? WHERE session_id=? AND user_id=?",
            JSON.stringify(judgments),
            s.id,
            p.user_id,
          );
        }
      }
  }
  startProcessing(messageId: string, revision: number) {
    void this.process(messageId, revision).catch((error) => {
      this.store.run(
        "UPDATE messages SET status='failed',error=? WHERE id=?",
        error instanceof Error && error.name === "TimeoutError"
          ? "模型响应超时，消息已保存，请重试。"
          : error instanceof Error
            ? error.message
            : "模型暂不可用，请重试。",
        messageId,
      );
    });
  }
  private async process(messageId: string, revision: number) {
    const m = this.store.get("SELECT * FROM messages WHERE id=?", messageId)!;
    const s = this.store.get(
      "SELECT * FROM sessions WHERE id=?",
      m.session_id,
    )!;
    const lesson = JSON.parse(s.snapshot) as Lesson;
    const messages = this.messages(s.id, m.user_id);
    const imageFiles = this.store.all(
      "SELECT message_id AS messageId,path,mime,size FROM attachments WHERE session_id=? AND user_id=? AND message_id IS NOT NULL",
      s.id,
      m.user_id,
    );
    const previous = this.store.get(
      "SELECT checks FROM participants WHERE session_id=? AND user_id=?",
      s.id,
      m.user_id,
    )!;
    const result = await this.evaluate({
      lesson,
      messages,
      stage: m.stage,
      exerciseIndex: m.exercise_index,
      imageFiles,
      previousChecks: JSON.parse(previous.checks),
    });
    this.store.tx(() => {
      const current = this.store.get(
        "SELECT * FROM sessions WHERE id=?",
        s.id,
      )!;
      const stale = current.revision !== revision;
      const p = this.store.get(
        "SELECT * FROM participants WHERE session_id=? AND user_id=?",
        s.id,
        m.user_id,
      )!;
      const focus = JSON.parse(p.focus);
      const judgments = JSON.parse(p.judgments);
      let feedback = result.feedback;
      if (m.stage === "explain") {
        if (result.issue) {
          const count = focus[result.issue.key] || 0;
          feedback =
            count < 2
              ? result.issue.question
              : `我发现这里需要改一下：${result.issue.correction}\n\n你能再用自己的话教我一遍吗？`;
          focus[result.issue.key] = count + 1;
        }
        if (!stale)
          this.store.run(
            "UPDATE participants SET checks=?,explain_status=?,focus=? WHERE session_id=? AND user_id=?",
            JSON.stringify(result.checks),
            result.checks.length === lesson.checklist.length &&
              result.checks.every((c) => c.met)
              ? "achieved"
              : Object.values(focus).some((n: any) => n > 2)
                ? "needs_help"
                : "in_progress",
            JSON.stringify(focus),
            s.id,
            m.user_id,
          );
      } else if (m.stage === "judge") {
        const ex = lesson.exercises[m.exercise_index];
        const record = judgments[ex.id] || {};
        const passed =
          Boolean(m.judgment) === ex.isCorrect &&
          result.reasoningAccepted &&
          (ex.isCorrect || result.corrected);
        const hints = record.hints || 0;
        if (!passed)
          feedback =
            hints < 2
              ? `我还没完全听明白。${ex.hint}\n\n请你说明判断的依据${ex.isCorrect ? "，再帮我检查一遍。" : "，并把需要修改的地方写出来。"}`
              : `我对照材料重新检查了一下：${ex.errorExplanation || "这道题的关键依据如下。"}\n\n${ex.correctAnswer}\n\n你能再用自己的话说明判断依据${ex.isCorrect ? "吗？" : "，并教我怎样修正吗？"}`;
        if (!stale) {
          judgments[ex.id] = {
            ...record,
            status: passed
              ? "achieved"
              : hints >= 2
                ? "needs_help"
                : "in_progress",
            hints: hints + (passed ? 0 : 1),
          };
          this.store.run(
            "UPDATE participants SET judgments=? WHERE session_id=? AND user_id=?",
            JSON.stringify(judgments),
            s.id,
            m.user_id,
          );
        }
      }
      const evaluation = {
        checks: result.checks,
        reasoningAccepted: result.reasoningAccepted,
        corrected: result.corrected,
        note: result.note,
        source: this.config.demo ? "演示反馈（未评价）" : "模型评价",
        model: this.config.model,
        promptVersion: PROMPT_VERSION,
        phaseStale: stale,
      };
      if (this.config.demo) feedback = result.feedback;
      this.store.run(
        "UPDATE messages SET status='done',error=NULL,evaluation=? WHERE id=?",
        JSON.stringify(evaluation),
        m.id,
      );
      this.store.run(
        "INSERT INTO messages(id,session_id,user_id,role,body,stage,exercise_index,created_at,reply_to) VALUES(?,?,?,?,?,?,?,?,?)",
        id(),
        s.id,
        m.user_id,
        "assistant",
        feedback || "谢谢你讲给我听。可以再补充一个具体例子吗？",
        m.stage,
        m.exercise_index,
        now(),
        m.id,
      );
    });
  }
}
