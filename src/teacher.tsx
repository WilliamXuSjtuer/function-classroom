import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  History,
  Import,
  Pause,
  Play,
  Plus,
  Save,
  Search,
  Users,
  X,
} from "lucide-react";
import type {
  Classroom,
  ClassSession,
  Lesson,
  SessionDetail,
} from "../shared/types";
import { stageNames, stages } from "../shared/types";
import type { Bootstrap } from "./App";
import { api, post } from "./api";
import { useDetail } from "./use-session-detail";
import { ProgressBoard, ProgressInspector } from "./teacher-progress";
import { classroomProgress } from "./progress";
import {
  Badge,
  CheckProgress,
  Conversation,
  Empty,
  Modal,
  Rich,
  Status,
  Steps,
  taskStatus,
} from "./components";
interface Props {
  boot: Bootstrap;
  refresh: () => Promise<void>;
  page: string;
  setPage: (page: string) => void;
  notify: (error: string) => void;
}
export function Teacher({ boot, refresh, page, setPage, notify }: Props) {
  const [classId, setClassId] = useState(""),
    [create, setCreate] = useState(false),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false);
  const activeClass =
    boot.classes.find((c) => c.id === classId) || boot.classes[0];
  const sessions = boot.sessions.filter((s) => s.classId === activeClass?.id);
  const current = sessions.find((s) => !s.endedAt);
  async function createClass() {
    setBusy(true);
    try {
      const result = await post("/classes", { name });
      setClassId(result.id);
      setCreate(false);
      setName("");
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page teacher-page">
      <div className="teacher-page-top">
        <div>
          <div className="eyebrow">
            {page === "lessons"
              ? "LESSON STUDIO"
              : page === "history"
                ? "LEARNING EVIDENCE"
                : page === "students"
                  ? "CLASS MEMBERS"
                  : "TEACHING WORKSPACE"}
          </div>
          <h1>
            {page === "lessons"
              ? "好课堂，从一次认真备课开始。"
              : page === "history"
                ? "让学习的过程，有迹可循。"
                : page === "students"
                  ? "每一个名字，都值得被看见。"
                  : "把课堂，交给学生的思考。"}
          </h1>
          <p>
            {page === "lessons"
              ? "核对材料、评价标准与例题，审核后发布到课堂。"
              : page === "history"
                ? "完整保留讲解、追问和纠错，回看理解发生的时刻。"
                : page === "students"
                  ? "批量导入名册，学生使用学号进入课堂。"
                  : "统一课堂节奏，关注每一位小老师的理解。"}
          </p>
        </div>
        <div className="class-selector">
          <Users size={16} />
          <select
            aria-label="选择班级"
            value={activeClass?.id || ""}
            onChange={(e) => setClassId(e.target.value)}
          >
            {boot.classes.length ? (
              boot.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))
            ) : (
              <option value="">尚未创建班级</option>
            )}
          </select>
          <button
            className="icon-button"
            aria-label="创建班级"
            onClick={() => setCreate(true)}
          >
            <Plus size={17} />
          </button>
        </div>
      </div>
      {!boot.aiReady && (
        <div className="inline-warning">
          模型尚未连接。可以先完成名册和备课；开始真实对话前请配置服务端
          DeepSeek 密钥。
        </div>
      )}
      {page === "lessons" ? (
        <LessonStudio
          lessons={boot.lessons}
          refresh={refresh}
          notify={notify}
        />
      ) : !activeClass ? (
        <Empty title="先为你的课堂创建一个班级">
          <p>导入学生后，就可以发布第一个学习任务。</p>
          <button className="button primary" onClick={() => setCreate(true)}>
            <Plus size={16} />
            创建班级
          </button>
        </Empty>
      ) : page === "students" ? (
        <Members
          key={activeClass.id}
          classroom={activeClass}
          refresh={refresh}
          notify={notify}
        />
      ) : page === "history" ? (
        <Records
          sessions={sessions}
          classroom={activeClass}
          notify={notify}
          refresh={refresh}
        />
      ) : (
        <Live
          key={current?.id || activeClass.id}
          classroom={activeClass}
          session={current}
          lessons={boot.lessons}
          refresh={refresh}
          notify={notify}
          setPage={setPage}
        />
      )}
      {create && (
        <Modal title="创建班级" onClose={() => setCreate(false)}>
          <label>
            班级名称
            <input
              autoFocus
              placeholder="例如：高一（3）班"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button className="button" onClick={() => setCreate(false)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={!name.trim() || busy}
              onClick={createClass}
            >
              创建班级
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
function Live({
  classroom,
  session,
  lessons,
  refresh,
  notify,
  setPage,
}: {
  classroom: Classroom;
  session?: ClassSession;
  lessons: Lesson[];
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  setPage: (page: string) => void;
}) {
  const [lessonId, setLessonId] = useState(""),
    [busy, setBusy] = useState(false),
    [end, setEnd] = useState(false),
    [student, setStudent] = useState("");
  const { detail, load, error, updatedAt } = useDetail(
    session?.id,
    student,
    notify,
    true,
  );
  const returnFocus = useRef<HTMLElement | null>(null);
  const selectedProgress = detail
    ? classroomProgress(detail).students.find(
        (p) => p.participant.userId === student,
      )
    : undefined;
  const selectedDetail =
    detail?.participant?.userId === student ? detail : null;
  function closeStudent() {
    setStudent("");
    if (returnFocus.current?.isConnected)
      returnFocus.current.focus({ preventScroll: true });
  }
  const published = lessons.filter((l) => l.status === "published");
  const selected = published.find((l) => l.id === lessonId) || published[0];
  async function open() {
    if (!selected) return;
    setBusy(true);
    try {
      await post(`/classes/${classroom.id}/sessions`, {
        lessonId: selected.id,
        mode: "classroom",
      });
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function control(action: string) {
    if (!detail) return;
    setBusy(true);
    try {
      await post(`/sessions/${detail.session.id}/control`, {
        action,
        revision: detail.session.revision,
      });
      setEnd(false);
      await refresh();
      await load();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const students = detail?.students || [];
  const achieved = students.filter(
    (p) => p.explainStatus === "achieved",
  ).length;
  const help = students.filter(
    (p) =>
      p.explainStatus === "needs_help" ||
      p.evaluationFailures ||
      p.needsReview ||
      Object.values(p.judgments).some((j) => j.status === "needs_help"),
  ).length;
  return (
    <>
      {!session && (
        <div className="stat-grid">
          <div className="stat-card">
            <span className="stat-icon green">
              <Users size={20} />
            </span>
            <div>
              <p>班级学生</p>
              <b>
                {classroom.studentCount}
                <small>人</small>
              </b>
            </div>
            <span className="stat-note">一人一账号</span>
          </div>
          <div className="stat-card">
            <span className="stat-icon blue">
              <CheckCircle2 size={20} />
            </span>
            <div>
              <p>讲解达标</p>
              <b>
                {achieved}
                <small>人</small>
              </b>
            </div>
            <span className="stat-note">本课过程评价</span>
          </div>
          <div className="stat-card">
            <span className="stat-icon amber">
              <FileCheck2 size={20} />
            </span>
            <div>
              <p>需要帮助</p>
              <b>
                {help}
                <small>人</small>
              </b>
            </div>
            <span className="stat-note">值得多一点关注</span>
          </div>
        </div>
      )}
      {!session ? (
        <div className="launch-card">
          <div className="launch-copy">
            <span className="eyebrow">READY FOR A NEW CLASS</span>
            <h2>下一节课，从这里开始。</h2>
            <p>选择审核通过的课时，邀请学生成为小老师。</p>
            <div className="launch-controls">
              <select
                aria-label="选择要开启的课时"
                value={selected?.id || ""}
                onChange={(e) => setLessonId(e.target.value)}
              >
                {published.length ? (
                  published.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))
                ) : (
                  <option value="">请先审核并发布课时</option>
                )}
              </select>
              <button
                className="button primary"
                disabled={busy || !selected || !classroom.studentCount}
                onClick={open}
              >
                <Play size={16} />
                开启课堂
              </button>
            </div>
            <button
              className="text-button"
              onClick={() =>
                setPage(!classroom.studentCount ? "students" : "lessons")
              }
            >
              {!classroom.studentCount ? "先导入学生名册" : "前往课时备课"}
              <ArrowRight size={14} />
            </button>
          </div>
          <div className="launch-art">
            <div className="formula-card">
              f(−x) = f(x)<small>把条件讲清，把理解留下。</small>
            </div>
            <span className="orbit one" />
            <span className="orbit two" />
          </div>
        </div>
      ) : detail ? (
        <>
          <section className="session-control live-control">
            <div className="live-control-row">
              <div className="live-control-title">
                <h2>{detail.lesson.title}</h2>
                <Badge>
                  <span className="live-dot" />
                  {detail.session.mode === "makeup" ? "补做 · " : ""}
                  {stageNames[detail.session.stage]}
                </Badge>
              </div>
              <div className="button-row">
                <button
                  className="button subtle"
                  disabled={busy}
                  onClick={() => setEnd(true)}
                >
                  <Pause size={15} />
                  结束课堂
                </button>
                {detail.session.stage === "judge" &&
                  detail.session.exerciseIndex + 1 <
                    detail.lesson.exercises.length && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => control("next-exercise")}
                    >
                      下一道例题 <ArrowRight size={15} />
                    </button>
                  )}
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    detail.session.stage === "judge"
                      ? setEnd(true)
                      : control("advance")
                  }
                >
                  {busy
                    ? "切换中…"
                    : detail.session.stage === "judge"
                      ? "完成本课"
                      : `进入${stageNames[stages[stages.indexOf(detail.session.stage) + 1]]}`}
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
            <Steps stage={detail.session.stage} />
          </section>
          <ProgressBoard
            detail={detail}
            selected={student}
            error={error}
            updatedAt={updatedAt}
            onSelect={(id) => {
              returnFocus.current = document.activeElement as HTMLElement;
              setStudent(id);
            }}
            inspector={
              selectedProgress ? (
                <ProgressInspector
                  row={selectedProgress}
                  detail={selectedDetail}
                  onClose={closeStudent}
                  loadingError={error}
                  transcript={
                    selectedDetail ? (
                      <TeacherTranscript
                        detail={selectedDetail}
                        autoScroll={false}
                      />
                    ) : null
                  }
                />
              ) : null
            }
          />
        </>
      ) : (
        <Empty title="正在读取课堂状态…" />
      )}
      {!session && (
        <div className="next-panel">
          <div className="section-title">
            <h2>课时任务库</h2>
            <button className="text-button" onClick={() => setPage("lessons")}>
              查看全部 <ArrowRight size={14} />
            </button>
          </div>
          <div className="lesson-preview-grid">
            {lessons.slice(0, 3).map((l, i) => (
              <button
                key={l.id}
                className="lesson-preview"
                onClick={() => setPage("lessons")}
              >
                <span className="lesson-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <Badge tone={l.status === "published" ? "green" : "gray"}>
                  {l.status === "published" ? "已发布" : "待审核"}
                </Badge>
                <h3>{l.title}</h3>
                <p>{l.subtitle}</p>
                <small>
                  {l.exercises.length} 道例题 · {l.checklist.length} 项检查
                </small>
              </button>
            ))}
          </div>
        </div>
      )}
      {end && (
        <Modal title="结束本次课堂？" onClose={() => setEnd(false)}>
          <p>
            学生将进入只读回顾。未完成的任务会保留为待补，之后可以从学习记录中开放补做。
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setEnd(false)}>
              继续课堂
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => control("end")}
            >
              结束并保存
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function TeacherTranscript({
  detail,
  autoScroll = true,
}: {
  detail: SessionDetail;
  autoScroll?: boolean;
}) {
  return (
    <section className="surface transcript">
      <div className="section-title">
        <div>
          <h2>{detail.participant?.name || "学生"} 的课堂对话</h2>
          <p className="muted small">完整保留讲解、图片与反馈</p>
        </div>
        <Badge tone="gray">{detail.messages.length} 条消息</Badge>
      </div>
      {detail.messages.length ? (
        <>
          <details className="evaluation-details">
            <summary>
              查看例题作答统计 <ChevronRight size={15} />
            </summary>
            {detail.lesson.exercises.map((ex) => {
              const j = detail.participant?.judgments[ex.id];
              return (
                <div key={ex.id} className="evaluation-entry">
                  <b>{ex.title}</b>
                  <p>
                    全部提交 {j?.attempts || 0} 次 · 首次达标前有效作答{" "}
                    {j?.answerAttempts ?? "未记录"} 次 · 首次达标后交流{" "}
                    {j?.postAchievementMessages ?? "未记录"} 次
                  </p>
                  <p>
                    首次达标：
                    {j?.firstAchievedAt
                      ? new Date(j.firstAchievedAt).toLocaleString("zh-CN")
                      : "未记录"}
                  </p>
                  {Boolean(j?.legacyAttempts) && (
                    <p>另有 {j?.legacyAttempts} 次历史提交未分类。</p>
                  )}
                </div>
              );
            })}
            <p className="muted small">
              有效作答排除识别出的澄清与收尾，不代表答案正确。新统计从新版提交开始，历史记录不回填。
            </p>
          </details>
          <Conversation messages={detail.messages} autoScroll={autoScroll} />
          <details className="evaluation-details">
            <summary>
              查看模型评价依据 <ChevronRight size={15} />
            </summary>
            {detail.messages
              .filter((m) => m.evaluation)
              .map((m) => (
                <div key={m.id} className="evaluation-entry">
                  <b>
                    {new Date(m.createdAt).toLocaleTimeString("zh-CN")} ·{" "}
                    {m.evaluation?.source}
                  </b>
                  <p>{m.evaluation?.note}</p>
                  {m.evaluation?.checks.map((c) => (
                    <div key={c.id}>
                      <p>
                        <Badge tone={c.met ? "green" : "gray"}>
                          {c.met ? "满足" : "待补充"}
                        </Badge>{" "}
                        {
                          detail.lesson.checklist.find(
                            (item) => item.id === c.id,
                          )?.label
                        }
                        {c.quote && <span> · “{c.quote}”</span>}
                      </p>
                      {c.parts && (
                        <details>
                          <summary>查看细项与学生证据</summary>
                          {c.parts.map((part) => (
                            <p key={part.id}>
                              <b>{part.label}</b>：
                              {
                                {
                                  met: "已满足",
                                  missing: "尚待补充",
                                  incorrect: "需修正",
                                  unverified: "待复核",
                                }[part.status]
                              }
                              {part.evidence.map((ref, i) => (
                                <small key={i}>
                                  {" "}
                                  ·{" "}
                                  {ref.kind === "image"
                                    ? "图像观察"
                                    : "学生原话"}
                                  ：“{ref.quote}”
                                </small>
                              ))}
                            </p>
                          ))}
                        </details>
                      )}
                    </div>
                  ))}
                  <small>
                    模型：{m.evaluation?.model} · 提示词：
                    {m.evaluation?.promptVersion}
                  </small>
                </div>
              ))}
          </details>
        </>
      ) : (
        <Empty title="等待第一段讲解">学生发送内容后，会自动出现在这里。</Empty>
      )}
    </section>
  );
}
function Members({
  classroom,
  refresh,
  notify,
}: {
  classroom: Classroom;
  refresh: () => Promise<void>;
  notify: (error: string) => void;
}) {
  const [students, setStudents] = useState<
      Array<{ id: string; username: string; name: string }>
    >([]),
    [importing, setImporting] = useState(false),
    [csv, setCsv] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [reset, setReset] = useState<(typeof students)[number] | null>(null),
    [resetMessage, setResetMessage] = useState("");
  const load = async () =>
    setStudents(await api(`/classes/${classroom.id}/students`));
  useEffect(() => {
    load().catch((e) => notify(e.message));
  }, [classroom.id, classroom.studentCount]);
  async function importRows() {
    setBusy(true);
    try {
      const rows = parseRoster(csv);
      await post(`/classes/${classroom.id}/students`, { students: rows });
      setImporting(false);
      setCsv("");
      await load();
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filtered = students.filter(
    (s) => s.name.includes(query) || s.username.includes(query),
  );
  return (
    <section className="surface members-panel">
      <div className="section-title">
        <div>
          <h2>
            {classroom.name} <span className="count">{students.length} 人</span>
          </h2>
          <p className="muted small">账号为学号，默认密码为学号后四位。</p>
        </div>
        <button className="button primary" onClick={() => setImporting(true)}>
          <Import size={16} />
          导入学生名册
        </button>
      </div>
      <div className="search-input">
        <Search size={17} />
        <input
          placeholder="搜索姓名或学号"
          aria-label="搜索学生"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {resetMessage && (
        <p role="status" className="small">
          {resetMessage}
        </p>
      )}
      {filtered.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>学生</th>
                <th>学号 / 账号</th>
                <th>所在班级</th>
                <th>账号管理</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="table-person">
                      <span className="mini-avatar">{s.name.slice(-2)}</span>
                      {s.name}
                    </span>
                  </td>
                  <td className="mono">{s.username}</td>
                  <td>{classroom.name}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => {
                        setResetMessage("");
                        setReset(s);
                      }}
                    >
                      重置为初始密码
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={query ? "没有找到这位学生" : "把小老师们邀请进课堂"}>
          上传 CSV / TSV 名册，或直接粘贴学号和姓名。
        </Empty>
      )}
      {importing && (
        <Modal title="导入学生名册" onClose={() => setImporting(false)}>
          <p className="muted">
            每行一名学生，顺序为“学号,姓名”。支持 CSV /
            TSV，首行可以包含表头。请保留学号前导零。
          </p>
          <label className="file-drop">
            <Import size={21} />
            <span>选择名册文件</span>
            <input
              type="file"
              accept=".csv,.tsv,.txt"
              onChange={async (e) => {
                if (e.target.files?.[0]) setCsv(await e.target.files[0].text());
              }}
            />
          </label>
          <label>
            或粘贴名册
            <textarea
              rows={7}
              placeholder={"学号,姓名\n20260101,林予安\n20260102,陈知夏"}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
          </label>
          <small className="muted">
            重复学号会提示核对，已有账号不会被覆盖。每次最多200人。
          </small>
          <div className="modal-actions">
            <button className="button" onClick={() => setImporting(false)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={busy || !csv.trim()}
              onClick={importRows}
            >
              {busy ? "正在创建账号…" : "确认导入"}
            </button>
          </div>
        </Modal>
      )}
      {reset && (
        <Modal
          title={`重置 ${reset.name} 的密码？`}
          onClose={() => setReset(null)}
          closeDisabled={busy}
        >
          <p>
            学号 {reset.username}{" "}
            的密码将恢复为学号后四位。这位学生需要重新登录。
          </p>
          <div className="modal-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => setReset(null)}
            >
              取消
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await post(`/students/${reset.id}/reset-password`);
                  setResetMessage(
                    `已重置 ${reset.name}（${reset.username}）的密码，请告知学生使用学号后四位登录。`,
                  );
                  setReset(null);
                } catch (e) {
                  notify((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "正在重置…" : "确认重置"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
function parseRoster(text: string) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .filter((x) => x.trim());
  const rows = lines.map((line) => {
    const values: string[] = [];
    let cell = "",
      quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = !quoted;
      } else if ((char === "," || char === "\t" || char === "，") && !quoted) {
        values.push(cell.trim());
        cell = "";
      } else cell += char;
    }
    if (quoted) throw Error("CSV 引号没有配对，请检查名册。");
    values.push(cell.trim());
    return values;
  });
  if (
    rows[0] &&
    ["学号", "username", "student_id"].includes(rows[0][0].toLowerCase())
  )
    rows.shift();
  if (rows.some((r) => r.length !== 2 || !r[0] || !r[1]))
    throw Error("每行需要两列：学号、姓名。");
  return rows.map((r) => ({ username: r[0], name: r[1] }));
}
function LessonStudio({
  lessons,
  refresh,
  notify,
}: {
  lessons: Lesson[];
  refresh: () => Promise<void>;
  notify: (error: string) => void;
}) {
  const [selected, setSelected] = useState(""),
    [edit, setEdit] = useState<Lesson | null>(null),
    [dirty, setDirty] = useState(false),
    [preview, setPreview] = useState(true),
    [busy, setBusy] = useState(false),
    [publish, setPublish] = useState<{ id: string; revision: number } | null>(
      null,
    ),
    [discard, setDiscard] = useState(false);
  const lesson = lessons.find((l) => l.id === selected) || lessons[0];
  useEffect(() => {
    if (lesson && !dirty) setEdit(structuredClone(lesson));
  }, [lesson?.id, lesson?.revision, dirty]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("lesson-dirty", { detail: dirty }));
    const protect = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => {
      window.dispatchEvent(new CustomEvent("lesson-dirty", { detail: false }));
      window.removeEventListener("beforeunload", protect);
    };
  }, [dirty]);
  function change<K extends keyof Lesson>(key: K, value: Lesson[K]) {
    setEdit((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  }
  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      await api(`/lessons/${edit.id}`, {
        method: "PUT",
        body: JSON.stringify({ lesson: edit, revision: edit.revision }),
      });
      await refresh();
      setDirty(false);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publishLesson() {
    if (!publish) return;
    setBusy(true);
    try {
      await post(`/lessons/${publish.id}/publish`, {
        revision: publish.revision,
      });
      setPublish(null);
      await refresh();
    } catch (e) {
      setPublish(null);
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!lesson || !edit) return <Empty title="任务库还没有内容" />;
  return (
    <div className="studio">
      <aside className="lesson-list">
        <div className="lesson-list-header">
          <BookOpen size={17} />
          章节课时 <span>{lessons.length}</span>
        </div>
        {lessons.map((l) => (
          <button
            key={l.id}
            className={lesson.id === l.id ? "active" : ""}
            onClick={() => {
              if (dirty) {
                notify("请先保存当前课时的修改，再切换课时。");
                return;
              }
              setSelected(l.id);
            }}
          >
            <span className="lesson-index">
              {String(l.order).padStart(2, "0")}
            </span>
            <div>
              <b>{l.title}</b>
              <small>
                {l.status === "published" ? "已审核发布" : "草稿 · 待审核"}
              </small>
            </div>
            {l.status === "published" && <Check size={13} />}
          </button>
        ))}
      </aside>
      <section className="surface lesson-editor">
        <fieldset className="editor-fieldset" disabled={busy}>
          <div className="section-title">
            <div>
              <Badge tone={lesson.status === "published" ? "green" : "amber"}>
                {dirty
                  ? "有未保存修改"
                  : lesson.status === "published"
                    ? "已发布"
                    : "待审核草稿"}
              </Badge>
              <h2>{lesson.title}</h2>
              <p className="muted small">
                {lesson.chapter} · {lesson.duration} 分钟 · 导学案 P
                {lesson.sourcePages.join("、P")}
              </p>
            </div>
            <a
              className="button subtle"
              href="/api/materials/guide"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={15} />
              核对导学案
            </a>
          </div>
          {dirty && edit.revision !== lesson.revision && (
            <div className="inline-warning">
              课时已有新版本。当前修改已保留，请先复制需要的内容，再放弃本地修改以载入最新版本。
            </div>
          )}
          <div className="studio-tabs">
            <button
              className={preview ? "active" : ""}
              onClick={() => setPreview(true)}
            >
              材料预览
            </button>
            <button
              className={!preview ? "active" : ""}
              onClick={() => setPreview(false)}
            >
              编辑材料
            </button>
          </div>
          {preview ? (
            <div className="lesson-material-preview">
              <Rich>{edit.material}</Rich>
            </div>
          ) : (
            <div className="editor-fields">
              <label>
                课时标题
                <input
                  value={edit.title}
                  onChange={(e) => change("title", e.target.value)}
                />
              </label>
              <label>
                学生阅读材料（支持 Markdown 与数学公式）
                <textarea
                  rows={12}
                  value={edit.material}
                  onChange={(e) => change("material", e.target.value)}
                />
              </label>
              <label>
                学习目标（每行一项）
                <textarea
                  rows={3}
                  value={edit.objectives.join("\n")}
                  onChange={(e) =>
                    change("objectives", e.target.value.split("\n"))
                  }
                />
              </label>
            </div>
          )}
          <div className="editor-section">
            <h3>
              讲解检查项 <span className="count">{edit.checklist.length}</span>
            </h3>
            <p className="muted small">
              标准仅供教师与评价器使用，学生只看到检查项名称。可每行写一个独立要点，每项最多20行。
            </p>
            {edit.checklist.map((c, i) => (
              <div className="rubric-editor" key={c.id}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <input
                    aria-label={`检查项${i + 1}名称`}
                    value={c.label}
                    onChange={(e) =>
                      change(
                        "checklist",
                        edit.checklist.map((x, n) =>
                          n === i ? { ...x, label: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <textarea
                    aria-label={`检查项${i + 1}标准`}
                    rows={2}
                    value={c.criterion}
                    onChange={(e) =>
                      change(
                        "checklist",
                        edit.checklist.map((x, n) =>
                          n === i ? { ...x, criterion: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="editor-section">
            <h3>
              例题与典型错解{" "}
              <span className="count">{edit.exercises.length}</span>
            </h3>
            <p className="muted small">
              以下答案标签与修正依据不会在学生首次判断前显示。
            </p>
            {edit.exercises.map((ex, i) => (
              <details className="exercise-editor" key={ex.id}>
                <summary>
                  <span className="lesson-index">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <b>{ex.title}</b>
                  <Badge tone={ex.isCorrect ? "green" : "amber"}>
                    {ex.isCorrect ? "正确版本" : "典型错解"}
                  </Badge>
                  <ChevronRight size={16} />
                </summary>
                <div className="exercise-editor-body">
                  {(
                    [
                      "title",
                      "prompt",
                      "attempt",
                      "correctAnswer",
                      "errorExplanation",
                      "hint",
                    ] as const
                  ).map((key) => (
                    <label key={key}>
                      {
                        {
                          title: "题目标题",
                          prompt: "题干",
                          attempt: "小知展示的解答",
                          correctAnswer: "正确解答",
                          errorExplanation: "错误分析",
                          hint: "追问提示",
                        }[key]
                      }
                      <textarea
                        rows={key === "title" ? 1 : 3}
                        value={ex[key]}
                        onChange={(e) =>
                          change(
                            "exercises",
                            edit.exercises.map((x, n) =>
                              n === i ? { ...x, [key]: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={ex.isCorrect}
                      onChange={(e) =>
                        change(
                          "exercises",
                          edit.exercises.map((x, n) =>
                            n === i ? { ...x, isCorrect: e.target.checked } : x,
                          ),
                        )
                      }
                    />
                    本例展示正确解答
                  </label>
                  <small className="muted">来源：{ex.source}</small>
                </div>
              </details>
            ))}
          </div>
          <div className="editor-footer">
            <span className="muted small">
              保存修改后需重新审核发布，已开始的课堂保留原任务版本。
            </span>
            <div className="button-row">
              {dirty && (
                <button
                  className="text-button"
                  onClick={() => setDiscard(true)}
                >
                  放弃修改
                </button>
              )}
              <button
                className="button"
                disabled={!dirty || busy}
                onClick={save}
              >
                <Save size={15} />
                {busy ? "保存中…" : "保存草稿"}
              </button>
              <button
                className="button primary"
                disabled={dirty || busy || lesson.status === "published"}
                onClick={() =>
                  setPublish({ id: lesson.id, revision: lesson.revision! })
                }
              >
                <CheckCircle2 size={16} />
                审核并发布
              </button>
            </div>
          </div>
        </fieldset>
      </section>
      {discard && (
        <Modal title="放弃未保存的备课修改？" onClose={() => setDiscard(false)}>
          <p>将载入最新保存的课时版本。</p>
          <div className="modal-actions">
            <button className="button" onClick={() => setDiscard(false)}>
              继续编辑
            </button>
            <button
              className="button primary"
              onClick={() => {
                setDirty(false);
                setDiscard(false);
                setEdit(structuredClone(lesson));
              }}
            >
              放弃修改
            </button>
          </div>
        </Modal>
      )}
      {publish && (
        <Modal title="确认审核并发布课时" onClose={() => setPublish(null)}>
          <p>
            请确认已核对本课材料、公式、检查标准，以及每道题的正确解答和典型错误。
          </p>
          <p className="muted">
            发布后即可在课堂总览中开启本课。后续修改会生成新草稿，历史课堂使用的内容保持可追溯。
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setPublish(null)}>
              返回核对
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={publishLesson}
            >
              已核对，发布课时
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Records({
  sessions,
  classroom,
  notify,
  refresh,
}: {
  sessions: ClassSession[];
  classroom: Classroom;
  notify: (message: string) => void;
  refresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState(""),
    [student, setStudent] = useState(""),
    [busy, setBusy] = useState(false),
    [makeup, setMakeup] = useState(false);
  const session = sessions.find((s) => s.id === selected) || sessions[0];
  const { detail } = useDetail(session?.id, student, notify);
  async function exportData() {
    setBusy(true);
    try {
      const response = await fetch(`/api/classes/${classroom.id}/export`);
      if (!response.ok) throw Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${classroom.name}-课堂过程记录.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="records-toolbar">
        <div>
          <h2>课堂档案</h2>
          <p className="muted small">
            Excel 原始记录、任务表现、评价依据，以及图片附件。
          </p>
        </div>
        <button
          className="button primary"
          disabled={busy || !sessions.length}
          onClick={exportData}
        >
          <Download size={16} />
          {busy ? "正在处理…" : "导出本班数据"}
        </button>
      </div>
      {session ? (
        <>
          <div className="record-filters">
            <label>
              课堂
              <select
                value={session.id}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setStudent("");
                }}
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.createdAt).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {s.lessonTitle} · {s.mode === "makeup" ? "补做" : "课堂"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              学生
              <select
                value={detail?.participant?.userId || ""}
                onChange={(e) => setStudent(e.target.value)}
              >
                {detail?.students?.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.name} · {p.username}
                    {p.pending ? " · 待补" : ""}
                  </option>
                ))}
              </select>
            </label>
            {session.endedAt && (
              <button
                className="button"
                disabled={
                  busy ||
                  !detail?.students?.some((p) => p.pending) ||
                  sessions.some((s) => !s.endedAt)
                }
                onClick={() => setMakeup(true)}
              >
                <History size={15} />
                开放待补学生补做
              </button>
            )}
          </div>
          {session.parentId && (
            <div className="inline-note">
              补做来源：
              {sessions.find((s) => s.id === session.parentId)?.lessonTitle ||
                session.parentId}
              。正式课堂与补做分别保留记录。
            </div>
          )}
          {detail && (
            <>
              <div className="record-summary">
                <Status
                  value={taskStatus(
                    detail.participant?.explainStatus || "not_started",
                    detail.participant?.explainEvaluationStatus,
                  )}
                />
                <span>{detail.participant?.messageCount || 0} 次提交</span>
                <span>
                  {detail.participant?.pending
                    ? "存在待补任务"
                    : "暂无待补标记"}
                </span>
                <Badge tone="gray">{stageNames[detail.session.stage]}</Badge>
              </div>
              <TeacherTranscript detail={detail} />
            </>
          )}
        </>
      ) : (
        <Empty title="还没有课堂记录">
          结束第一节课后，可以在这里回顾完整过程。
        </Empty>
      )}
      {makeup && (
        <Modal title="开放补做活动" onClose={() => setMakeup(false)}>
          <p>
            将为本次课堂中标记“待补”的学生开启补做，沿用原课堂任务版本，由教师统一控制阶段。
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setMakeup(false)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await post(`/classes/${classroom.id}/sessions`, {
                    lessonId: session.lessonId,
                    mode: "makeup",
                    parentId: session.id,
                  });
                  setMakeup(false);
                  await refresh();
                } catch (e) {
                  notify((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              开放补做
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
