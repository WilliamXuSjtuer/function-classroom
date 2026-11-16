import type { AIResult } from "./ai.js";
import type { Evaluation, SubmissionKind } from "../shared/types.js";
import { completedFeedback } from "./dialogue.js";

interface Support {
  version: 2;
  active: Record<string, number>;
  questions: number;
  corrections: number;
  supplements: number;
}
export function readSupport(json: string): Support {
  const stored = JSON.parse(json);
  if (stored.version === 2) return stored;
  const counts = Object.values(stored).filter(
    (n): n is number => typeof n === "number",
  );
  return {
    version: 2,
    active: stored,
    questions: counts.reduce((sum, n) => sum + Math.min(n, 2), 0),
    corrections: counts.reduce((sum, n) => sum + Math.max(n - 2, 0), 0),
    supplements: 0,
  };
}

export function explainFeedback(
  result: AIResult,
  support: Support,
  kind: SubmissionKind = "answer",
) {
  for (const check of result.checks) {
    if (check.met) {
      for (const key of Object.keys(support.active))
        if (key === check.id || key.startsWith(`${check.id}:`))
          delete support.active[key];
    } else
      for (const part of check.parts || [])
        if (part.status === "met")
          delete support.active[`${check.id}:${part.id}`];
  }
  const issue = result.issue;
  let feedback = result.feedback;
  let interaction: NonNullable<Evaluation["interaction"]> = {
    kind: "acknowledge",
    target: "",
  };
  if (kind === "clarification") {
    interaction = {
      kind: "clarification",
      target: issue ? `${issue.key}:${issue.partId}` : "",
    };
  } else if (result.checks.length && result.checks.every((c) => c.met)) {
    feedback = completedFeedback("explain");
  } else if (issue) {
    const target = `${issue.key}:${issue.partId || "criterion"}`;
    const count = support.active[target] || 0;
    const kind =
      count < 2
        ? "question"
        : issue.kind === "missing"
          ? "supplement"
          : "correction";
    if (kind === "question") {
      feedback = issue.question;
      support.questions++;
    } else if (kind === "supplement") {
      feedback = `我查到这里还需要补充一个条件：${issue.correction}\n\n你能用自己的话或一个例子帮我理解这个条件吗？`;
      support.supplements++;
    } else {
      feedback = `我对照材料发现这里需要修正：${issue.correction}\n\n你能再用自己的话教我一遍吗？`;
      support.corrections++;
    }
    support.active[target] = count + 1;
    interaction = { kind, target };
  }
  return { feedback, interaction, support };
}
