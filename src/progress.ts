import type { Participant, SessionDetail } from "../shared/types.js";

export const progressLabels = {
  achieved: "已完成",
  in_progress: "进行中",
  not_submitted: "未提交",
  needs_help: "需要帮助",
};
export const evaluationLabels = {
  processing: "等待反馈",
  failed: "评价失败",
  review: "待复核",
};
export type ProgressState = keyof typeof progressLabels;
export type EvaluationState = keyof typeof evaluationLabels;
export type ProgressFilter = "all" | ProgressState | EvaluationState;
export interface StudentProgress {
  participant: Participant;
  state: ProgressState | null;
  evaluation: EvaluationState | null;
  caption: string;
  completedChecks: number;
}

// Learning outcomes and processing conditions are separate axes. Totals are
// scoped to the current session roster and the current task, never old tasks.
export function classroomProgress(
  detail: Pick<SessionDetail, "session" | "lesson" | "students">,
) {
  const { session, lesson } = detail;
  const assessed = session.stage === "explain" || session.stage === "judge";
  const counts: Record<ProgressState, number> = {
    achieved: 0,
    in_progress: 0,
    not_submitted: 0,
    needs_help: 0,
  };
  const evaluations: Record<EvaluationState, number> = {
    processing: 0,
    failed: 0,
    review: 0,
  };
  const students: StudentProgress[] = [...(detail.students || [])]
    .sort((a, b) =>
      a.username < b.username
        ? -1
        : a.username > b.username
          ? 1
          : a.userId.localeCompare(b.userId),
    )
    .map((participant) => {
      const completedChecks = lesson.checklist.filter((c) =>
        participant.checks.some((r) => r.id === c.id && r.met),
      ).length;
      if (!assessed)
        return {
          participant,
          state: null,
          evaluation: null,
          completedChecks,
          caption:
            session.stage === "reading"
              ? "自主阅读阶段"
              : session.stage === "attempt"
                ? "查看解答阶段"
                : "课堂已结束",
        };
      const judgment =
        participant.judgments[lesson.exercises[session.exerciseIndex]?.id];
      const status =
        session.stage === "explain"
          ? participant.explainStatus
          : judgment?.status || "not_started";
      const processing =
        (session.stage === "explain"
          ? participant.explainEvaluationStatus
          : judgment?.evaluationStatus) || "not_submitted";
      const evaluation = Object.hasOwn(evaluationLabels, processing)
        ? (processing as EvaluationState)
        : null;
      const state: ProgressState =
        status === "achieved"
          ? "achieved"
          : status === "needs_help"
            ? "needs_help"
            : processing === "not_submitted" &&
                status === "not_started" &&
                !(session.stage === "judge" && judgment?.attempts)
              ? "not_submitted"
              : "in_progress";
      counts[state]++;
      if (evaluation) evaluations[evaluation]++;
      return {
        participant,
        state,
        evaluation,
        completedChecks,
        caption:
          session.stage === "explain"
            ? `讲解完成 ${completedChecks}/${lesson.checklist.length} 项`
            : `第 ${session.exerciseIndex + 1} 题 · ${state === "achieved" ? "判断纠错已完成" : state === "not_submitted" ? "等待首次作答" : "判断与纠错中"}`,
      };
    });
  return { assessed, students, total: students.length, counts, evaluations };
}

export function matchesProgress(
  student: StudentProgress,
  filter: ProgressFilter,
) {
  return (
    filter === "all" ||
    student.state === filter ||
    student.evaluation === filter
  );
}

export function latestExchange(detail: SessionDetail) {
  const current = detail.messages.filter(
    (m) =>
      m.stage === detail.session.stage &&
      (detail.session.stage !== "judge" ||
        m.exerciseIndex === detail.session.exerciseIndex),
  );
  const latest = current.filter((m) => m.role === "student").at(-1);
  if (!latest) return [];
  return [
    latest,
    ...current.filter((m) => m.role === "assistant" && m.replyTo === latest.id),
  ];
}
