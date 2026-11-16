import { z } from "zod";
import type {
  Checklist,
  CheckPart,
  EvidenceRef,
  Message,
} from "../shared/types.js";
import type { AIInput, AIResult } from "./ai.js";

// These decompositions only apply to the exact reviewed criteria. Teacher edits
// use their own newline-separated criteria, without silently restoring defaults.
const conceptParts: Record<string, Array<[string, string]>> = {
  "说明定义域是非空数集，每个输入都有且只有一个输出；允许多对一。": [
    ["nonempty", "定义域是非空数集"],
    ["total", "定义域中的每个输入都有输出"],
    ["unique", "同一个输入只有一个输出"],
    ["many_to_one", "允许多个输入对应同一个输出"],
  ],
  "正确区分定义域、对应规则、值域，并解释函数值符号。": [
    ["domain", "定义域是允许输入的自变量集合"],
    ["rule", "对应规则确定输入与输出的关系"],
    ["range", "值域是实际输出的集合"],
    ["value", "f(a)表示输入a对应的函数值"],
  ],
  "知道各限制需要同时满足，化简时不能随意扩大定义域。": [
    ["simultaneous", "各项定义域限制需要同时满足"],
    ["preserve_domain", "化简时保留原定义域限制"],
  ],
  "以定义域相同且对应规则相同为依据，不仅比较式子的外观。": [
    ["domain", "比较函数时考虑定义域"],
    ["rule", "比较函数时考虑对应规则而不只看式子外观"],
  ],
};
export const MAX_CRITERIA_PARTS = 20;
function partsFor(criterion: string): Array<[string, string]> {
  if (Object.hasOwn(conceptParts, criterion)) return conceptParts[criterion];
  const lines = criterion
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Old published snapshots may predate the limit. Keep their entire criterion
  // as one item instead of silently dropping lines or failing every response.
  return (lines.length > MAX_CRITERIA_PARTS ? [criterion] : lines).map(
    (text, i) => [`criterion-${i + 1}`, text],
  );
}
export function rubricFor(checklist: Checklist[]) {
  return checklist.map((c) => ({
    ...c,
    parts: partsFor((c.criterion || c.label).trim()).map(([id, criterion]) => ({
      id,
      criterion,
    })),
  }));
}
const evidenceSchema = z.object({
  messageId: z.string().min(1),
  quote: z.string().min(1).max(1500),
  kind: z.enum(["text", "image"]),
});
export const assessmentSchema = z.object({
  feedback: z.string().trim().min(1).max(3000),
  checks: z
    .array(
      z.object({
        id: z.string(),
        parts: z
          .array(
            z.object({
              id: z.string(),
              status: z.enum(["met", "missing", "incorrect"]),
              evidence: z.array(evidenceSchema).max(8),
            }),
          )
          .max(MAX_CRITERIA_PARTS),
      }),
    )
    .max(15),
  issue: z
    .object({
      key: z.string(),
      partId: z.string(),
      kind: z.enum(["missing", "incorrect"]),
      question: z.string().trim().min(1).max(1000),
      correction: z.string().trim().min(1).max(2000),
    })
    .nullable(),
  reasoningAccepted: z.boolean(),
  corrected: z.boolean(),
  reasoningEvidence: z.array(evidenceSchema).max(8),
  correctionEvidence: z.array(evidenceSchema).max(8),
});
type RawAssessment = z.infer<typeof assessmentSchema>;
const partLabels = {
  met: "已满足",
  missing: "待补充",
  incorrect: "需修正",
  unverified: "待复核",
};
const distinct = (refs: EvidenceRef[]) =>
  [...new Map(refs.map((r) => [JSON.stringify(r), r])).values()].slice(-8);

export function normalizeAssessment(
  raw: RawAssessment,
  input: AIInput,
  history: Message[],
  visibleImages: Set<string>,
): AIResult {
  const byId = new Map(
    history.filter((m) => m.role === "student").map((m) => [m.id, m]),
  );
  const latest = history.filter((m) => m.role === "student").at(-1)!;
  const positions = new Map(history.map((m, i) => [m.id, i]));
  const warnings: string[] = [];
  const priorImageEvidence = (input.previousChecks || []).flatMap(
    (c) => c.parts?.flatMap((p) => p.evidence) || [],
  );
  const valid = (ref: EvidenceRef) => {
    const m = byId.get(ref.messageId);
    return Boolean(
      m &&
      ref.quote.trim() &&
      (ref.kind === "image"
        ? m.attachments.length &&
          (visibleImages.has(m.id) ||
            priorImageEvidence.some(
              (p) => JSON.stringify(p) === JSON.stringify(ref),
            ))
        : m.body.includes(ref.quote)),
    );
  };
  const checks = rubricFor(input.lesson.checklist).map((check) => {
    const proposed = raw.checks.find((c) => c.id === check.id);
    const previous = input.previousChecks?.find((c) => c.id === check.id);
    const parts: CheckPart[] = check.parts.map((part) => {
      const old = previous?.parts?.find(
        (p) => p.id === part.id && p.label === part.criterion,
      );
      const oldRefs = (old?.evidence || []).filter(valid);
      const kept: CheckPart =
        old && oldRefs.length
          ? { ...old, evidence: oldRefs }
          : {
              id: part.id,
              label: part.criterion,
              status: "missing",
              evidence: [],
            };
      const next = proposed?.parts.find((p) => p.id === part.id);
      if (!next || next.status === "missing") return kept;
      let refs = next.evidence.filter(valid);
      if (next.status === "incorrect")
        refs = refs.filter(
          (r) =>
            r.messageId === latest.id ||
            (kept.status === "incorrect" &&
              kept.evidence.some(
                (old) => JSON.stringify(old) === JSON.stringify(r),
              )),
        );
      if (next.status === "met" && kept.status === "incorrect") {
        const lastError = Math.max(
          ...kept.evidence.map((r) => positions.get(r.messageId) ?? -1),
        );
        refs = refs.filter(
          (r) => (positions.get(r.messageId) ?? -1) > lastError,
        );
      }
      if (!refs.length || refs.length !== next.evidence.length) {
        warnings.push(
          `${check.label}·${part.criterion}：证据未通过核验，保留已有有效记录。`,
        );
        return kept.status === "missing"
          ? { ...kept, status: "unverified" }
          : kept;
      }
      return {
        id: part.id,
        label: part.criterion,
        status: next.status,
        evidence: distinct([
          ...(kept.status === next.status ? kept.evidence : []),
          ...refs,
        ]),
      };
    });
    const refs = parts.flatMap((p) => p.evidence);
    const first = refs[0];
    return {
      id: check.id,
      met: parts.every((p) => p.status === "met"),
      parts,
      evidenceMessageId: first?.messageId || null,
      quote: first?.quote || "",
      evidenceKind: first?.kind,
    };
  });
  // Exercise approval needs student evidence from this exercise. Whole-lesson
  // checklist completeness is deliberately independent of this decision.
  const taskRefs = (refs: EvidenceRef[], claimed: boolean, label: string) => {
    const accepted = refs.filter(
      (r) =>
        valid(r) &&
        byId.get(r.messageId)?.stage === "judge" &&
        byId.get(r.messageId)?.exerciseIndex === input.exerciseIndex,
    );
    if (claimed && (!accepted.length || accepted.length !== refs.length))
      warnings.push(`${label}：缺少本题学生作答的有效证据。`);
    return accepted;
  };
  const reasoningEvidence = taskRefs(
    raw.reasoningEvidence,
    raw.reasoningAccepted && input.stage === "judge",
    "判断依据",
  );
  const correctionEvidence = taskRefs(
    raw.correctionEvidence,
    raw.corrected && input.stage === "judge",
    "纠正依据",
  );
  const reasoningAccepted =
    input.stage === "judge" &&
    raw.reasoningAccepted &&
    reasoningEvidence.length > 0 &&
    reasoningEvidence.length === raw.reasoningEvidence.length;
  const corrected =
    input.stage === "judge" &&
    raw.corrected &&
    correctionEvidence.length > 0 &&
    correctionEvidence.length === raw.correctionEvidence.length;
  let issue = input.stage === "explain" ? raw.issue : null;
  if (issue) {
    const part = checks
      .find((c) => c.id === issue!.key)
      ?.parts.find((p) => p.id === issue!.partId);
    if (!part || part.status === "met") {
      warnings.push("追问目标不存在或已有有效证据，需重新选择尚未解决的细项。");
      issue = null;
    } else if (part.status === "unverified") issue = null;
    else
      issue = {
        ...issue,
        kind: part.status === "incorrect" ? "incorrect" : "missing",
      };
  }
  const note =
    checks
      .map(
        (c) =>
          `${input.lesson.checklist.find((x) => x.id === c.id)!.label}：${c.parts.map((p) => `${p.label}（${partLabels[p.status]}）`).join("；")}`,
      )
      .join("\n") +
    (input.stage === "judge"
      ? `\n本题判断依据${reasoningAccepted ? "充分" : "待补充"}；修正${corrected ? "已说明" : "未确认"}。`
      : "") +
    (warnings.length
      ? "\n证据核验存在疑问，待复核；不能据此认定学生未掌握。"
      : "");
  return {
    feedback: raw.feedback,
    checks,
    issue,
    reasoningAccepted,
    corrected,
    reasoningEvidence,
    correctionEvidence,
    note,
    validationWarnings: warnings,
    reviewRequired: warnings.length > 0,
  };
}
