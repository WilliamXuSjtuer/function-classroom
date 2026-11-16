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
import { readSupport, explainFeedback } from "./support.js";
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
    const latest = new Map<string, Map<string, string>>();
    for (const m of this.store.all(
      "SELECT user_id,stage,exercise_index,status,evaluation FROM messages WHERE session_id=? AND role='student' ORDER BY created_at,rowid",
      sessionId,
    )) {
      const state =
        m.status === "failed"
          ? "failed"
          : m.status === "pending"
            ? "processing"
            : m.evaluation && JSON.parse(m.evaluation).reviewRequired
              ? "review"
              : "evaluated";
      const tasks = latest.get(m.user_id) || new Map<string, string>();
      tasks.set(
        m.stage === "explain" ? "explain" : `judge:${m.exercise_index}`,
        state,
      );
      latest.set(m.user_id, tasks);
    }
    const snapshot = this.store.get(
      "SELECT snapshot FROM sessions WHERE id=?",
      sessionId,
    );
    const lesson = snapshot ? (JSON.parse(snapshot.snapshot) as Lesson) : null;
    return this.store
      .all(
        `SELECT p.*,u.username,u.name,(SELECT count(*) FROM messages m WHERE m.session_id=p.session_id AND m.user_id=p.user_id AND m.role='student') AS message_count,(SELECT max(created_at) FROM messages m WHERE m.session_id=p.session_id AND m.user_id=p.user_id) AS last_activity FROM participants p JOIN users u ON u.id=p.user_id WHERE p.session_id=? ORDER BY u.username`,
        sessionId,
      )
      .map((p) => {
        const states = latest.get(p.user_id) || new Map<string, string>();
        const judgments = JSON.parse(p.judgments);
        lesson?.exercises.forEach((ex, i) => {
          if (judgments[ex.id])
            judgments[ex.id].evaluationStatus =
              states.get(`judge:${i}`) || "not_submitted";
        });
        return {
          userId: p.user_id,
          username: p.username,
          name: p.name,
          explainStatus: p.explain_status,
          explainEvaluationStatus: states.get("explain") || "not_submitted",
          checks: JSON.parse(p.checks),
          judgments,
          pending: Boolean(p.pending),
          messageCount: p.message_count,
          explainHints: readSupport(p.focus).questions,
          explainCorrections: readSupport(p.focus).corrections,
          explainSupplements: readSupport(p.focus).supplements,
          evaluationFailures: [...states.values()].filter((s) => s === "failed")
            .length,
          needsReview: [...states.values()].includes("review"),
          lastActivity: p.last_activity,
        };
      });
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
      "SELECT checks,focus,judgments FROM participants WHERE session_id=? AND user_id=?",
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
      support: {
        explainFocus: readSupport(previous.focus).active,
        judgeHints:
          JSON.parse(previous.judgments)[lesson.exercises[m.exercise_index]?.id]
            ?.hints || 0,
      },
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
      const focus = readSupport(p.focus);
      const judgments = JSON.parse(p.judgments);
      let feedback = result.feedback;
      let interaction;
      if (result.reviewRequired) {
        feedback =
          "我还没核对清楚这次讲解，想请老师一起看一下。你的回答已经保存。";
        interaction = { kind: "review" as const, target: "" };
      } else if (m.stage === "explain") {
        const response = explainFeedback(result, focus);
        feedback = response.feedback;
        interaction = response.interaction;
        if (!stale)
          this.store.run(
            "UPDATE participants SET checks=?,explain_status=?,focus=? WHERE session_id=? AND user_id=?",
            JSON.stringify(result.checks),
            result.checks.length === lesson.checklist.length &&
              result.checks.every((c) => c.met)
              ? "achieved"
              : Object.values(focus.active).some((n) => n > 2)
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
              ? result.feedback || `我还想请你解释一下：${ex.hint}`
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
            "UPDATE participants SET judgments=?,checks=? WHERE session_id=? AND user_id=?",
            JSON.stringify(judgments),
            JSON.stringify(result.checks),
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
        interaction,
        reasoningEvidence: result.reasoningEvidence,
        correctionEvidence: result.correctionEvidence,
        validationWarnings: result.validationWarnings,
        reviewRequired: result.reviewRequired,
        modelAttempts: result.modelAttempts,
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
