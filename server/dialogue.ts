import type { SubmissionKind } from "../shared/types.js";

// Conservative whole-utterance recognition, not a length threshold or a math
// correctness checker. Unrecognized text and images still go to the evaluator.
const compact = (text: string) =>
  text.normalize("NFKC").replace(/[\s\p{P}\u200B-\u200D\uFEFF]/gu, "");
const agreement =
  /^(?:(?:我觉得|我认为|我感觉)?(?:你|你这题|这题|你的答案|你的解答|答案|解答)?(?:做得|做的|算得|算的|说得|说的|讲得|讲的)?(?:都|完全)?(?:是)?(?:对|正确|没错|不对|错误|有错|有错误)(?:的)?(?:了|啊|呀|呢|哦)?|是的|不是|嗯+|好的?|好吧|明白了|懂了|知道了|谢谢(?:你)?|不客气)$/;
const closure =
  /^(?:(?:你)?(?:还)?(?:有没有|有什么)(?:问题|疑问)(?:吗|么)?|(?:你)?(?:还)?有(?:什么|其他|其它|别的)?(?:问题|疑问)(?:吗|么)|(?:你)?(?:还)?有什么不懂的(?:吗)?|还有吗|没(?:有)?(?:别的|其他)?问题了?)$/;
const clarification =
  /^(?:(?:什么(?:是)?|什么叫|何谓).{1,18}|.{1,18}(?:是什么|是什么意思|指的是什么)|(?:能|可以)(?:再)?(?:解释|说明|说|讲)(?:一下|一遍)(?:吗|么)?|(?:请)?(?:再)?(?:解释|说明|说|讲)(?:一下|一遍)|(?:我)?(?:没听懂|没看懂|不明白题意|不懂题意|不知道你在问什么)|(?:我)?(?:还)?有(?:个|一个|些|点|其他|其它|别的)?(?:问题|疑问))$/;

export function submissionKind(
  body: string,
  hasImages = false,
): SubmissionKind {
  if (hasImages) return "answer";
  const text = compact(body);
  if (/^什么都不是(?:呀|啊|呢|的)?$/.test(text)) return "answer";
  if (agreement.test(text) || closure.test(text)) return "social";
  const clauses = body
    .split(/[，。！？,!?;；\n]+/)
    .map(compact)
    .filter(Boolean);
  if (
    clauses.length > 1 &&
    clauses.every((c) => agreement.test(c) || closure.test(c))
  )
    return "social";
  const asksWhichStep =
    /^(?:你)?(?:到底|究竟)?(?:是)?(?:哪(?:里|儿|一步)(?:有问题|不懂|没懂|不明白)|有什么不懂)(?:啊|呀|呢|吗|的)?$/;
  if (
    clauses.some((c) => asksWhichStep.test(c)) &&
    clauses.every(
      (c) =>
        asksWhichStep.test(c) ||
        /^(?:你)?别让我(?:重新表述|重复|再说一遍)$/.test(c),
    )
  )
    return "clarification";
  if (clarification.test(text)) return "clarification";
  return "answer";
}

export const isDisagreement = (body: string) =>
  /不对|错误|有错|不是/.test(compact(body));

export function canSupportReasoning(quote: string) {
  const text = compact(quote);
  return (
    Boolean(text) &&
    submissionKind(quote) === "answer" &&
    !/^(?:都)?(?:满足|不满足|成立|不成立|可以|不可以|能|不能|是|否)$/.test(text)
  );
}

// A bare classification can complete a correction once a reason is known.
export function isBareParityConclusion(quote: string) {
  return /^(?:它|该函数|它们)?(?:都不是|什么都不是|非奇非偶(?:函数)?|既不是奇函数也不是偶函数)(?:呀|啊|呢|的)?$/.test(
    compact(quote),
  );
}

export const completedFeedback = (stage: string, corrected = false) =>
  stage === "judge"
    ? `你把判断依据${corrected ? "和修正方法" : ""}教给我了，这道题我明白了！我们等老师切换下一项任务吧。`
    : "你把这些知识点教给我了，我现在明白了！我们等老师安排下一项任务吧。";
