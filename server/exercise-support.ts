import type { Exercise, Message } from "../shared/types.js";

export const referenceIntro = "我对照材料重新检查了一下：";

// Replay actual replies in display order. A reply sent after the student's
// passing submission cannot count as support for that submission.
export function exerciseSupport(
  messages: Message[],
  exercise: Exercise,
  index: number,
) {
  const before = new Map<
    string,
    { hints: number; referenceShown: boolean; known: boolean }
  >();
  const studentTurns = new Map<string, Message>();
  let hints = 0;
  let referenceShown = false;
  let known = true;
  for (const m of messages) {
    if (m.stage !== "judge" || m.exerciseIndex !== index) continue;
    if (m.role === "student") {
      before.set(m.id, { hints, referenceShown, known });
      studentTurns.set(m.id, m);
    } else if (m.role === "assistant") {
      const e = studentTurns.get(m.replyTo || "")?.evaluation;
      // v2.1 recorded the full-answer template as an ordinary question.
      const oldTemplate =
        m.body.startsWith(referenceIntro) &&
        m.body.includes(exercise.correctAnswer);
      if (oldTemplate || e?.interaction?.kind === "reference")
        referenceShown = true;
      if (e?.interaction?.kind === "question" && !oldTemplate) hints++;
      if (!e?.interaction && !oldTemplate) known = false;
    }
  }
  return before;
}
