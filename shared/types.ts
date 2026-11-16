export type Role = "teacher" | "student";
export type Stage = "reading" | "explain" | "attempt" | "judge" | "ended";
export const stages: Stage[] = [
  "reading",
  "explain",
  "attempt",
  "judge",
  "ended",
];
export const stageNames: Record<Stage, string> = {
  reading: "自主阅读",
  explain: "讲给小知听",
  attempt: "小知做例题",
  judge: "判断与纠错",
  ended: "课堂已结束",
};
export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  classId: string | null;
}
export interface Checklist {
  id: string;
  label: string;
  criterion?: string;
}
export interface Exercise {
  id: string;
  title: string;
  prompt: string;
  attempt: string;
  isCorrect: boolean;
  correctAnswer: string;
  errorExplanation: string;
  hint: string;
  source: string;
}
export interface Lesson {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  chapter: string;
  duration: number;
  sourcePages: number[];
  material: string;
  objectives: string[];
  checklist: Checklist[];
  exercises: Exercise[];
  status: "draft" | "published";
  revision?: number;
}
export interface Classroom {
  id: string;
  name: string;
  studentCount: number;
  currentSessionId?: string | null;
}
export interface ClassSession {
  id: string;
  classId: string;
  className: string;
  lessonId: string;
  lessonTitle: string;
  stage: Stage;
  mode: "classroom" | "makeup";
  parentId: string | null;
  exerciseIndex: number;
  revision: number;
  createdAt: string;
  endedAt: string | null;
  pending?: boolean;
  explainStatus?: string;
}
export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}
export type SubmissionKind = "answer" | "clarification" | "social";
export interface Submission {
  kind: SubmissionKind;
  afterAchievement: boolean;
}
export interface Message {
  id: string;
  userId: string;
  role: "student" | "assistant" | "system";
  body: string;
  stage: Stage;
  exerciseIndex: number;
  judgment: boolean | null;
  createdAt: string;
  status: "pending" | "done" | "failed";
  error: string | null;
  attachments: Attachment[];
  evaluation?: Evaluation | null;
  replyTo?: string | null;
  submission?: Submission;
}
export interface CheckResult {
  id: string;
  met: boolean;
  evidenceMessageId: string | null;
  quote: string;
  evidenceKind?: "text" | "image";
  parts?: CheckPart[];
}
export interface EvidenceRef {
  messageId: string;
  quote: string;
  kind: "text" | "image";
}
export interface CheckPart {
  id: string;
  label: string;
  status: "met" | "missing" | "incorrect" | "unverified";
  evidence: EvidenceRef[];
}
export interface Evaluation {
  checks: CheckResult[];
  reasoningAccepted: boolean;
  corrected: boolean;
  note: string;
  source: string;
  model: string;
  promptVersion: string;
  phaseStale?: boolean;
  reasoningEvidence?: EvidenceRef[];
  correctionEvidence?: EvidenceRef[];
  validationWarnings?: string[];
  reviewRequired?: boolean;
  modelAttempts?: number;
  taskPassed?: boolean;
  evaluatedAt?: string;
  evaluationSkipped?: boolean;
  interaction?: {
    kind:
      | "question"
      | "supplement"
      | "correction"
      | "acknowledge"
      | "review"
      | "clarification";
    target: string;
  };
}
export interface Participant {
  userId: string;
  username: string;
  name: string;
  explainStatus: string;
  explainEvaluationStatus?: string;
  checks: CheckResult[];
  judgments: Record<
    string,
    {
      firstJudgment: boolean;
      firstCorrect: boolean;
      attempts: number;
      status: string;
      hints: number;
      evaluationStatus?: string;
      answerAttempts?: number;
      clarificationMessages?: number;
      socialMessages?: number;
      postAchievementMessages?: number;
      firstAchievedAt?: string;
      firstAchievedMessageId?: string;
      statisticsStartedAt?: string;
      legacyAttempts?: number;
      firstAchievementUnknown?: boolean;
    }
  >;
  pending: boolean;
  messageCount: number;
  explainHints: number;
  explainCorrections: number;
  explainSupplements?: number;
  evaluationFailures?: number;
  needsReview?: boolean;
  lastActivity: string | null;
}
export interface SessionDetail {
  session: ClassSession;
  lesson: Omit<Lesson, "exercises"> & {
    exercises: Array<{
      id: string;
      title: string;
      prompt?: string;
      attempt?: string;
    }>;
  };
  messages: Message[];
  participant: Participant;
  students?: Participant[];
  exercise?: { id: string; title: string; prompt: string; attempt: string };
  aiReady: boolean;
  demo: boolean;
}
