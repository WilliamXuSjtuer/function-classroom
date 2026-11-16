import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  ImagePlus,
  LockKeyhole,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import type { Attachment, SessionDetail, User } from "../shared/types";
import { stageNames } from "../shared/types";
import type { Bootstrap } from "./App";
import { api, post } from "./api";
import {
  Badge,
  Buddy,
  CheckProgress,
  Conversation,
  Empty,
  Rich,
  Steps,
  Status,
  statusLabels,
} from "./components";
export function Student({
  boot,
  page,
  setPage,
  notify,
  user,
}: {
  boot: Bootstrap;
  page: string;
  setPage: (page: string) => void;
  notify: (error: string) => void;
  user: User;
}) {
  const [historyId, setHistoryId] = useState<string | null>(null),
    [detail, setDetail] = useState<SessionDetail | null>(null),
    [materialOpen, setMaterialOpen] = useState(true);
  const current = boot.sessions.find((s) => !s.endedAt) || boot.sessions[0];
  const sessionId = historyId || current?.id;
  async function load() {
    if (sessionId) setDetail(await api(`/sessions/${sessionId}`));
  }
  useEffect(() => {
    setDetail(null);
    if (!sessionId) return;
    let live = true;
    const fetchDetail = () =>
      api<SessionDetail>(`/sessions/${sessionId}`)
        .then((x) => {
          if (live) setDetail(x);
        })
        .catch((e) => {
          if (live) notify(e.message);
        });
    fetchDetail();
    const timer = setInterval(fetchDetail, 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [sessionId]);
  if (page === "history")
    return (
      <main className="page">
        <div className="page-heading">
          <div className="eyebrow">MY LEARNING JOURNEY</div>
          <h1>每一次讲解，都算数。</h1>
          <p>回到课堂里，看看理解是怎样一点点发生的。</p>
        </div>
        {boot.sessions.length ? (
          <div className="history-grid">
            {boot.sessions.map((s) => (
              <button
                className="history-card"
                key={s.id}
                onClick={() => {
                  setHistoryId(s.id);
                  setPage("classroom");
                }}
              >
                <div className="history-card-top">
                  <span className="lesson-icon">
                    <BookOpen size={22} />
                  </span>
                  <Badge tone={s.endedAt ? "gray" : "green"}>
                    {s.endedAt ? "已结束" : "进行中"}
                  </Badge>
                </div>
                <h3>{s.lessonTitle}</h3>
                <p>
                  {s.mode === "makeup" ? "补做活动" : "正式课堂"} ·{" "}
                  {new Date(s.createdAt).toLocaleDateString("zh-CN")}
                </p>
                {s.pending && <Badge tone="amber">有待补任务</Badge>}
                <span className="text-link">
                  查看课堂记录 <ArrowRight size={15} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <Empty title="你的学习足迹，从第一节课开始">
            教师开启课堂后，讲解和思考都会保存在这里。
          </Empty>
        )}
      </main>
    );
  if (!sessionId)
    return (
      <main className="page">
        <div className="page-heading">
          <div className="eyebrow">HELLO, LITTLE TEACHER</div>
          <h1>{user.name}，今天换你来当老师。</h1>
          <p>准备好把你的理解，讲给小知听了吗？</p>
        </div>
        <div className="waiting-card">
          <Buddy size="large" />
          <Badge tone="amber">等待教师开启课堂</Badge>
          <h2>小老师，我已经准备好啦。</h2>
          <p>
            先翻开导学案，想一想今天想教我什么。
            <br />
            教师发布任务后，课堂会自动出现在这里。
          </p>
          <div className="waiting-class">
            <BookOpen size={17} />
            {boot.classes[0]?.name || "等待教师分配班级"}
          </div>
        </div>
      </main>
    );
  if (!detail)
    return (
      <main className="page">
        <Empty title="正在打开课堂…" />
      </main>
    );
  return (
    <main className="student-page">
      <div className="student-title">
        <div>
          {historyId && (
            <button className="text-button" onClick={() => setHistoryId(null)}>
              <ArrowLeft size={14} />
              返回当前课堂
            </button>
          )}
          <div className="eyebrow">
            {detail.lesson.chapter} <span>·</span>{" "}
            {detail.session.mode === "makeup" ? "补做活动" : "新课学习"}
          </div>
          <h1>{detail.lesson.title}</h1>
        </div>
        <Badge tone={detail.session.stage === "ended" ? "gray" : "green"}>
          {detail.session.stage === "ended" ? (
            <LockKeyhole size={13} />
          ) : (
            <span className="live-dot" />
          )}
          {stageNames[detail.session.stage]}
        </Badge>
      </div>
      <Steps stage={detail.session.stage} />
      <div
        className={`student-columns ${materialOpen ? "" : "material-collapsed"}`}
      >
        <aside className="material-panel">
          <button
            className="panel-heading"
            onClick={() => setMaterialOpen(!materialOpen)}
          >
            <BookOpen size={18} />
            <b>今日学习材料</b>
            <ChevronDown size={16} />
          </button>
          {materialOpen && (
            <div className="material-body">
              <span className="source-tag">
                导学案 ·{" "}
                {detail.lesson.sourcePages.map((n) => `P${n}`).join(" / ")}
              </span>
              <Rich>{detail.lesson.material}</Rich>
              <div className="material-goals">
                <h3>试着讲清这些问题</h3>
                {detail.lesson.objectives.map((o, i) => (
                  <p key={i}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    {o}
                  </p>
                ))}
              </div>
              <div className="learning-progress">
                <h3>我的讲解进度</h3>
                <div className="student-progress-status">
                  <Status
                    value={detail.participant?.explainStatus || "not_started"}
                  />
                  {detail.participant?.pending && (
                    <Badge tone="amber">有待补任务</Badge>
                  )}
                </div>
                <CheckProgress
                  participant={detail.participant}
                  checklist={detail.lesson.checklist}
                />
                <div className="student-task-status">
                  <h3>例题完成情况</h3>
                  {detail.lesson.exercises.map((ex) => {
                    const state =
                      detail.participant?.judgments[ex.id]?.status ||
                      "not_started";
                    return (
                      <div key={ex.id}>
                        <span>{ex.title}</span>
                        <Badge
                          tone={
                            state === "achieved"
                              ? "green"
                              : state === "pending"
                                ? "amber"
                                : "gray"
                          }
                        >
                          {state === "achieved"
                            ? "已完成"
                            : statusLabels[state] || state}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
                <small>
                  依据课堂对话生成，供过程回顾。待补活动由教师另行开放。
                </small>
              </div>
            </div>
          )}
        </aside>
        <section className="chat-panel">
          <div className="chat-heading">
            <Buddy size="small" />
            <div>
              <b>小知同学</b>
              <small>认真听讲中，等你把知识教给我</small>
            </div>
            <span className="small-label">你是小老师</span>
          </div>
          {detail.exercise && (
            <div className="exercise-banner">
              <span>例题 {detail.session.exerciseIndex + 1}</span>
              <b>{detail.exercise.title}</b>
              <small>请阅读小知的解答，检查每一步依据。</small>
            </div>
          )}
          {detail.messages.length ? (
            <Conversation
              messages={detail.messages}
              onRetry={
                ["explain", "judge"].includes(detail.session.stage)
                  ? async (id) => {
                      try {
                        await post(`/messages/${id}/retry`);
                        await load();
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }
                  : undefined
              }
            />
          ) : (
            <div className="chat-welcome">
              <Buddy size="large" />
              <h2>小老师，你好呀！</h2>
              <p>
                我是小知，很多地方还不太懂。
                <br />
                你能用自己的话，把今天的知识讲给我听吗？
              </p>
              <div className="welcome-prompt">
                <Sparkles size={16} />
                {detail.session.stage === "reading"
                  ? "先读一读左边的材料，等教师开启讲解。"
                  : "可以从“这个概念是什么”开始。"}
              </div>
            </div>
          )}
          <Composer detail={detail} refresh={load} notify={notify} />
        </section>
      </div>
    </main>
  );
}
function Composer({
  detail,
  refresh,
  notify,
}: {
  detail: SessionDetail;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [text, setText] = useState(""),
    [judgment, setJudgment] = useState<boolean | undefined>(),
    [images, setImages] = useState<Attachment[]>([]),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [math, setMath] = useState<"sup" | "sub" | "symbol" | null>(null);
  const input = useRef<HTMLTextAreaElement>(null),
    file = useRef<HTMLInputElement>(null),
    request = useRef<{ fingerprint: string; id: string } | null>(null);
  const { session } = detail;
  const pending = detail.messages.some((m) => m.status === "pending");
  const allowed = ["explain", "judge"].includes(session.stage);
  const enabled = allowed && !busy && !pending && detail.aiReady;
  useEffect(() => {
    setJudgment(undefined);
  }, [session.id, session.exerciseIndex, session.stage]);
  useEffect(() => {
    setText("");
    setImages([]);
    request.current = null;
  }, [session.id]);
  const symbols = {
    sup: [
      "⁰",
      "¹",
      "²",
      "³",
      "⁴",
      "⁵",
      "⁶",
      "⁷",
      "⁸",
      "⁹",
      "ⁿ",
      "ˣ",
      "⁺",
      "⁻",
      "⁽",
      "⁾",
    ],
    sub: ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉", "ₙ", "ₓ"],
    symbol: [
      "≤",
      "≥",
      "≠",
      "∈",
      "∉",
      "∞",
      "√",
      "π",
      "∪",
      "∩",
      "⇒",
      "±",
      "−",
      "×",
      "÷",
      "∅",
    ],
  };
  function insert(value: string) {
    const element = input.current;
    if (!element) return;
    const start = element.selectionStart,
      end = element.selectionEnd;
    setText(text.slice(0, start) + value + text.slice(end));
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + value.length, start + value.length);
    });
  }
  async function upload(image: File) {
    if (images.length >= 3) {
      notify("每条消息最多附3张图片。");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", image);
      const result = await api<Attachment>(
        `/sessions/${session.id}/attachments`,
        { method: "POST", body: form },
      );
      setImages((previous) => [...previous, result]);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  }
  async function send() {
    if (!text.trim() && !images.length) return;
    setBusy(true);
    try {
      const body = {
        body: text,
        attachments: images.map((a) => a.id),
        judgment: session.stage === "judge" ? judgment : undefined,
        revision: session.revision,
      };
      const fingerprint = JSON.stringify(body);
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, id: crypto.randomUUID() };
      await post(`/sessions/${session.id}/messages`, {
        ...body,
        clientId: request.current.id,
      });
      setText("");
      setImages([]);
      request.current = null;
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="composer-wrap">
      {!allowed ? (
        <div className="readonly-note">
          <LockKeyhole size={15} />
          {session.stage === "ended"
            ? "本次课堂已结束，可以回顾全部对话。"
            : session.stage === "reading"
              ? "正在自主阅读，等待教师开启讲解。"
              : "先检查小知的解答，等待教师开启判断与纠错。"}
        </div>
      ) : (
        <>
          {!detail.aiReady && (
            <div className="inline-warning">
              教师尚未配置模型，当前可以阅读和查看历史。
            </div>
          )}
          {session.stage === "judge" && (
            <div className="judgment-switch">
              <span>我的判断</span>
              <button
                className={judgment === true ? "picked" : ""}
                onClick={() => setJudgment(true)}
                disabled={!enabled}
              >
                <Check size={15} />
                正确
              </button>
              <button
                className={judgment === false ? "picked wrong" : ""}
                onClick={() => setJudgment(false)}
                disabled={!enabled}
              >
                <X size={15} />
                有错误
              </button>
              <small>两种判断都需要说明理由</small>
            </div>
          )}
          <div className="math-toolbar">
            <button
              className={math === "sup" ? "active" : ""}
              onClick={() => setMath(math === "sup" ? null : "sup")}
              disabled={!enabled}
            >
              x² <span>上标</span>
            </button>
            <button
              className={math === "sub" ? "active" : ""}
              onClick={() => setMath(math === "sub" ? null : "sub")}
              disabled={!enabled}
            >
              x₁ <span>下标</span>
            </button>
            <button
              className={math === "symbol" ? "active" : ""}
              onClick={() => setMath(math === "symbol" ? null : "symbol")}
              disabled={!enabled}
            >
              ≤ <span>数学符号</span>
            </button>
            <i />
            <button
              onClick={() => file.current?.click()}
              disabled={!enabled || uploading || images.length >= 3}
            >
              <ImagePlus size={16} />
              {uploading ? "上传中…" : "手写图片"}
            </button>
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                if (e.target.files?.[0]) upload(e.target.files[0]);
              }}
            />
          </div>
          {math && (
            <div className="math-palette">
              {symbols[math].map((c) => (
                <button
                  key={c}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(c)}
                  disabled={!enabled}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          {images.length > 0 && (
            <div className="draft-images">
              {images.map((a) => (
                <div key={a.id}>
                  <img src={a.url} alt="待发送的手写图片" />
                  <button
                    aria-label={`移除${a.name}`}
                    onClick={() =>
                      setImages(images.filter((i) => i.id !== a.id))
                    }
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="composer">
            <textarea
              ref={input}
              aria-label="讲解内容"
              value={text}
              maxLength={10000}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                session.stage === "judge"
                  ? "说说判断的依据；如果有错误，请指出并修正…"
                  : "用自己的话讲给小知听，也可以举一个例子…"
              }
              disabled={!enabled}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (
                    enabled &&
                    !uploading &&
                    (session.stage !== "judge" || judgment !== undefined)
                  )
                    send();
                }
              }}
            />
            <button
              className="send-button"
              aria-label="发送讲解"
              disabled={
                !enabled ||
                uploading ||
                (!text.trim() && !images.length) ||
                (session.stage === "judge" && judgment === undefined)
              }
              onClick={send}
            >
              <Send size={19} />
            </button>
          </div>
          <div className="composer-hint">
            <span>
              {pending
                ? "小知正在思考，请稍等片刻。"
                : "不必追求完美，把你的理解讲清楚就好。"}
            </span>
            <span>{text.length}/10000</span>
          </div>
        </>
      )}
    </div>
  );
}
