import { z } from "zod";
const text = (max = 10000) => z.string().trim().min(1).max(max);
export const lessonSchema = z
  .object({
    id: text(80),
    order: z.number().int().min(1).max(100),
    title: text(120),
    subtitle: text(200),
    chapter: text(120),
    duration: z.number().int().min(5).max(180),
    sourcePages: z.array(z.number().int().min(1).max(106)).max(106),
    material: text(30000),
    objectives: z.array(text(500)).min(1).max(20),
    checklist: z
      .array(
        z.object({ id: text(80), label: text(200), criterion: text(1500) }),
      )
      .min(1)
      .max(15),
    exercises: z
      .array(
        z.object({
          id: text(80),
          title: text(120),
          prompt: text(),
          attempt: text(),
          isCorrect: z.boolean(),
          correctAnswer: text(),
          errorExplanation: z.string().max(5000),
          hint: text(1000),
          source: text(500),
        }),
      )
      .min(1)
      .max(20),
    status: z.enum(["draft", "published"]),
  })
  .superRefine((x, ctx) => {
    for (const list of [x.checklist, x.exercises])
      if (new Set(list.map((a) => a.id)).size !== list.length)
        ctx.addIssue({ code: "custom", message: "检查项和例题编号不能重复。" });
  });
export const rosterSchema = z
  .array(
    z.object({
      username: z
        .string()
        .regex(
          /^[A-Za-z0-9_-]{4,32}$/,
          "学号须为至少4位字母或数字，可含下划线、短横线。",
        ),
      name: text(60),
    }),
  )
  .min(1)
  .max(200);
export const messageSchema = z
  .object({
    clientId: z.string().uuid(),
    body: z.string().trim().max(10000),
    attachments: z.array(z.string().uuid()).max(3).default([]),
    judgment: z.boolean().optional(),
    revision: z.number().int(),
  })
  .refine(
    (x) => x.body.length > 0 || x.attachments.length > 0,
    "请填写讲解或上传手写图片。",
  );
