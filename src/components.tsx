import { useEffect, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  Flower2,
  RefreshCw,
  X,
} from "lucide-react";
import {
  stageNames,
  stages,
  type Message,
  type Stage,
  type Participant,
} from "../shared/types";
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        f<span>·</span>
      </span>
      <div>
        知己<span className="brand-sub">函数课堂</span>
      </div>
    </div>
  );
}
export function Buddy({
  size = "normal",
}: {
  size?: "normal" | "large" | "small";
}) {
  return (
    <div className={`buddy ${size}`} aria-label="小知同学">
      <span className="buddy-leaf" />
      <span className="buddy-eye left" />
      <span className="buddy-eye right" />
      <span className="buddy-mouth" />
      <span className="buddy-blush left" />
      <span className="buddy-blush right" />
    </div>
  );
}
export function Rich({ children }: { children: string }) {
  return (
    <div className="rich">
      <Markdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        components={{
          img: () => null,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
              <ArrowUpRight size={13} />
            </a>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
export function Badge({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon || <Flower2 size={28} />}</div>
      <h3>{title}</h3>
      <div className="muted">{children}</div>
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const listener = (e: Event) => setError(String((e as CustomEvent).detail));
    window.addEventListener("classroom-error", listener);
    return () => window.removeEventListener("classroom-error", listener);
  }, []);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="关闭对话框"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {children}
    </dialog>
  );
}
export function Steps({ stage }: { stage: Stage }) {
  const current = stages.indexOf(stage);
  return (
    <div className="steps">
      {stages.slice(0, 4).map((s, i) => (
        <div
          key={s}
          className={`step ${i === current ? "current" : ""} ${i < current ? "past" : ""}`}
        >
          <span>{i < current ? <Check size={14} /> : i + 1}</span>
          <b>{stageNames[s]}</b>
          {i < 3 && <ChevronRight size={15} />}
        </div>
      ))}
    </div>
  );
}
export const statusLabels: Record<string, string> = {
  not_started: "尚未开始",
  in_progress: "还需补充",
  achieved: "讲解达标",
  needs_help: "需要帮助",
  pending: "待补",
  evaluation_failed: "系统未能评价",
  needs_review: "待教师复核",
};
export function taskStatus(learningStatus: string, evaluationStatus?: string) {
  return evaluationStatus === "failed"
    ? "evaluation_failed"
    : evaluationStatus === "review"
      ? "needs_review"
      : learningStatus;
}
export function Status({ value }: { value: string }) {
  return (
    <Badge
      tone={
        value === "achieved"
          ? "green"
          : value === "needs_help" || value === "evaluation_failed"
            ? "red"
            : value === "pending" || value === "needs_review"
              ? "amber"
              : "gray"
      }
    >
      {statusLabels[value] || value}
    </Badge>
  );
}
export function Conversation({
  messages,
  onRetry,
}: {
  messages: Message[];
  onRetry?: (id: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const signature = messages.map((m) => `${m.id}:${m.status}`).join("|");
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [signature]);
  return (
    <div className="conversation">
      {messages.map((m) => (
        <article key={m.id} className={`message ${m.role}`}>
          {m.role === "assistant" ? (
            <Buddy size="small" />
          ) : (
            <div className="person-avatar">我</div>
          )}
          <div className="message-content">
            <div className="message-meta">
              {m.role === "assistant" ? "小知同学" : "小老师"}
              <span>
                {new Date(m.createdAt).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span>{stageNames[m.stage]}</span>
            </div>
            <div className="bubble">
              {m.judgment !== null && (
                <span className="judgment-label">
                  我的判断：{m.judgment ? "正确" : "错误"}
                </span>
              )}
              {m.body && <Rich>{m.body}</Rich>}
              {m.attachments.map((a) => (
                <a
                  key={a.id}
                  className="attachment"
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img src={a.url} alt={a.name} />
                </a>
              ))}
            </div>
            {m.status === "pending" && (
              <div className="message-status">
                <span className="typing">
                  <i />
                  <i />
                  <i />
                </span>
                小知正在认真读你的讲解…
              </div>
            )}
            {m.status === "failed" && (
              <div className="message-error">
                {m.error}
                <button
                  className="text-button"
                  onClick={() => onRetry?.(m.id)}
                  disabled={!onRetry}
                >
                  <RefreshCw size={13} />
                  重试回复
                </button>
              </div>
            )}
            {m.evaluation?.phaseStale && (
              <div className="message-status">
                该评价返回时，教师已切换阶段；未覆盖新阶段进度。
              </div>
            )}
          </div>
        </article>
      ))}
      <div ref={end} />
    </div>
  );
}
export function CheckProgress({
  participant,
  checklist,
}: {
  participant: Participant | null;
  checklist: { id: string; label: string }[];
}) {
  return (
    <div className="check-list">
      {checklist.map((c) => {
        const check = participant?.checks.find((x) => x.id === c.id);
        return (
          <div key={c.id} className={`check-item ${check?.met ? "met" : ""}`}>
            <span className="check-dot">
              {check?.met ? <Check size={12} /> : <Clock3 size={11} />}
            </span>
            <div>
              {c.label}
              {check?.quote && <small>“{check.quote}”</small>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
