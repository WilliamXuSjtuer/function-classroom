import ExcelJS from "exceljs";
import archiver from "archiver";
import path from "node:path";
import type { Response } from "express";
import type { Store } from "./db.js";
import type { ClassroomService } from "./classroom.js";
import type { User } from "../shared/types.js";
export async function exportClass(
  store: Store,
  service: ClassroomService,
  user: User,
  classId: string,
  res: Response,
) {
  const classroom = service.ownClass(user, classId);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "知己 · 函数课堂";
  workbook.created = new Date();
  const conversations = workbook.addWorksheet("原始对话");
  const performances = workbook.addWorksheet("任务表现");
  const evidence = workbook.addWorksheet("评价依据");
  const events = workbook.addWorksheet("课堂事件");
  const parts = workbook.addWorksheet("细项证据");
  const headers = [
    [
      "学号",
      "姓名",
      "班级",
      "课堂编号",
      "原课堂编号",
      "活动类型",
      "课时",
      "知识点检查项",
      "阶段",
      "例题编号",
      "消息编号",
      "回复消息编号",
      "时间（UTC）",
      "角色",
      "原始内容",
      "学生判断",
      "处理状态",
      "错误信息",
      "图片附件",
    ],
    [
      "学号",
      "姓名",
      "班级",
      "课堂编号",
      "原课堂编号",
      "活动类型",
      "课时",
      "讲解状态",
      "待补",
      "例题编号",
      "首次判断",
      "首次判断是否正确",
      "提交次数",
      "提示次数",
      "任务状态",
      "讲解追问次数",
      "讲解明确纠错次数",
      "讲解补充说明次数",
      "讲解评价状态",
      "本题评价状态",
    ],
    [
      "学号",
      "姓名",
      "课堂编号",
      "消息编号",
      "检查项",
      "是否满足",
      "证据消息编号",
      "证据类型",
      "原话或图像观察",
      "理由是否充分",
      "是否修正",
      "评价说明",
      "评价来源",
      "模型",
      "提示词版本",
      "响应时阶段是否已切换",
      "检查项名称",
      "审核标准",
      "判断理由证据",
      "修正证据",
      "是否需复核",
      "证据核验说明",
      "模型请求次数",
      "反馈类型",
    ],
    ["课堂编号", "时间（UTC）", "操作者编号", "事件", "详情"],
    [
      "学号",
      "姓名",
      "课堂编号",
      "消息编号",
      "检查项",
      "子项编号",
      "子项标准",
      "子项状态",
      "证据消息编号",
      "证据类型",
      "学生原话或图像观察",
      "提示词版本",
      "响应时阶段是否已切换",
    ],
  ];
  for (const [index, sheet] of [
    conversations,
    performances,
    evidence,
    events,
    parts,
  ].entries()) {
    sheet.addRow(headers[index]);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF246B61" },
    };
    sheet.columns.forEach((c, i) => {
      c.width = i === 0 ? 20 : 24;
      c.numFmt = "@";
    });
    sheet.autoFilter = {
      from: "A1",
      to: { row: 1, column: headers[index].length },
    };
  }
  const attachments: any[] = [];
  for (const s of store.all(
    "SELECT * FROM sessions WHERE class_id=? ORDER BY created_at",
    classId,
  )) {
    const lesson = JSON.parse(s.snapshot);
    const mode = s.mode === "makeup" ? "补做" : "正式课堂";
    for (const p of service.participants(s.id)) {
      for (const m of service.messages(s.id, p.userId)) {
        const files = store.all(
          "SELECT * FROM attachments WHERE message_id=?",
          m.id,
        );
        attachments.push(...files);
        conversations.addRow([
          p.username,
          p.name,
          classroom.name,
          s.id,
          s.parent_id,
          mode,
          lesson.title,
          lesson.checklist.map((c: any) => c.label).join("；"),
          m.stage,
          lesson.exercises[m.exerciseIndex]?.id,
          m.id,
          m.replyTo,
          m.createdAt,
          m.role,
          m.body,
          m.judgment === null ? "" : m.judgment ? "正确" : "错误",
          m.status,
          m.error,
          files.map((a) => `images/${a.path}`).join("\n"),
        ]);
        if (m.evaluation) {
          const e = m.evaluation;
          for (const check of e.checks.length
            ? e.checks
            : [{ id: "", met: false, evidenceMessageId: null, quote: "" }])
            evidence.addRow([
              p.username,
              p.name,
              s.id,
              m.id,
              check.id,
              check.met ? "是" : "否",
              check.evidenceMessageId,
              check.evidenceKind || "text",
              check.quote,
              e.reasoningAccepted ? "是" : "否",
              e.corrected ? "是" : "否",
              e.note,
              e.source,
              e.model,
              e.promptVersion,
              e.phaseStale ? "是" : "否",
              lesson.checklist.find((c: any) => c.id === check.id)?.label || "",
              lesson.checklist.find((c: any) => c.id === check.id)?.criterion ||
                "",
              JSON.stringify(e.reasoningEvidence || []),
              JSON.stringify(e.correctionEvidence || []),
              e.reviewRequired ? "是" : "否",
              (e.validationWarnings || []).join("\n"),
              e.modelAttempts ?? "",
              e.interaction?.kind || "",
            ]);
          for (const check of e.checks)
            for (const part of check.parts || [])
              for (const ref of part.evidence.length ? part.evidence : [null])
                parts.addRow([
                  p.username,
                  p.name,
                  s.id,
                  m.id,
                  check.id,
                  part.id,
                  part.label,
                  {
                    met: "已满足",
                    missing: "待补充",
                    incorrect: "需修正",
                    unverified: "待复核",
                  }[part.status],
                  ref?.messageId || "",
                  ref?.kind || "",
                  ref?.quote || "",
                  e.promptVersion,
                  e.phaseStale ? "是" : "否",
                ]);
        }
      }
      for (const ex of lesson.exercises) {
        const j = p.judgments[ex.id];
        performances.addRow([
          p.username,
          p.name,
          classroom.name,
          s.id,
          s.parent_id,
          mode,
          lesson.title,
          p.explainStatus,
          p.pending ? "是" : "否",
          ex.id,
          j?.firstJudgment === undefined
            ? ""
            : j.firstJudgment
              ? "正确"
              : "错误",
          j?.firstCorrect === undefined ? "" : j.firstCorrect ? "是" : "否",
          j?.attempts || 0,
          j?.hints || 0,
          j?.status || "not_started",
          p.explainHints,
          p.explainCorrections,
          p.explainSupplements || 0,
          p.explainEvaluationStatus || "not_submitted",
          j?.evaluationStatus || "not_submitted",
        ]);
      }
    }
    for (const e of store.all(
      "SELECT * FROM events WHERE session_id=? ORDER BY created_at",
      s.id,
    ))
      events.addRow([s.id, e.created_at, e.actor_id, e.kind, e.details]);
  }
  for (const sheet of workbook.worksheets)
    sheet.eachRow((row, index) => {
      if (index > 1) {
        row.alignment = { vertical: "top", wrapText: true };
        row.height = 35;
      }
    });
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
  res.attachment(
    `classroom-${classId}-${new Date().toISOString().slice(0, 10)}.zip`,
  );
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", (error) => res.destroy(error));
  archive.on("warning", (error) => res.destroy(error));
  res.on("close", () => {
    if (!res.writableEnded) archive.abort();
  });
  archive.pipe(res);
  archive.append(xlsx, { name: "课堂过程记录.xlsx" });
  archive.append(
    "原始对话、任务表现、评价依据、细项证据与课堂事件保存在 Excel 中。images 目录中的文件与“图片附件”列对应。时间采用 UTC。模型评价需结合原始记录复核；前后测成绩在系统外管理。\n评价状态：not_submitted=尚未提交，processing=评价中，evaluated=已评价，failed=系统未能评价，review=证据待教师复核。系统失败、待复核和任务待补均不能直接解释为学生未掌握。讲解补充说明与明确纠错分别计数。历史评价保留原提示词版本，不用新版规则改写旧记录。\n",
    { name: "说明.txt" },
  );
  for (const a of new Map(attachments.map((a) => [a.id, a])).values())
    archive.file(path.join(store.dir, "uploads", a.path), {
      name: `images/${a.path}`,
    });
  await archive.finalize();
}
