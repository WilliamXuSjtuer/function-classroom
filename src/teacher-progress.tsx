import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, Clock3, Users, X } from "lucide-react";
import type { SessionDetail } from "../shared/types";
import { stageNames } from "../shared/types";
import { Badge, Conversation } from "./components";
import {
  classroomProgress,
  evaluationLabels,
  latestExchange,
  matchesProgress,
  progressLabels,
  type ProgressFilter,
  type StudentProgress,
} from "./progress";

export function ProgressBoard({
  detail,
  selected,
  onSelect,
  error,
  updatedAt,
  inspector,
}: {
  detail: SessionDetail;
  selected: string;
  onSelect: (id: string) => void;
  error: string;
  updatedAt: number | null;
  inspector: ReactNode;
}) {
  const scope = `${detail.session.id}/${detail.session.stage}/${detail.session.exerciseIndex}`;
  const [selection, setSelection] = useState<{
    scope: string;
    filter: ProgressFilter;
  }>({ scope, filter: "all" });
  const filter = selection.scope === scope ? selection.filter : "all";
  const setFilter = (filter: ProgressFilter) => setSelection({ scope, filter });
  const progress = classroomProgress(detail);
  const visible = progress.students.filter((s) => matchesProgress(s, filter));
  const current =
    detail.session.stage === "judge" || detail.session.stage === "attempt"
      ? `第 ${detail.session.exerciseIndex + 1} 题 · ${stageNames[detail.session.stage]}`
      : stageNames[detail.session.stage];
  return (
    <section className="progress-board" aria-label="全班当前进度">
      <div className="progress-heading">
        <div>
          <h2>
            全班进度 <span className="count">{progress.total} 人</span>
          </h2>
          <p>{current}</p>
        </div>
        <span className="progress-updated" role="status">
          {error
            ? "刷新失败，当前显示上次数据"
            : updatedAt
              ? `更新于 ${new Date(updatedAt).toLocaleTimeString("zh-CN", { hour12: false })} · 每3秒刷新`
              : "正在更新…"}
        </span>
      </div>
      {progress.assessed ? (
        <>
          <div className="progress-totals" aria-label="按学习状态筛选">
            <button
              className={`progress-total all ${filter === "all" ? "selected" : ""}`}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              <span>全部同学</span>
              <b>
                {progress.total}
                <small>人</small>
              </b>
            </button>
            {Object.entries(progress.counts).map(([key, count]) => (
              <button
                key={key}
                className={`progress-total ${key} ${filter === key ? "selected" : ""}`}
                aria-pressed={filter === key}
                onClick={() => setFilter(key as ProgressFilter)}
              >
                <span>
                  {progressLabels[key as keyof typeof progressLabels]}
                </span>
                <b>
                  {count}
                  <small>人</small>
                </b>
              </button>
            ))}
          </div>
          <div className="evaluation-filters" aria-label="按评价处理状态筛选">
            <span>评价处理</span>
            {Object.entries(progress.evaluations).map(([key, count]) => (
              <button
                key={key}
                aria-pressed={filter === key}
                className={filter === key ? "selected" : ""}
                onClick={() => setFilter(key as ProgressFilter)}
              >
                {evaluationLabels[key as keyof typeof evaluationLabels]}{" "}
                <b>{count}</b>
              </button>
            ))}
            <small>与学习状态分别显示</small>
          </div>
        </>
      ) : (
        <div className="progress-phase-note">
          <Clock3 size={17} />
          <span>
            {detail.session.stage === "reading"
              ? "自主阅读中，由教师把握阅读时长。"
              : detail.session.stage === "attempt"
                ? "请学生查看小知的解答，由教师开启判断与纠错。"
                : "本次课堂已结束，可在课堂档案中回顾过程。"}
          </span>
        </div>
      )}
      <div className={`progress-layout ${selected ? "with-inspector" : ""}`}>
        <div className="progress-roster surface">
          <div className="roster-heading">
            <span>
              <Users size={14} />
              {filter === "all"
                ? "全部同学"
                : Object.hasOwn(progressLabels, filter)
                  ? progressLabels[filter as keyof typeof progressLabels]
                  : evaluationLabels[
                      filter as keyof typeof evaluationLabels
                    ]}{" "}
              · {visible.length} 人
            </span>
            <small>按学号排列 · 点击查看详情</small>
          </div>
          {visible.length ? (
            <div className="progress-card-grid">
              {visible.map((row) => (
                <button
                  key={row.participant.userId}
                  className={`progress-student ${row.state || "unassessed"} ${selected === row.participant.userId ? "selected" : ""}`}
                  aria-label={`查看${row.participant.name}（${row.participant.username}）的进度`}
                  aria-pressed={selected === row.participant.userId}
                  onClick={() => onSelect(row.participant.userId)}
                >
                  <span className="progress-student-name">
                    <b>{row.participant.name}</b>
                    <ChevronRight size={13} />
                  </span>
                  <span className="progress-student-id">
                    {row.participant.username}
                  </span>
                  <span className="progress-student-status">
                    {row.state && <i />}
                    {row.state ? progressLabels[row.state] : row.caption}
                  </span>
                  {row.state && (
                    <span className="progress-student-caption">
                      {row.caption}
                    </span>
                  )}
                  {row.evaluation && (
                    <span className={`progress-evaluation ${row.evaluation}`}>
                      {evaluationLabels[row.evaluation]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="progress-no-match">
              <p>
                {progress.total
                  ? "当前没有符合筛选条件的同学。"
                  : "本次课堂暂无参与学生。"}
              </p>
              {filter !== "all" && (
                <button
                  className="text-button"
                  onClick={() => setFilter("all")}
                >
                  查看全部同学
                </button>
              )}
            </div>
          )}
        </div>
        {inspector}
      </div>
    </section>
  );
}

export function ProgressInspector({
  row,
  detail,
  onClose,
  transcript,
  loadingError,
}: {
  row: StudentProgress;
  detail: SessionDetail | null;
  onClose: () => void;
  transcript: ReactNode;
  loadingError: string;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus({ preventScroll: true });
  }, [row.participant.userId]);
  const exchange = detail ? latestExchange(detail) : [];
  const lastAnswer = exchange.find((m) => m.role === "student");
  const evaluation = lastAnswer?.evaluation;
  return (
    <aside
      className="progress-inspector surface"
      aria-label={`${row.participant.name}的进度详情`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="inspector-heading">
        <div>
          <b>{row.participant.name}</b>
          <span>{row.participant.username}</span>
        </div>
        <button
          ref={close}
          className="icon-button"
          aria-label="关闭学生详情"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      {!detail ? (
        <div className="inspector-loading" role="status">
          {loadingError
            ? "详情暂未更新，请稍候重试。"
            : "正在读取这位同学的详情…"}
        </div>
      ) : (
        <>
          <div className="inspector-summary">
            <b>{row.caption}</b>
            <div>
              {row.state && (
                <Badge
                  tone={
                    row.state === "achieved"
                      ? "green"
                      : row.state === "needs_help"
                        ? "amber"
                        : "gray"
                  }
                >
                  {progressLabels[row.state]}
                </Badge>
              )}
              {row.evaluation && (
                <Badge tone={row.evaluation === "failed" ? "red" : "amber"}>
                  {evaluationLabels[row.evaluation]}
                </Badge>
              )}
            </div>
          </div>
          {detail.session.stage === "explain" && (
            <section className="inspector-checks">
              <h3>知识点进度与待补内容</h3>
              {detail.lesson.checklist.map((c) => {
                const check = row.participant.checks.find((p) => p.id === c.id);
                const missing =
                  check?.parts?.filter((p) => p.status !== "met") || [];
                return (
                  <div
                    className={`inspector-check ${check?.met ? "met" : ""}`}
                    key={c.id}
                  >
                    <span>
                      {check?.met ? <Check size={14} /> : <Clock3 size={14} />}
                    </span>
                    <div>
                      <b>{c.label}</b>
                      <small>
                        {check?.met
                          ? "已完成"
                          : missing.length
                            ? missing
                                .map(
                                  (p) =>
                                    `${p.status === "incorrect" ? "需修正：" : p.status === "unverified" ? "待复核：" : "待补："}${p.label}`,
                                )
                                .join("；")
                            : "尚无完整的达标记录"}
                      </small>
                    </div>
                  </div>
                );
              })}
            </section>
          )}
          {detail.session.stage === "judge" && (
            <section className="inspector-checks">
              <h3>本题进度</h3>
              <p>
                {row.state === "achieved"
                  ? "本题已有核验通过的判断与解释。"
                  : row.state === "not_submitted"
                    ? "尚未提交本题判断与理由。"
                    : "请结合最近反馈查看需要补充的理由或修正。"}
              </p>
              {evaluation &&
                !evaluation.reviewRequired &&
                !evaluation.phaseStale &&
                !evaluation.evaluationSkipped &&
                row.state !== "achieved" && (
                  <ul>
                    {evaluation.reasoningAccepted === false && (
                      <li>判断理由尚待补充。</li>
                    )}
                    {lastAnswer?.judgment === false &&
                      evaluation.corrected === false && (
                        <li>修正结论尚待确认。</li>
                      )}
                  </ul>
                )}
            </section>
          )}
          <section className="inspector-recent">
            <h3>当前阶段最近一轮问答</h3>
            {exchange.length ? (
              <Conversation messages={exchange} autoScroll={false} />
            ) : (
              <p className="muted small">当前阶段还没有学生问答。</p>
            )}
          </section>
          <details className="inspector-history">
            <summary>
              展开完整对话 <span>{detail.messages.length} 条消息</span>
            </summary>
            {transcript}
          </details>
        </>
      )}
    </aside>
  );
}
